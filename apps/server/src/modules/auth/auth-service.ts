import type { Database } from "bun:sqlite";
import type { AppConfig } from "../../config";
import { AuditService } from "../audit/audit-service";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { UserRole, UserSummary } from "@wa-blast/contracts";

const MIN_PASSWORD_LENGTH = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

interface UserRow {
  id: string;
  organization_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  must_change_password: number;
  status: "active" | "disabled";
  password_hash: string;
}

interface SessionRow extends UserRow {
  session_id: string;
  token_hash: string;
  csrf_secret: string;
  reauthenticated_at: string | null;
  expires_at: string;
}

export interface AuthDependencies {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  config: AppConfig;
}

export interface AuthSession {
  id: string;
  userId: string;
  organizationId: string;
  reauthenticatedAt: Date | null;
  expiresAt: Date;
  rawToken: string;
  csrfSecret: string;
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  summary: UserSummary;
  passwordHash: string;
}

export interface AuthContext {
  session: AuthSession;
  user: AuthenticatedUser;
}

export type LoginResult =
  | { kind: "success"; context: AuthContext }
  | { kind: "invalid" }
  | { kind: "throttled" };

export class AuthService {
  readonly audit: AuditService;

  constructor(private readonly dependencies: AuthDependencies) {
    this.audit = new AuditService(dependencies);
  }

  async bootstrapAdmin(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AuthenticatedUser> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const existing = this.dependencies.db
      .query("SELECT id FROM organizations LIMIT 1")
      .get();
    if (existing) throw new Error("organization_already_bootstrapped");

    const now = this.dependencies.clock.now().toISOString();
    const organizationId = this.dependencies.ids.next();
    const userId = this.dependencies.ids.next();
    const passwordHash = await Bun.password.hash(input.password, {
      algorithm: "argon2id",
    });

    const create = this.dependencies.db.transaction(() => {
      this.dependencies.db
        .query(
          "INSERT INTO organizations (id, name, time_zone, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          organizationId,
          "WhatsApp Blast",
          this.dependencies.config.organizationTimeZone,
          now,
        );
      this.dependencies.db
        .query(
          `INSERT INTO users
            (id, organization_id, email, display_name, role, password_hash,
             must_change_password, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'admin', ?, 0, 'active', ?, ?)`,
        )
        .run(
          userId,
          organizationId,
          email,
          input.displayName.trim(),
          passwordHash,
          now,
          now,
        );
      this.audit.record({
        organizationId,
        action: "organization.bootstrap",
        subjectType: "organization",
        subjectId: organizationId,
        details: { adminEmail: email },
      });
    });
    create();

    return {
      id: userId,
      organizationId,
      summary: {
        email,
        displayName: input.displayName.trim(),
        role: "admin",
        mustChangePassword: false,
      },
      passwordHash,
    };
  }

  async login(emailInput: string, password: string, ipAddress: string): Promise<LoginResult> {
    const email = normalizeEmail(emailInput);
    const now = this.dependencies.clock.now();
    const keys = [`email:${email}`, `ip:${ipAddress}`];
    if (keys.some((key) => this.isBlocked(key, now))) return { kind: "throttled" };

    const user = this.findUser(email);
    const valid = user && user.status === "active"
      ? await Bun.password.verify(password, user.password_hash)
      : false;
    if (!valid || !user) {
      for (const key of keys) this.recordFailure(key, now);
      return { kind: "invalid" };
    }

    for (const key of keys) this.clearFailures(key);
    return { kind: "success", context: await this.createSession(user) };
  }

