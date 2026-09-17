import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { migrate } from "../db/migrate";
import { bootstrapAdmin, createAuthService } from "../modules/auth/auth-service";
import { SystemClock } from "../shared/clock";
import { UuidGenerator } from "../shared/id";

const args = new Map<string, string>();
for (let index = 0; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument?.startsWith("--")) {
    const value = process.argv[index + 1];
    if (value && !value.startsWith("--")) args.set(argument.slice(2), value);
  }
}

const email = args.get("email");
const displayName = args.get("name");
if (!email || !displayName) {
  throw new Error("usage: bootstrap-admin --email <email> --name <name>");
}

const password = Bun.env.BOOTSTRAP_ADMIN_PASSWORD ?? prompt("Admin password: ") ?? "";
const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);

try {
  const auth = createAuthService({
    db,
    clock: new SystemClock(),
    ids: new UuidGenerator(),
    config,
  });
  await bootstrapAdmin(auth, { email, displayName, password });
  console.info(JSON.stringify({ event: "admin_bootstrapped", email }));
} finally {
  db.close();
}
