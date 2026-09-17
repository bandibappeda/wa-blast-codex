CREATE TABLE gateway_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  encrypted_config TEXT NOT NULL,
  messages_per_minute INTEGER NOT NULL CHECK (messages_per_minute > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'healthy', 'unhealthy')),
  last_health_checked_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  unhealthy_until TEXT,
  next_send_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX gateway_connections_org_name_idx
  ON gateway_connections (organization_id, name);
