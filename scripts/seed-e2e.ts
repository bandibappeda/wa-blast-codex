import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { loadConfig } from "../apps/server/src/config";
import { openDatabase } from "../apps/server/src/db/database";
import { migrate } from "../apps/server/src/db/migrate";
import { bootstrapAdmin, createAuthService } from "../apps/server/src/modules/auth/auth-service";
import { CredentialVault } from "../apps/server/src/modules/gateways/credential-vault";
import { SystemClock } from "../apps/server/src/shared/clock";
import { UuidGenerator } from "../apps/server/src/shared/id";

export const E2E_ADMIN = { email: "admin.e2e@wa-blast.test", password: "AdminPassword!123" } as const;
export const E2E_OPERATOR = { email: "operator.e2e@wa-blast.test", password: "OperatorPassword!123" } as const;
export const E2E_GATEWAY_ID = "gateway-e2e-mock";

const repoRoot = resolve(import.meta.dir, "..");
const e2eRoot = resolve(repoRoot, "var", "e2e");
const databasePath = resolve(Bun.env.E2E_DATABASE_PATH ?? resolve(e2eRoot, "wa-blast.db"));
const uploadsPath = resolve(Bun.env.E2E_UPLOADS_PATH ?? resolve(e2eRoot, "uploads"));
const gatewayKey = Bun.env.GATEWAY_ENCRYPTION_KEY ?? Buffer.from(new Uint8Array(32)).toString("base64url");

assertInsideE2eDirectory(databasePath);
assertInsideE2eDirectory(uploadsPath);
mkdirSync(dirname(databasePath), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
rmSync(uploadsPath, { recursive: true, force: true });
mkdirSync(uploadsPath, { recursive: true });

const config = loadConfig({
  ...Bun.env,
  APP_ENV: "test",
  APP_ORIGIN: "http://127.0.0.1:4173",
  DATABASE_PATH: databasePath,
  UPLOADS_PATH: uploadsPath,
  GATEWAY_ENCRYPTION_KEY: gatewayKey,
});
const db = openDatabase(config.databasePath);
migrate(db);
const clock = new SystemClock();
const ids = new UuidGenerator();
const auth = createAuthService({ db, clock, ids, config });
const admin = await bootstrapAdmin(auth, { email: E2E_ADMIN.email, displayName: "E2E Admin", password: E2E_ADMIN.password });
const operatorId = ids.next();
const now = clock.now().toISOString();
const operatorHash = await Bun.password.hash(E2E_OPERATOR.password, { algorithm: "argon2id" });

db.query(
  `INSERT INTO users
    (id, organization_id, email, display_name, role, password_hash,
     must_change_password, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'operator', ?, 0, 'active', ?, ?)`,
).run(operatorId, admin.organizationId, E2E_OPERATOR.email, "E2E Operator", operatorHash, now, now);

const vault = new CredentialVault(config.gatewayEncryptionKey);
const encryptedConfig = await vault.encrypt({ mode: "e2e", webhookSecret: "e2e-webhook-secret" });
db.query(
  `INSERT INTO gateway_connections
    (id, organization_id, name, adapter_type, sender_identity, encrypted_config,
     messages_per_minute, enabled, health_status, last_health_checked_at,
     created_at, updated_at)
   VALUES (?, ?, ?, 'mock', ?, ?, 120, 1, 'healthy', ?, ?, ?)`,
).run(E2E_GATEWAY_ID, admin.organizationId, "E2E Mock Gateway", "+15550000001", encryptedConfig, now, now, now);

const suppressedContactId = ids.next();
const suppressedPhone = "+628111111111";
db.query(
  `INSERT INTO contacts
    (id, organization_id, phone_display, phone_e164, name, attributes_json,
     status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, '{}', 'active', ?, ?)`,
).run(suppressedContactId, admin.organizationId, "081111111111", suppressedPhone, "Suppressed contact", now, now);
db.query(
  "INSERT INTO contact_consents (id, contact_id, source, consent_at, created_at) VALUES (?, ?, ?, ?, ?)",
).run(ids.next(), suppressedContactId, "e2e_seed", now, now);
db.query(
  "INSERT INTO suppressions (id, contact_id, reason, suppressed_at, actor_user_id) VALUES (?, ?, ?, ?, ?)",
).run(ids.next(), suppressedContactId, "e2e_seed_suppression", now, admin.id);

console.info(JSON.stringify({ event: "e2e_seeded", databasePath, uploadsPath, admin: E2E_ADMIN.email, operator: E2E_OPERATOR.email, gatewayId: E2E_GATEWAY_ID }));
db.close();

function assertInsideE2eDirectory(path: string): void {
  const root = `${e2eRoot}${sep}`;
  if (!path.startsWith(root)) throw new Error(`E2E path must remain inside ${e2eRoot}`);
}
