CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  phone_display TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, phone_e164)
);

CREATE TABLE contact_consents (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX contact_consents_contact_idx
  ON contact_consents (contact_id, consent_at DESC);

CREATE TABLE suppressions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  suppressed_at TEXT NOT NULL,
  lifted_at TEXT,
  lifted_reason TEXT,
  actor_user_id TEXT REFERENCES users(id),
  lifted_by_user_id TEXT REFERENCES users(id)
);

CREATE INDEX suppressions_active_idx
  ON suppressions (contact_id, lifted_at);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE contact_tags (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

CREATE TABLE contact_imports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'failed')),
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE contact_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES contact_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'invalid', 'suppressed', 'duplicate', 'committed')),
  error TEXT,
  contact_id TEXT REFERENCES contacts(id),
  UNIQUE (import_id, row_number)
);
