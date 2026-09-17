CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,
  message_job_id TEXT NOT NULL REFERENCES message_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'transient', 'permanent')),
  error_code TEXT,
  error_message TEXT,
  provider_message_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  UNIQUE (message_job_id, attempt_number)
);

CREATE INDEX delivery_attempts_job_idx
  ON delivery_attempts (message_job_id, attempt_number DESC);

CREATE TABLE delivery_events (
  id TEXT PRIMARY KEY,
  message_job_id TEXT NOT NULL REFERENCES message_jobs(id) ON DELETE CASCADE,
  provider_event_id TEXT UNIQUE,
  fingerprint TEXT NOT NULL UNIQUE,
  canonical_status TEXT NOT NULL CHECK (canonical_status IN ('sent', 'delivered', 'read', 'failed', 'unknown')),
  raw_type TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_tick_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'stopping', 'unhealthy')),
  updated_at TEXT NOT NULL
);
