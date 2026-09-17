# WhatsApp Blast MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the approved single-organization WhatsApp campaign MVP from workspace scaffold through a deployable API, worker, and admin application.

**Architecture:** Use a Bun workspace containing a React/Vite admin app, a Bun/Hono modular monolith with separate API and worker entry points, and a shared contracts package. Persist application state and the durable delivery queue in SQLite through explicit SQL migrations and `bun:sqlite`; isolate external providers behind a gateway adapter and use a deterministic mock adapter for the MVP.

**Tech Stack:** Bun 1.4.2+, TypeScript, React, Vite, Tailwind CSS, shadcn/ui, Hono, Zod, `bun:sqlite`, Bun test, Testing Library with Happy DOM, and Playwright.

---

## Execution Rules

- Read `CONTEXT.md`, both ADRs, and the approved design before each task.
- Work in a dedicated feature worktree.
- Use `@superpowers:test-driven-development` for every behavior change.
- Use `@shadcn`, `@interface-design`, and `@vercel-react-best-practices` for web work.
- Use `@playwright-best-practices` for browser tests.
- Keep commits task-scoped and do not combine unrelated cleanup.
- Run `bun test`, `bun run typecheck`, and `bun run build` before each task is considered complete.
- Do not add a production gateway adapter until the provider and its contract are supplied.

## Validated References

- Bun workspaces: https://bun.sh/docs/pm/workspaces
- Bun test runner: https://bun.sh/docs/test
- Bun SQLite: https://bun.sh/docs/runtime/sqlite
- Bun password hashing: https://bun.sh/docs/runtime/hashing
- Bun CSRF: https://bun.sh/docs/runtime/csrf
- Hono on Bun: https://hono.dev/docs/getting-started/bun
- Vite: https://vite.dev/guide/
- shadcn/ui for Vite: https://ui.shadcn.com/docs/installation/vite
- Playwright: https://playwright.dev/docs/intro

