---
status: accepted
date: 2026-09-17
---

# Isolate unofficial providers behind a gateway adapter

Campaign and delivery behavior will depend on a provider-neutral gateway
contract rather than a specific unofficial WhatsApp provider. Development and
acceptance testing will begin with a mock adapter, and a provider-specific
adapter can be added later. This boundary avoids coupling campaign rules,
retries, webhooks, and the admin UI to an unstable external API.
