CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX attachments_org_created_idx
  ON attachments (organization_id, created_at DESC);

CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_id TEXT REFERENCES attachments(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE UNIQUE INDEX message_templates_attachment_idx
  ON message_templates (attachment_id)
  WHERE attachment_id IS NOT NULL;