### Task 1: Scaffold the Bun workspace and health seam

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/api-entry.ts`
- Create: `apps/server/src/worker-entry.ts`
- Create: `apps/server/src/app.test.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/index.ts`
- Create through Vite: `apps/web/**`
- Modify after scaffold: `apps/web/package.json`
- Modify after scaffold: `apps/web/vite.config.ts`
- Modify after scaffold: `apps/web/tsconfig.app.json`
- Create: `.github/workflows/ci.yml`

**Step 1: Create the root workspace manifest**

Use this root manifest:

```json
{
  "name": "wa-blast",
  "private": true,
  "packageManager": "bun@1.4.2",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:web": "bun --filter @wa-blast/web dev",
    "dev:api": "bun --filter @wa-blast/server dev:api",
    "dev:worker": "bun --filter @wa-blast/server dev:worker",
    "test": "bun test",
    "typecheck": "bun run --parallel --filter '*' typecheck",
    "build": "bun run --sequential --filter '*' build",
    "check": "bun run typecheck && bun test && bun run build"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

Create a base TypeScript configuration with strict mode, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and path-independent ESM settings.

**Step 2: Scaffold the packages**

Run:

```bash
bun create vite@latest apps/web --template react-ts
bun install
```

Set package names to `@wa-blast/web`, `@wa-blast/server`, and
`@wa-blast/contracts`. Make the contracts package export TypeScript source:

```json
{
  "name": "@wa-blast/contracts",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit"
  }
}
```

Configure the server package with:

```json
{
  "name": "@wa-blast/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:api": "bun --watch src/api-entry.ts",
    "dev:worker": "bun --watch src/worker-entry.ts",
    "migrate": "bun src/cli/migrate.ts",
    "bootstrap-admin": "bun src/cli/bootstrap-admin.ts",
    "typecheck": "tsc --noEmit",
    "build": "bun build src/api-entry.ts src/worker-entry.ts --outdir dist --target bun"
  }
}
```

Ensure the web package has:

```json
{
  "name": "@wa-blast/web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc -b",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

Configure Vite to proxy `/api` to `http://127.0.0.1:3000` during development.
Production remains same-origin through Nginx.

Install the initial dependencies:

```bash
bun add --filter @wa-blast/server hono zod @hono/zod-validator
bun add --filter @wa-blast/server @wa-blast/contracts@workspace:*
bun add --filter @wa-blast/web @wa-blast/contracts@workspace:*
bun add --filter @wa-blast/web react-router @tanstack/react-query
bun add --filter @wa-blast/web react-hook-form @hookform/resolvers zod
```

From `apps/web`, initialize Tailwind and shadcn/ui using the current Vite
instructions, then add these primitives:

```bash
bunx --bun shadcn@latest init
bunx --bun shadcn@latest add button input label card dialog dropdown-menu
bunx --bun shadcn@latest add table tabs badge alert skeleton tooltip
bunx --bun shadcn@latest add sidebar form select textarea separator
```

Use neutral surfaces, emerald for healthy/success states, amber for warnings,
red for failures, and blue for primary commands. Do not use gradients, decorative
orbs, nested cards, or radius above 8px.

**Step 3: Write the failing health test**

```ts
import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

describe("GET /api/health", () => {
  test("reports the API as healthy", async () => {
    const response = await createApp().request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "api",
    });
  });
});
```

Run:

```bash
bun test apps/server/src/app.test.ts
```

Expected: FAIL because `createApp` does not exist.

**Step 4: Implement the contracts and minimal Hono app**

Define the shared health schema in `packages/contracts/src/health.ts`:

```ts
import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
```

Implement `createApp()` as a factory that returns a Hono application. Keep
`Bun.serve` only in `api-entry.ts` so integration tests can call `app.request()`
without opening a port.

`worker-entry.ts` should start with a no-op loop that logs a structured startup
event and exits cleanly on `SIGTERM`; real delivery behavior arrives in Task 9.

**Step 5: Add environment examples**

Create `.env.example` with non-secret placeholders:

```dotenv
APP_ENV=development
APP_ORIGIN=http://localhost:5173
API_HOST=127.0.0.1
API_PORT=3000
DATABASE_PATH=./var/data/wa-blast.db
UPLOADS_PATH=./var/uploads
DEFAULT_PHONE_COUNTRY=ID
ORGANIZATION_TIME_ZONE=Asia/Jakarta
SESSION_TTL_HOURS=12
SESSION_COOKIE_SECURE=false
GATEWAY_ENCRYPTION_KEY=
```

**Step 6: Add CI**

The GitHub Actions workflow must:

1. Check out the repository.
2. Install the Bun version from `packageManager`.
3. Run `bun install --frozen-lockfile`.
4. Run `bun run check`.

**Step 7: Verify**

Run:

```bash
bun test apps/server/src/app.test.ts
bun run typecheck
bun run build
```

Expected: all commands exit with code 0.

**Step 8: Commit**

```bash
git add package.json bun.lock tsconfig.base.json .env.example apps packages .github
git commit -m "chore: scaffold Bun workspace"
```

### Task 2: Add the SQLite migration and integration-test harness

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/db/database.ts`
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/db/migrations/0001_core.sql`
- Create: `apps/server/src/db/database.test.ts`
- Create: `apps/server/src/cli/migrate.ts`
- Create: `apps/server/src/test/create-test-context.ts`
- Create: `apps/server/src/shared/clock.ts`
- Create: `apps/server/src/shared/id.ts`

**Step 1: Write the failing migration test**

The test must create a temporary directory, open a real SQLite file, run
migrations twice, and assert:

- `schema_migrations` contains `0001_core`.
- `organizations`, `users`, `sessions`, `login_attempts`, and `audit_entries`
  exist.
- foreign keys are enabled.
- running migrations twice is idempotent.

```ts
test("applies core migrations exactly once", () => {
  using context = createTestContext();

  migrate(context.db);
  migrate(context.db);

  expect(context.migrationNames()).toEqual(["0001_core"]);
  expect(context.tableNames()).toContain("users");
});
```

Run:

```bash
bun test apps/server/src/db/database.test.ts
```

Expected: FAIL because the database harness does not exist.

**Step 2: Implement the database factory**

`openDatabase(path)` must:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Do not export a process-global database from module scope. The API, worker, CLI,
and tests must receive a database instance through dependency construction.

**Step 3: Implement the migration runner**

Create `schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`.
Discover `.sql` files in lexical order and apply each migration in one
transaction. Record the migration only after all its statements succeed.

Add the migration CLI behind the `migrate` package script created in Task 1.

The first migration creates:

```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0
    CHECK (must_change_password IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, email)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  reauthenticated_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  details_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_entries_org_created_idx
  ON audit_entries (organization_id, created_at DESC);
```

**Step 4: Add deterministic shared dependencies**

Define:

```ts
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
```

Production uses the system clock and UUIDs. Tests use a fixed clock and
deterministic IDs.

**Step 5: Implement the test context**

`createTestContext()` must own and dispose:

- a temporary directory
- SQLite database
- fixed clock
- deterministic ID generator

Use it as the shared integration seam for subsequent server tests.

**Step 6: Verify and commit**

Run:

```bash
bun test apps/server/src/db/database.test.ts
bun test
bun run typecheck
```

Expected: all commands pass.

```bash
git add apps/server/src
git commit -m "feat(server): add SQLite migration harness"
```

### Task 3: Deliver authentication, authorization, and the admin shell

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/audit/audit-service.ts`
- Create: `apps/server/src/modules/auth/auth-service.ts`
- Create: `apps/server/src/modules/auth/auth-routes.ts`
- Create: `apps/server/src/modules/auth/auth-middleware.ts`
- Create: `apps/server/src/modules/auth/session-cookie.ts`
- Create: `apps/server/src/modules/auth/auth.integration.test.ts`
- Create: `apps/server/src/cli/bootstrap-admin.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/features/auth/auth-provider.tsx`
- Create: `apps/web/src/features/auth/login-page.tsx`
- Create: `apps/web/src/features/auth/login-page.test.tsx`
- Create: `apps/web/src/features/auth/change-password-page.tsx`
- Create: `apps/web/src/features/auth/change-password-page.test.tsx`
- Create: `apps/web/src/layouts/admin-layout.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write failing API integration tests**

Cover:

1. Bootstrap creates the one organization and first admin.
2. Duplicate bootstrap refuses to replace the existing admin.
3. Invalid email and invalid password return the same generic `401` response.
4. Repeated failures produce `429` for the email/IP key.
5. Valid login returns a session cookie without exposing the session token in
   JSON.
6. `/api/auth/me` resolves the current user.
7. `/api/auth/csrf` returns a token bound to the current session.
8. A mutation without `X-CSRF-Token` is rejected.
9. Logout invalidates the database session.
10. Disabled users cannot create new sessions.
11. A user marked `must_change_password` can access only session and password
    change routes until the password is replaced.

Run:

```bash
bun test apps/server/src/modules/auth/auth.integration.test.ts
```

Expected: FAIL because auth routes do not exist.

**Step 2: Implement password and session behavior**

- Hash passwords with `Bun.password.hash(password, { algorithm: "argon2id" })`.
- Require at least 12 characters for bootstrap and password changes.
- Generate 32 random bytes for the raw session token.
- Store only its SHA-256 hash in SQLite.
- Use a 32-byte random `csrf_secret`.
- Generate and verify CSRF tokens through `Bun.CSRF`, bound to `session.id`.
- Rotate the session after login and reauthentication.
- Delete expired sessions when they are encountered.
- Update `last_seen_at` at a throttled interval, not on every request.
- Clear `must_change_password` only after a successful authenticated password
  change.

Production cookie:

```text
__Host-session=<opaque-token>; Path=/; Secure; HttpOnly; SameSite=Strict
```

Development and tests may use `session` when secure cookies are disabled.

**Step 3: Implement authorization helpers**

Expose middleware with these explicit outcomes:

```ts
requireUser()
requireRole("admin")
requireRecentAuthentication({ maxAgeMinutes: 15 })
requireCsrf()
```

Return `401` for no valid session and `403` for an authenticated user lacking
permission.

**Step 4: Implement the bootstrap CLI**

Run:

```bash
bun --filter @wa-blast/server bootstrap-admin \
  --email admin@example.com \
  --name "Initial Admin"
```

Read the password interactively or from a one-time environment variable. Never
accept it as a command-line argument because process lists can expose arguments.

**Step 5: Write the failing web tests**

Test:

- login form labels and validation
- generic invalid-login message
- successful login redirects to `/dashboard`
- temporary-password login redirects to `/change-password`
- password change clears the forced-change state and rotates the session
- unauthenticated routes redirect to `/login`
- sidebar hides Users and Gateways from operators

Run:

```bash
bun test apps/web/src/features/auth/login-page.test.tsx
```

Expected: FAIL because the auth UI does not exist.

**Step 6: Build the app shell**

Use React Router declarative mode and TanStack Query. The application shell
contains:

- responsive sidebar with Lucide icons
- top bar with organization and user menu
- stable content width and table layout
- desktop and mobile navigation
- status-aware focus and error states

Do not show instructional marketing text. The first authenticated screen is the
working dashboard shell.

**Step 7: Verify and commit**

Run:

```bash
bun test apps/server/src/modules/auth/auth.integration.test.ts
bun test apps/web/src/features/auth/login-page.test.tsx
bun run check
```

Expected: all commands pass.

```bash
git add apps packages
git commit -m "feat(auth): add secure admin sessions"
```

### Task 4: Deliver contacts, consent, CSV import, and suppression

**Files:**
- Create: `apps/server/src/db/migrations/0002_contacts.sql`
- Create: `packages/contracts/src/contacts.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/contacts/phone.ts`
- Create: `apps/server/src/modules/contacts/csv-import.ts`
- Create: `apps/server/src/modules/contacts/contact-service.ts`
- Create: `apps/server/src/modules/contacts/contact-routes.ts`
- Create: `apps/server/src/modules/contacts/contacts.integration.test.ts`
- Create: `apps/web/src/features/contacts/contacts-page.tsx`
- Create: `apps/web/src/features/contacts/contact-dialog.tsx`
- Create: `apps/web/src/features/contacts/import-dialog.tsx`
- Create: `apps/web/src/features/contacts/suppression-dialog.tsx`
- Create: `apps/web/src/features/contacts/contacts-page.test.tsx`

**Step 1: Add dependencies**

```bash
bun add --filter @wa-blast/server csv-parse libphonenumber-js
```

**Step 2: Write failing integration tests**

Cover:

- Indonesian local numbers normalize to E.164 using `DEFAULT_PHONE_COUNTRY=ID`.
- Invalid numbers are rejected with row-level errors.
- Manual contact creation requires consent source and consent timestamp.
- Import preview reports valid, invalid, duplicate, and suppressed rows.
- Import commit is atomic for accepted rows and records an import audit entry.
- Re-import updates permitted contact fields but never clears suppression.
- An operator cannot lift suppression.
- An admin can suppress and lift suppression with a reason.
- Contact listing supports search, tags, status, and cursor pagination.

Use this accepted CSV shape:

```csv
phone,name,consent_source,consent_at,tags,department
081234567890,Ani,event-registration,2026-09-01T09:00:00+07:00,"customer,vip",Finance
```

Unknown columns become contact attributes after safe header normalization.

**Step 3: Add the contacts migration**

Create:

- `contacts`
- `contact_consents`
- `suppressions`
- `tags`
- `contact_tags`
- `contact_imports`
- `contact_import_rows`

Store normalized phone separately from display input. Make normalized phone
unique within the organization. Model consent and suppression as history, with
active suppression defined by `lifted_at IS NULL`.

**Step 4: Implement the service boundary**

The route layer may call only these high-level operations:

```ts
createContact(input, actor)
previewContactImport(file, actor)
commitContactImport(previewId, actor)
listContacts(query, actor)
suppressContact(contactId, reason, actor)
liftSuppression(contactId, reason, actor)
```

The service owns transactions and audit entries. Do not let routes compose SQL
operations.

**Step 5: Write failing UI tests**

Test:

- table filters do not resize the toolbar
- CSV preview separates accepted and rejected rows
- suppression is visually distinct from missing consent
- only admins see the lift-suppression command
- long names and phone numbers do not overflow cells

**Step 6: Build the contacts UI**

Use a dense data table with status badges, a search field, tag/status filters,
and icon buttons with tooltips for row actions. Use dialogs for manual contact,
CSV import, and suppression changes. Avoid cards around the page section.

**Step 7: Verify and commit**

```bash
bun test apps/server/src/modules/contacts
bun test apps/web/src/features/contacts
bun run check
git add apps packages
git commit -m "feat(contacts): add consented contact management"
```

### Task 5: Deliver gateway connection management and the mock adapter

**Files:**
- Create: `apps/server/src/db/migrations/0003_gateways.sql`
- Create: `packages/contracts/src/gateways.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/gateways/gateway-adapter.ts`
- Create: `apps/server/src/modules/gateways/gateway-registry.ts`
- Create: `apps/server/src/modules/gateways/credential-vault.ts`
- Create: `apps/server/src/modules/gateways/mock-gateway-adapter.ts`
- Create: `apps/server/src/modules/gateways/gateway-service.ts`
- Create: `apps/server/src/modules/gateways/gateway-routes.ts`
- Create: `apps/server/src/modules/gateways/gateways.integration.test.ts`
- Create: `apps/server/src/modules/gateways/gateway-contract.test.ts`
- Create: `apps/web/src/features/gateways/gateways-page.tsx`
- Create: `apps/web/src/features/gateways/gateway-dialog.tsx`
- Create: `apps/web/src/features/gateways/gateways-page.test.tsx`

**Step 1: Define the gateway contract in a failing contract test**

```ts
export interface GatewayAdapter {
  readonly type: string;

  validateConnection(
    connection: GatewayConnectionConfig,
  ): Promise<GatewayValidationResult>;

  checkHealth(
    connection: GatewayConnectionConfig,
  ): Promise<GatewayHealth>;

  sendMessage(
    command: SendMessageCommand,
  ): Promise<SendMessageResult>;

  normalizeWebhook(
    request: GatewayWebhookRequest,
  ): Promise<NormalizedGatewayEvent[]>;
}
```

The shared contract suite must verify:

- a healthy connection validates
- duplicate idempotency keys do not produce a second mock send
- text and one attachment are accepted
- scripted transient and permanent failures are classified
- webhook payloads normalize to canonical delivery statuses

Run:

```bash
bun test apps/server/src/modules/gateways/gateway-contract.test.ts
```

Expected: FAIL because the adapter does not exist.

**Step 2: Add gateway persistence**

The migration creates `gateway_connections` with:

- identity and display name
- adapter type
- sender identity
- encrypted configuration
- configurable messages per minute
- enabled flag
- health status and last health check
- consecutive failure count and `unhealthy_until`
- `next_send_at` for persisted pacing

**Step 3: Implement credential encryption**

- Require a base64-encoded 32-byte `GATEWAY_ENCRYPTION_KEY`.
- Use Web Crypto AES-256-GCM.
- Generate a unique 96-bit IV for each encryption.
- Store version, IV, authentication tag/ciphertext, and algorithm metadata.
- Never return decrypted configuration from route responses.

Test round trips, wrong-key failures, tamper detection, and masked API output.

**Step 4: Implement admin-only routes**

Provide:

- list connections
- create/update connection
- enable/disable connection
- check health
- send test message

Creation and secret changes require recent authentication. Every mutation
creates an audit entry.

**Step 5: Build the gateways UI**

Show a compact table with connection name, sender identity, adapter, rate
limit, enabled state, and health. Use a status icon plus text, not color alone.
Never place raw secrets back into form inputs.

**Step 6: Verify and commit**

```bash
bun test apps/server/src/modules/gateways
bun test apps/web/src/features/gateways
bun run check
git add apps packages
git commit -m "feat(gateways): add mock gateway connections"
```

### Task 6: Deliver message templates and authenticated attachments

**Files:**
- Create: `apps/server/src/db/migrations/0004_templates.sql`
- Create: `packages/contracts/src/templates.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/templates/template-variables.ts`
- Create: `apps/server/src/modules/templates/attachment-store.ts`
- Create: `apps/server/src/modules/templates/template-service.ts`
- Create: `apps/server/src/modules/templates/template-routes.ts`
- Create: `apps/server/src/modules/templates/templates.integration.test.ts`
- Create: `apps/web/src/features/templates/templates-page.tsx`
- Create: `apps/web/src/features/templates/template-editor.tsx`
- Create: `apps/web/src/features/templates/template-preview.tsx`
- Create: `apps/web/src/features/templates/template-editor.test.tsx`

**Step 1: Add the file-signature dependency**

```bash
bun add --filter @wa-blast/server file-type
```

**Step 2: Write failing tests**

Cover:

- variables use `{{variable_name}}`
- malformed or nested expressions are rejected
- preview reports missing contact attributes
- only one attachment may belong to a template
- accepted formats are JPEG, PNG, PDF, and common office documents
- maximum attachment size is configurable and defaults to 10 MiB
- MIME type is verified from file content where signatures exist
- storage names are random and never derived directly from user filenames
- attachment download requires authentication and organization ownership
- deleting a referenced attachment is rejected

**Step 3: Add template persistence**

Create:

- `attachments`
- `message_templates`

Store attachment metadata and a relative storage key, never an absolute path.
Template bodies are plain text with the constrained variable syntax; do not
embed an executable template engine.

**Step 4: Implement safe storage**

The storage abstraction exposes:

```ts
put(file): Promise<StoredAttachment>
open(storageKey): Promise<Blob>
remove(storageKey): Promise<void>
```

Resolve every storage key beneath `UPLOADS_PATH` and reject traversal. Keep
uploads outside the web root. Stream authenticated downloads through the API.

**Step 5: Build the templates UI**

Use a two-column editor on wide screens and stacked layout on mobile. The
preview must show real sample values, missing variables, attachment metadata,
and final character count. Keep the primary editing experience unframed rather
than nesting it in multiple cards.

**Step 6: Verify and commit**

```bash
bun test apps/server/src/modules/templates
bun test apps/web/src/features/templates
bun run check
git add apps packages
git commit -m "feat(templates): add personalized message templates"
```

### Task 7: Deliver campaign drafting, audience selection, and preview

**Files:**
- Create: `apps/server/src/db/migrations/0005_campaign_drafts.sql`
- Create: `packages/contracts/src/campaigns.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/campaigns/campaign-state.ts`
- Create: `apps/server/src/modules/campaigns/campaign-service.ts`
- Create: `apps/server/src/modules/campaigns/campaign-routes.ts`
- Create: `apps/server/src/modules/campaigns/campaigns.integration.test.ts`
- Create: `apps/web/src/features/campaigns/campaigns-page.tsx`
- Create: `apps/web/src/features/campaigns/campaign-editor.tsx`
- Create: `apps/web/src/features/campaigns/audience-step.tsx`
- Create: `apps/web/src/features/campaigns/content-step.tsx`
- Create: `apps/web/src/features/campaigns/schedule-step.tsx`
- Create: `apps/web/src/features/campaigns/review-step.tsx`
- Create: `apps/web/src/features/campaigns/campaign-editor.test.tsx`

**Step 1: Define the state machine test**

Test the allowed transitions exactly:

```text
draft -> pending_approval
pending_approval -> draft
pending_approval -> approved
approved/scheduled -> draft (reopen before any job is claimed)
approved -> scheduled | queued
scheduled -> queued
queued -> running
running -> completed | completed_with_failures
draft/pending_approval/approved/scheduled/queued/running -> cancelled
```

An approved or scheduled campaign may be reopened only while every job is
unclaimed. Reopening returns it to `draft` and removes approval metadata,
recipient snapshots, and pending jobs in one transaction. Queued or running
campaigns are immutable and must be cancelled or duplicated.

**Step 2: Add draft persistence**

Create:

- `campaigns`
- `campaign_contacts`

Persist campaign name, gateway connection, template, schedule in UTC, draft
audience membership, state, version, submitter, approver, and timestamps. Use
optimistic version checks to prevent two browser tabs from silently overwriting
each other.

**Step 3: Write failing integration tests**

Cover:

- operator can create and edit a draft
- disabled/unhealthy gateway produces an explicit preview warning
- audience selection can use individual contacts and tag filters
- preview separates eligible, suppressed, missing-consent, invalid, and
  missing-variable contacts
- schedule input is converted to UTC and returned with the organization time
  zone
- submit succeeds only when all selected recipients are eligible
- admin and operator may submit; only admin may approve in Task 8

**Step 4: Implement the campaign service**

Expose high-level operations:

```ts
createDraft(input, actor)
updateDraft(campaignId, version, input, actor)
previewDraft(campaignId, actor)
submitForApproval(campaignId, version, actor)
cancelCampaign(campaignId, actor)
```

Preview must not write campaign recipients or jobs. It is advisory; approval
will repeat all eligibility checks transactionally.

**Step 5: Build the campaign editor**

Use a stable four-step workflow:

1. Campaign details and gateway
2. Audience
3. Message and schedule
4. Review and submit

Use a stepper with icons and text, not pill-shaped decorative controls. Keep
counts visible while moving between steps. Warn before abandoning dirty edits.

**Step 6: Verify and commit**

```bash
bun test apps/server/src/modules/campaigns
bun test apps/web/src/features/campaigns
bun run check
git add apps packages
git commit -m "feat(campaigns): add campaign drafting and preview"
```

### Task 8: Deliver approval, immutable recipients, and message jobs

**Files:**
- Create: `apps/server/src/db/migrations/0006_campaign_approval.sql`
- Create: `apps/server/src/modules/campaigns/approval-service.ts`
- Create: `apps/server/src/modules/campaigns/approval.integration.test.ts`
- Create: `apps/web/src/features/campaigns/approval-dialog.tsx`
- Create: `apps/web/src/features/campaigns/campaign-detail-page.tsx`
- Create: `apps/web/src/features/campaigns/approval-dialog.test.tsx`
- Modify: `apps/server/src/modules/auth/auth-service.ts`
- Modify: `apps/server/src/modules/campaigns/campaign-routes.ts`

**Step 1: Write failing approval tests**

Cover:

- operator receives `403`
- stale session requires reauthentication
- current password reauthentication rotates the session and marks it recent
- approval rechecks consent and suppression inside the transaction
- approval freezes phone, name, attributes, rendered body, attachment metadata,
  gateway, and schedule
- approval creates exactly one message job per eligible recipient
- repeating the approval request cannot create duplicate jobs
- a contact suppressed between preview and approval is excluded and reported
- a concurrent draft edit causes a version conflict
- reopening an approved or scheduled campaign with only unclaimed jobs removes
  snapshots and jobs atomically
- reopening a queued, running, or partially sent campaign is rejected

**Step 2: Add approval persistence**

Create:

- `campaign_recipients`
- `message_jobs`

Required constraints:

```sql
UNIQUE (campaign_id, contact_id)
UNIQUE (campaign_recipient_id)
UNIQUE (idempotency_key)
```

Message jobs begin as `pending` with `available_at` equal to the approved
immediate time or scheduled time.

**Step 3: Implement one approval transaction**

The transaction must:

1. Lock campaign intent through an immediate transaction.
2. Re-read state and optimistic version.
3. Re-evaluate all audience eligibility.
4. Create immutable campaign recipient snapshots.
5. Render and store the final message body.
6. Create message jobs.
7. Record approval metadata and audit entry.
8. Move the campaign to `scheduled` or `queued`.

Any failure rolls back all eight actions.

**Step 4: Build the approval UI**

The admin sees:

- exact eligible and excluded counts
- representative personalized previews
- selected gateway and current health
- schedule in local time and UTC
- rate-limit estimate for total duration
- reauthentication prompt when required

Approval is an explicit command with a confirmation dialog. Do not use a
toggle for this irreversible transition.

**Step 5: Verify and commit**

```bash
bun test apps/server/src/modules/campaigns/approval.integration.test.ts
bun test apps/web/src/features/campaigns/approval-dialog.test.tsx
bun run check
git add apps
git commit -m "feat(campaigns): add admin approval and message jobs"
```

### Task 9: Deliver scheduling, atomic claiming, sending, and retry

**Files:**
- Create: `apps/server/src/db/migrations/0007_delivery.sql`
- Create: `apps/server/src/modules/delivery/job-repository.ts`
- Create: `apps/server/src/modules/delivery/error-classifier.ts`
- Create: `apps/server/src/modules/delivery/retry-policy.ts`
- Create: `apps/server/src/modules/delivery/scheduler.ts`
- Create: `apps/server/src/modules/delivery/worker.ts`
- Create: `apps/server/src/modules/delivery/worker.integration.test.ts`
- Modify: `apps/server/src/worker-entry.ts`
- Modify: `apps/server/src/modules/gateways/gateway-service.ts`

**Step 1: Write failing worker integration tests**

Drive the worker through a single exported `tick()` seam. Cover:

- scheduled campaigns become queued only when due
- only one worker lease can claim a job
- an expired lease becomes claimable
- gateway pacing persists across worker restarts
- mock success records one attempt and marks the job sent
- duplicate worker ticks do not produce duplicate sends
- transient failures retry at most three times
- permanent failures are terminal immediately
- retry timestamps follow configured exponential delays with deterministic test
  jitter
- repeated gateway failures open the circuit breaker
- cancellation prevents unclaimed jobs from sending
- graceful shutdown completes or releases the current lease
- worker heartbeat becomes unhealthy when ticks stop beyond the configured
  threshold

**Step 2: Add delivery persistence**

Create:

- `delivery_attempts`
- `delivery_events`
- `worker_heartbeats`

Extend message jobs with:

- status
- attempt count
- lease owner and expiry
- available time
- provider message ID
- last error category/code/message
- sent timestamp

**Step 3: Implement atomic job claiming**

Use an immediate transaction and one `UPDATE ... RETURNING` statement:

```sql
WITH candidates AS (
  SELECT id
  FROM message_jobs
  WHERE status IN ('pending', 'retry')
    AND available_at <= ?
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
  ORDER BY available_at, id
  LIMIT ?
)
UPDATE message_jobs
SET status = 'leased',
    lease_owner = ?,
    lease_expires_at = ?
WHERE id IN (SELECT id FROM candidates)
RETURNING *;
```

Filter cancelled campaigns before claiming and verify campaign state again
before sending.

**Step 4: Implement retry policy**

Use three total attempts with base delays:

```text
attempt 1 failure -> 30 seconds plus jitter
attempt 2 failure -> 2 minutes plus jitter
attempt 3 failure -> terminal
```

Keep the policy in one pure module. Tests inject deterministic jitter.

**Step 5: Persist rate limiting**

Store `next_send_at` on the gateway connection. Before each send, atomically
advance it based on `messages_per_minute`. This prevents a worker restart from
forgetting the pacing window.

**Step 6: Implement worker process behavior**

- Poll only when no work is immediately available.
- Bound batch size.
- Emit structured lifecycle logs with job, campaign, gateway, and correlation
  IDs.
- Never log recipient message content, raw credentials, or full phone numbers.
- Handle `SIGINT` and `SIGTERM`.

**Step 7: Verify and commit**

```bash
bun test apps/server/src/modules/delivery/worker.integration.test.ts
bun run check
git add apps/server
git commit -m "feat(delivery): add durable campaign worker"
```

### Task 10: Deliver authenticated webhooks and status projection

**Files:**
- Create: `packages/contracts/src/delivery.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/delivery/status-projector.ts`
- Create: `apps/server/src/modules/delivery/webhook-service.ts`
- Create: `apps/server/src/modules/delivery/webhook-routes.ts`
- Create: `apps/server/src/modules/delivery/webhooks.integration.test.ts`
- Create: `apps/web/src/features/campaigns/delivery-results.tsx`
- Create: `apps/web/src/features/campaigns/delivery-results.test.tsx`

**Step 1: Write failing webhook tests**

Cover:

- invalid gateway webhook authentication is rejected
- valid events are normalized through the selected adapter
- duplicate provider event IDs create one delivery event
- providers without event IDs use a stable fingerprint
- out-of-order `delivered` then `sent` does not regress status
- `read` outranks `delivered`
- unknown events are stored for diagnosis but do not corrupt status
- a terminal failed send cannot become sent without an explicit later provider
  event tied to the same provider message ID
- webhook processing returns quickly and is safe to retry

**Step 2: Implement the canonical projector**

Canonical statuses:

```text
pending
leased
sent
delivered
read
failed
cancelled
```

Keep raw provider event type and payload separately from the canonical status.
The projector is pure and independently tested.

**Step 3: Expose campaign results**

Provide summary and paginated recipient results:

- total
- pending
- sent
- delivered
- read
- failed
- cancelled
- retrying

Filters must support status and phone/name search without exposing full message
content in list responses.

**Step 4: Build delivery results UI**

Use a stable summary band and a detailed table. Provide downloadable CSV for
authorized users, generated by the server with spreadsheet-injection escaping.
Use status icon plus label and tabular numbers.

**Step 5: Verify and commit**

```bash
bun test apps/server/src/modules/delivery
bun test apps/web/src/features/campaigns/delivery-results.test.tsx
bun run check
git add apps packages
git commit -m "feat(delivery): add webhook status tracking"
```

### Task 11: Deliver dashboard, users, and audit history

**Files:**
- Create: `packages/contracts/src/dashboard.ts`
- Create: `packages/contracts/src/users.ts`
- Create: `packages/contracts/src/audit.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/dashboard/dashboard-service.ts`
- Create: `apps/server/src/modules/dashboard/dashboard-routes.ts`
- Create: `apps/server/src/modules/users/user-service.ts`
- Create: `apps/server/src/modules/users/user-routes.ts`
- Create: `apps/server/src/modules/audit/audit-routes.ts`
- Create: `apps/server/src/modules/dashboard/dashboard.integration.test.ts`
- Create: `apps/server/src/modules/users/users.integration.test.ts`
- Create: `apps/web/src/features/dashboard/dashboard-page.tsx`
- Create: `apps/web/src/features/users/users-page.tsx`
- Create: `apps/web/src/features/audit/audit-page.tsx`
- Create: `apps/web/src/features/dashboard/dashboard-page.test.tsx`

**Step 1: Write failing integration tests**

Cover:

- dashboard aggregates queue depth, oldest pending age, current campaigns,
  gateway health, and delivery rates
- an operator can view dashboard metrics but not users or the full audit log
- admin can create operator/admin users
- admin cannot disable the final active admin
- disabling a user invalidates all their sessions
- audit filtering supports actor, action, subject, and time window
- audit details redact encrypted configuration and password/session material

**Step 2: Implement dashboard queries**

Use direct aggregate SQL with appropriate indexes. Do not load all delivery
events into application memory. Return explicit empty states when no campaigns
exist.

**Step 3: Implement user management**

Admin-created users receive a generated temporary password that is returned
once and shared out of band. Set `must_change_password` so the user is
redirected to the password-change screen before normal application use. Record
create, role change, disable, and password reset actions.

**Step 4: Build the operational dashboard**

Include:

- queue depth and oldest job age
- campaigns requiring approval
- active campaign progress
- gateway health
- delivery outcome chart
- recent failures

Add the current chart primitive first:

```bash
cd apps/web
bunx --bun shadcn@latest add chart
```

Use shadcn chart primitives or their current underlying chart library. The
dashboard must remain legible at 1280x720 and on mobile, with no overlapping
labels or layout shifts.

**Step 5: Verify and commit**

```bash
bun test apps/server/src/modules/dashboard
bun test apps/server/src/modules/users
bun test apps/web/src/features/dashboard
bun run check
git add apps packages
git commit -m "feat(admin): add dashboard users and audit history"
```

### Task 12: Add end-to-end coverage and production VPS assets

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/campaign-lifecycle.spec.ts`
- Create: `e2e/authorization.spec.ts`
- Create: `e2e/responsive-layout.spec.ts`
- Create: `scripts/seed-e2e.ts`
- Create: `scripts/backup.sh`
- Create: `scripts/restore-check.sh`
- Create: `deploy/systemd/wa-blast-api.service`
- Create: `deploy/systemd/wa-blast-worker.service`
- Create: `deploy/nginx/wa-blast.conf`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/backup-and-restore.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Step 1: Install Playwright**

```bash
bun add -d @playwright/test
bunx playwright install chromium
```

Add root scripts:

```json
{
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui"
}
```

**Step 2: Write the failing campaign lifecycle test**

The browser test must:

1. Bootstrap and log in as an operator.
2. Import a CSV containing eligible, invalid, and suppressed contacts.
3. Create a message template.
4. Create a campaign with a mock gateway.
5. Confirm preview counts.
6. Submit for approval.
7. Log in as an admin.
8. Reauthenticate and approve.
9. Advance the deterministic worker.
10. Inject delivered/read webhooks.
11. Verify dashboard and recipient results.
12. Verify relevant audit entries.

Run:

```bash
bun run e2e --grep "campaign lifecycle"
```

Expected: FAIL until the full application is wired for browser execution.

**Step 3: Add authorization and responsive tests**

Test:

- operator cannot navigate to Users or Gateways
- direct forbidden URLs show a proper forbidden state
- campaign tables and dialogs fit 390x844, 768x1024, and 1440x900 viewports
- no horizontal page overflow
- no controls overlap at any viewport
- keyboard focus order and dialog focus trapping work
- browser console has no unexpected errors

Capture screenshots on failure. For the final visual QA run, inspect desktop and
mobile screenshots rather than trusting assertions alone.

**Step 4: Add VPS service definitions**

The API unit must:

- run under a dedicated unprivileged user
- load secrets from an environment file outside the repository
- set the working directory to the release path
- run `bun --filter @wa-blast/server migrate` as `ExecStartPre`
- restart on failure with a bounded delay
- expose only the local API port

The worker unit must:

- use the same release and environment
- start after the API migration command succeeds
- have a longer stop timeout for lease cleanup

Neither unit may run as root.

Run server TypeScript source directly with Bun from an immutable release
directory so SQL migration files remain available. Treat `bun run build` as a
release verification step; Nginx serves the built `apps/web/dist` assets.

**Step 5: Add Nginx configuration**

Configure:

- HTTPS-only public traffic
- static web assets with immutable caching for hashed files
- `/api/` and webhook forwarding to the local API
- request body size matching the attachment limit
- security headers appropriate for the application
- no direct access to database, uploads, or environment files

**Step 6: Add backup and restore verification**

`backup.sh` must use SQLite's online backup capability or a database-safe
snapshot, archive attachments, write checksums, and rotate daily/weekly
backups. `restore-check.sh` restores into a temporary directory, runs integrity
checks and migrations, verifies attachment checksums, and never overwrites the
live database.

Document:

- initial VPS setup
- directory ownership
- bootstrap admin
- migration and release sequence
- rollback
- backup schedule
- restore drill
- log and health inspection

**Step 7: Extend CI**

CI must run:

```bash
bun install --frozen-lockfile
bunx playwright install --with-deps chromium
bun run typecheck
bun test
bun run build
bun run e2e
```

Use a temporary SQLite path and mock gateway. Upload Playwright reports on
failure.

**Step 8: Final verification**

Run:

```bash
bun run check
bun run e2e
git diff --check
git status --short
```

Expected:

- unit and integration tests report zero failures
- Playwright reports zero failures
- typecheck and build exit with code 0
- `git diff --check` prints nothing
- working tree contains only the intended final changes

**Step 9: Commit**

```bash
git add .
git commit -m "chore: add VPS deployment and end-to-end verification"
```

## Final Acceptance Checklist

- An operator can import consented contacts without clearing suppression.
- An operator can create a personalized template with one safe attachment.
- An operator can create, preview, and submit a campaign.
- An admin must reauthenticate before approval.
- Approval creates immutable recipients and durable message jobs atomically.
- A separate worker sends through the mock adapter with pacing and bounded
  retry.
- Duplicate worker ticks and duplicate webhooks do not duplicate effects.
- Campaign results and audit history are visible according to role.
- The application passes unit, integration, browser, responsive, typecheck, and
  production build checks.
- The VPS deployment, backup, and restore procedures are documented and tested.
