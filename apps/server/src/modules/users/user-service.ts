import type { UserCreateRequest, UserRole, UserStatus, UserUpdateRequest } from "@wa-blast/contracts";
import type { Database } from "bun:sqlite";
import type { AppConfig } from "../../config";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { AuditService } from "../audit/audit-service";
import type { AuthContext } from "../auth/auth-service";

interface UserRow {
  id: string;
  organization_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  must_change_password: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface UserActor {
  userId: string;
  organizationId: string;
  role: UserRole;
}

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserMutationResult {
  user: UserView;
  temporaryPassword?: string;
}

interface UserServiceDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  ids: IdGenerator;
}

export class UserService {
  private readonly audit: AuditService;

  constructor(private readonly dependencies: UserServiceDependencies) {
    this.audit = new AuditService(dependencies);
  }

  listUsers(actor: UserActor): { users: UserView[] } {
    this.assertAdmin(actor);
    const rows = this.dependencies.db.query<UserRow, [string]>(
      "SELECT id, organization_id, email, display_name, role, must_change_password, status, created_at, updated_at FROM users WHERE organization_id = ? ORDER BY display_name, email, id",
    ).all(actor.organizationId);
    return { users: rows.map(toView) };
  }

  async createUser(input: UserCreateRequest, actor: UserActor): Promise<UserMutationResult> {
    this.assertAdmin(actor);
    const email = normalizeEmail(input.email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await Bun.password.hash(temporaryPassword, { algorithm: "argon2id" });
    const id = this.dependencies.ids.next();
    const now = this.dependencies.clock.now().toISOString();
    try {
      this.dependencies.db.query(
        `INSERT INTO users
          (id, organization_id, email, display_name, role, password_hash,
           must_change_password, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
      ).run(id, actor.organizationId, email, input.displayName.trim(), input.role, passwordHash, now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new UserInputError("email_already_exists");
      throw error;
    }
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "user.created", subjectType: "user", subjectId: id, details: { email, role: input.role } });
    return { user: this.getUser(id, actor.organizationId) as UserView, temporaryPassword };
  }

  updateUser(id: string, input: UserUpdateRequest, actor: UserActor): UserView {
    this.assertAdmin(actor);
    const existing = this.findUser(id, actor.organizationId);
    if (!existing) throw new UserInputError("user_not_found");
    const nextRole = input.role ?? existing.role;
    const nextStatus = input.status ?? existing.status;
    if (existing.status === "active" && existing.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
      this.assertNotFinalActiveAdmin(actor.organizationId);
    }
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query(
      "UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
    ).run(nextRole, nextStatus, now, id, actor.organizationId);
    if (nextStatus === "disabled") this.dependencies.db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
    if (nextRole !== existing.role) this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "user.role_changed", subjectType: "user", subjectId: id, details: { from: existing.role, to: nextRole } });
    if (nextStatus !== existing.status) this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: nextStatus === "disabled" ? "user.disabled" : "user.enabled", subjectType: "user", subjectId: id });
    return this.getUser(id, actor.organizationId) as UserView;
  }

  async resetPassword(id: string, actor: UserActor): Promise<UserMutationResult> {
    this.assertAdmin(actor);
    const existing = this.findUser(id, actor.organizationId);
    if (!existing) throw new UserInputError("user_not_found");
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await Bun.password.hash(temporaryPassword, { algorithm: "argon2id" });
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db.query("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ? AND organization_id = ?").run(passwordHash, now, id, actor.organizationId);
    this.dependencies.db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
    this.audit.record({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "user.password_reset", subjectType: "user", subjectId: id });
    return { user: this.getUser(id, actor.organizationId) as UserView, temporaryPassword };
  }

  private getUser(id: string, organizationId: string): UserView | null {
    const row = this.findUser(id, organizationId);
    return row ? toView(row) : null;
  }

  private findUser(id: string, organizationId: string): UserRow | null {
    return this.dependencies.db.query<UserRow, [string, string]>(
      "SELECT id, organization_id, email, display_name, role, must_change_password, status, created_at, updated_at FROM users WHERE id = ? AND organization_id = ?",
    ).get(id, organizationId) ?? null;
  }

  private assertAdmin(actor: UserActor): void {
    if (actor.role !== "admin") throw new UserInputError("forbidden");
  }

  private assertNotFinalActiveAdmin(organizationId: string): void {
    const count = this.dependencies.db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM users WHERE organization_id = ? AND role = 'admin' AND status = 'active'",
    ).get(organizationId)?.count ?? 0;
    if (count <= 1) throw new UserInputError("last_active_admin");
  }
}

export class UserInputError extends Error {
  constructor(readonly code: "forbidden" | "email_already_exists" | "user_not_found" | "last_active_admin") { super(code); }
}

export function userActorFromAuth(auth: AuthContext): UserActor {
  return { userId: auth.user.id, organizationId: auth.user.organizationId, role: auth.user.summary.role };
}

function toView(row: UserRow): UserView {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, status: row.status, mustChangePassword: row.must_change_password === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}
