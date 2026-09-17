---
status: accepted
date: 2026-09-17
---

# Run a modular monolith with separate API and worker processes

The MVP will run as a modular monolith on one VPS, with separate Bun API and
worker processes sharing one SQLite database in WAL mode. This keeps deployment
and operations appropriate for the expected ceiling of 10,000 recipients per
day while isolating HTTP traffic from delivery work. A single combined process
was rejected because API restarts would interrupt delivery, and a distributed
PostgreSQL/Redis architecture was rejected as unnecessary operational
complexity for the initial scale.