  async resolveSession(rawToken: string | undefined): Promise<AuthContext | null> {
    if (!rawToken) return null;
    const tokenHash = await hashText(rawToken);
    const row = this.dependencies.db
      .query<SessionRow, [string]>(
        `SELECT s.id AS session_id, s.token_hash, s.csrf_secret,
                s.reauthenticated_at, s.expires_at,
                u.id, u.organization_id, u.email, u.display_name, u.role,
                u.must_change_password, u.status, u.password_hash
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash);
    if (!row) return null;

    const expiresAt = new Date(row.expires_at);
    if (expiresAt <= this.dependencies.clock.now() || row.status !== "active") {
      this.dependencies.db.query("DELETE FROM sessions WHERE id = ?").run(row.session_id);
      return null;
    }

    this.dependencies.db
      .query("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .run(this.dependencies.clock.now().toISOString(), row.session_id);

    return this.contextFromRow(row, rawToken);
  }

  async logout(context: AuthContext): Promise<void> {
    this.dependencies.db
      .query("DELETE FROM sessions WHERE id = ?")
      .run(context.session.id);
  }

  async csrfToken(context: AuthContext): Promise<string> {
    return hashText(`${context.session.id}:${context.session.csrfSecret}`);
  }

  async verifyCsrf(context: AuthContext, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const expected = await this.csrfToken(context);
    return timingSafeEqual(expected, token);
  }

  async changePassword(
    context: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthContext | null> {
    validatePassword(newPassword);
    const valid = await Bun.password.verify(currentPassword, context.user.passwordHash);
    if (!valid) return null;
    const passwordHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
    const now = this.dependencies.clock.now().toISOString();
    this.dependencies.db
      .query("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
      .run(passwordHash, now, context.user.id);
    this.audit.record({
      organizationId: context.user.organizationId,
      actorUserId: context.user.id,
      action: "user.password_changed",
      subjectType: "user",
      subjectId: context.user.id,
    });
    return this.rotateSession(context, true);
  }

  async reauthenticate(context: AuthContext, password: string): Promise<AuthContext | null> {
    const valid = await Bun.password.verify(password, context.user.passwordHash);
    if (!valid) return null;
    return this.rotateSession(context, true);
  }

  async hasRecentAuthentication(context: AuthContext, maxAgeMinutes: number): Promise<boolean> {
    const timestamp = context.session.reauthenticatedAt;
    return timestamp !== null
      && this.dependencies.clock.now().getTime() - timestamp.getTime() <= maxAgeMinutes * 60 * 1000;
  }

  private async createSession(user: UserRow, reauthenticatedAt: Date | null = null): Promise<AuthContext> {
    const rawToken = randomToken();
    const csrfSecret = randomToken();
    const now = this.dependencies.clock.now();
    const expiresAt = new Date(now.getTime() + this.dependencies.config.sessionTtlHours * 60 * 60 * 1000);
    const id = this.dependencies.ids.next();
    this.dependencies.db
      .query(
        `INSERT INTO sessions
          (id, user_id, token_hash, csrf_secret, reauthenticated_at,
           expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        await hashText(rawToken),
        csrfSecret,
        reauthenticatedAt?.toISOString() ?? null,
        expiresAt.toISOString(),
        now.toISOString(),
        now.toISOString(),
      );
    return {
      session: {
        id,
        userId: user.id,
        organizationId: user.organization_id,
        reauthenticatedAt,
        expiresAt,
        rawToken,
        csrfSecret,
      },
      user: userToAuthenticated(user),
    };
  }

  private async rotateSession(context: AuthContext, markReauthenticated: boolean): Promise<AuthContext> {
    this.dependencies.db.query("DELETE FROM sessions WHERE id = ?").run(context.session.id);
    const user = this.findUserById(context.user.id);
    if (!user) throw new Error("user_not_found");
    return this.createSession(
      user,
      markReauthenticated ? this.dependencies.clock.now() : context.session.reauthenticatedAt,
    );
  }

  private findUser(email: string): UserRow | null {
    return this.dependencies.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE email = ?")
      .get(email) ?? null;
  }

  private findUserById(id: string): UserRow | null {
    return this.dependencies.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
      .get(id) ?? null;
  }

  private contextFromRow(row: SessionRow, rawToken: string): AuthContext {
    return {
      session: {
        id: row.session_id,
        userId: row.id,
        organizationId: row.organization_id,
        reauthenticatedAt: row.reauthenticated_at ? new Date(row.reauthenticated_at) : null,
        expiresAt: new Date(row.expires_at),
        rawToken,
        csrfSecret: row.csrf_secret,
      },
      user: userToAuthenticated(row),
    };
  }

  private isBlocked(key: string, now: Date): boolean {
    const row = this.dependencies.db
      .query<{ window_started_at: string; blocked_until: string | null }, [string]>(
        "SELECT window_started_at, blocked_until FROM login_attempts WHERE key = ?",
      )
      .get(key);
    if (!row) return false;
    if (row.blocked_until && new Date(row.blocked_until) > now) return true;
    if (now.getTime() - new Date(row.window_started_at).getTime() > LOGIN_WINDOW_MS) {
      this.clearFailures(key);
    }
    return false;
  }

  private recordFailure(key: string, now: Date): void {
    const existing = this.dependencies.db
      .query<{ failures: number; window_started_at: string }, [string]>(
        "SELECT failures, window_started_at FROM login_attempts WHERE key = ?",
      )
      .get(key);
    const windowStart = existing && now.getTime() - new Date(existing.window_started_at).getTime() <= LOGIN_WINDOW_MS
      ? existing.window_started_at
      : now.toISOString();
    const failures = existing && windowStart === existing.window_started_at ? existing.failures + 1 : 1;
    const blockedUntil = failures >= MAX_LOGIN_FAILURES
      ? new Date(now.getTime() + LOGIN_BLOCK_MS).toISOString()
      : null;
    this.dependencies.db
      .query(
        `INSERT INTO login_attempts (key, failures, window_started_at, blocked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures,
           window_started_at = excluded.window_started_at,
           blocked_until = excluded.blocked_until`,
      )
      .run(key, failures, windowStart, blockedUntil);
  }

  private clearFailures(key: string): void {
    this.dependencies.db.query("DELETE FROM login_attempts WHERE key = ?").run(key);
  }
}

export function createAuthService(dependencies: AuthDependencies): AuthService {
  return new AuthService(dependencies);
}

export async function bootstrapAdmin(
  auth: AuthService,
  input: { email: string; displayName: string; password: string },
): Promise<AuthenticatedUser> {
  return auth.bootstrapAdmin(input);
}

function userToAuthenticated(user: UserRow): AuthenticatedUser {
  return {
    id: user.id,
    organizationId: user.organization_id,
    passwordHash: user.password_hash,
    summary: {
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      mustChangePassword: user.must_change_password === 1,
    },
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password_too_short");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
