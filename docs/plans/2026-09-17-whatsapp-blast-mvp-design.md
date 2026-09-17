# WhatsApp Blast MVP Design

**Status:** Approved

**Date:** 2026-09-17

## Goal

Build an internal admin application for preparing, approving, scheduling,
sending, and monitoring WhatsApp campaigns through an unofficial gateway API.
The MVP serves one organization, supports admin and operator roles, and targets
no more than 10,000 recipients per day on one VPS.

## Product Decisions

- One organization owns all application data.
- Operators prepare campaigns; admins approve and launch them.
- Contacts can be entered manually or imported from CSV.
- Consent evidence is required, and suppression always prevents delivery.
- Messages support personalized text and one optional image or document.
- Campaigns can be sent immediately or scheduled once.
- Multiple gateway connections are supported, but each campaign selects one.
- The first gateway implementation is a mock behind a provider-neutral adapter.
- Deployment is directly on one VPS without containers.

## Architecture

The repository uses a Bun workspace with three main areas:

```text
apps/web         React and Vite admin application
apps/server      Bun modular monolith with API and worker entry points
packages/contracts
                 Shared request, response, and validation contracts
```

The backend is organized by business capability:

- authentication and users
- contacts, consent, and suppression
- gateway connections
- message templates and attachments
- campaigns and approval
- delivery and webhook processing
- audit

The API and worker run as separate operating-system services. They share the
same domain modules and SQLite database. The API remains responsive when the
worker is processing a large campaign, and restarting the API does not stop
delivery work.

SQLite runs in WAL mode. Only one worker instance is supported by the MVP.
Runtime database files and uploaded attachments live outside the source tree.

## Domain Model

The canonical vocabulary is recorded in `CONTEXT.md`.

Important relationships:

- An organization has many users, contacts, gateway connections, templates,
  campaigns, and audit entries.
- A contact has consent history and can be covered by an active suppression.
- A campaign selects one gateway connection and one message template.
- Approval creates immutable campaign recipient snapshots.
- Each campaign recipient owns one message job.
- A message job can have multiple delivery attempts and delivery events.

Important invariants:

- Phone numbers are normalized and unique within the organization.
- A contact without valid consent cannot become a campaign recipient.
- Suppression overrides consent and cannot be cleared by re-importing a contact.
- Campaign recipients and personalization values are frozen at approval.
- An approved or scheduled campaign can be reopened only before any job is
  claimed; reopening invalidates approval and removes recipient snapshots and
  pending jobs in one transaction. Queued or running campaigns are immutable
  and must be cancelled or duplicated.
- Every message job has an idempotency key.
- Delivery events are append-only.
- Approval, cancellation, import, role, gateway, consent, and suppression
  changes create audit entries.

## Campaign Lifecycle

```text
draft -> pending_approval -> approved
approved -> scheduled | queued
approved/scheduled -> draft (reopen before any job is claimed)
scheduled -> queued -> running
running -> completed | completed_with_failures
draft/pending_approval/approved/scheduled/queued/running -> cancelled
```

Only an operator or admin can create and submit a campaign. Only an admin can
approve it. Cancellation stops jobs that have not been claimed; already-sent
messages cannot be recalled.

## Gateway Boundary

The gateway adapter exposes four capabilities:

```text
validate connection
check health
send message
normalize webhook
```

Provider-specific status values and errors are translated into application
delivery events and error categories. Provider credentials and payload formats
must not leak into campaign or UI modules.

The mock adapter can produce success, timeout, transient failure, permanent
failure, and delayed webhook scenarios. A real adapter must pass the same
contract tests before it can be enabled.

## Delivery Flow

1. An operator creates a campaign and selects its gateway, template,
   attachment, and contacts.
2. The API validates consent, suppression, variables, attachment, and gateway
   health.
3. The operator submits the campaign for approval.
4. An admin reviews the preview and recipient summary.
5. Approval freezes campaign recipients and creates message jobs in one
   transaction.
6. The scheduler queues campaigns whose scheduled time has arrived.
7. The worker atomically claims jobs and applies the gateway rate limit.
8. The adapter sends each message using its idempotency key.
9. Synchronous responses and asynchronous webhooks become delivery events.
10. The dashboard displays projected current delivery status.

