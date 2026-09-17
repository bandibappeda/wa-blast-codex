ALTER TABLE campaigns ADD COLUMN approved_by_user_id TEXT REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN approved_at TEXT;

CREATE TABLE campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  phone_e164 TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  rendered_body TEXT NOT NULL,
  attachment_original_name TEXT,
  attachment_mime_type TEXT,
  attachment_storage_key TEXT,
  gateway_connection_id TEXT NOT NULL REFERENCES gateway_connections(id),
  schedule_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX campaign_recipients_campaign_idx
  ON campaign_recipients (campaign_id, id);

CREATE TABLE message_jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_recipient_id TEXT NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retry', 'leased', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  last_error_category TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_recipient_id)
);

CREATE INDEX message_jobs_claim_idx
  ON message_jobs (status, available_at, lease_expires_at);
CREATE INDEX message_jobs_campaign_idx
  ON message_jobs (campaign_id, status);