## Failure Handling

- Network errors, timeouts, and rate limiting are transient.
- Invalid numbers, suppression, and explicit permanent rejection are terminal.
- Transient failures receive at most three attempts.
- Retry delay uses exponential backoff with jitter.
- Webhooks are deduplicated by provider event ID or an internal fingerprint.
- A circuit breaker stops claims for a gateway after repeated failures.
- Unknown webhook events are retained for diagnosis instead of discarded.
- Jobs abandoned by a stopped worker become claimable after their lease expires.

## Admin Experience

The web application contains:

- Dashboard for gateway health, active campaigns, queue depth, and delivery
  results.
- Contacts for manual entry, CSV import, consent, tags, and suppression.
- Templates for personalized text and one optional attachment.
- Campaigns for drafting, preview, approval, scheduling, progress, and results.
- Gateways for connection configuration, health, rate limits, and test sends.
- Users for admin and operator management.
- Audit Log for sensitive actions and state changes.

The interface is optimized for dense operational work, clear status comparison,
and explicit confirmation before approval or cancellation.

## Authorization

Operators can:

- manage contacts, consent evidence, templates, and draft campaigns
- submit campaigns for approval
- view delivery results

Admins can perform all operator actions and can also:

- manage users and gateway connections
- approve and cancel campaigns
- manage suppression
- view all audit entries

There is no public registration. The first admin is created by a bootstrap
command on the VPS.

## Authentication and Security

- Authentication uses email and password.
- Password hashing uses `Bun.password` with Argon2id.
- Login responses are generic and failed attempts are throttled.
- Sessions are opaque, stored server-side, and delivered through a
  `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
- Mutating requests require CSRF protection.
- Approval and gateway changes require recent authentication.
- HTTPS is mandatory at the reverse proxy.
- Gateway credentials are encrypted at rest using a master key supplied by the
  VPS environment.
- Credentials are masked in the API and UI and excluded from logs.
- Attachments are size- and type-validated and stored outside the public web
  root.
- Security-sensitive actions are written to the audit log.

References:

- Bun password hashing: https://bun.sh/docs/runtime/hashing
- OWASP Session Management Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Testing Strategy

The primary seam is an integration test that drives the HTTP API and worker
against a temporary SQLite database and the mock gateway. Tests assert external
behavior rather than internal call structure.

Coverage includes:

- authentication, authorization, session, and CSRF behavior
- manual contacts, CSV import, consent, and suppression
- campaign creation, preview, approval, scheduling, and cancellation
- atomic job claiming, rate limiting, retry, and worker restart recovery
- webhook deduplication and status projection
- gateway adapter contract behavior
- database creation and migration from previous versions
- critical browser flows through Playwright

Unit tests are reserved for pure logic such as phone normalization, CSV
parsing, template rendering, and error classification.

## VPS Operations

- `wa-blast-api` and `wa-blast-worker` run as separate `systemd` services.
- A reverse proxy provides HTTPS and serves the built web application.
- Health checks distinguish API, database, worker, and gateway health.
- Structured logs include correlation IDs but exclude credentials and sensitive
  message content.
- Operational metrics include queue depth, oldest pending job age, delivery
  rate, retry rate, and gateway health.
- SQLite and attachments are backed up daily with daily and weekly retention.
- Restore procedures are tested.
- Deployment runs database migrations before activating new services.
- On shutdown, the worker completes or releases its current job lease.

## Out of Scope

- Multi-tenant SaaS behavior
- More than one organization
- Public registration
- Recurring campaigns
- Message sequences
- Multiple attachments per message
- Automatic sender rotation
- Multiple active worker instances
- Redis, PostgreSQL, microservices, and container orchestration
- Building a WhatsApp protocol client inside this application
- Selecting or implementing the production gateway provider

## Acceptance Boundary

The MVP is accepted when an operator can import consented contacts, prepare a
personalized campaign, submit it for approval, and an admin can approve and
schedule it. The worker must deliver the campaign through the mock gateway,
recover from transient failures, process delivery webhooks idempotently, and
show final results and audit history in the admin application.
