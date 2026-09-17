CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  gateway_connection_id TEXT NOT NULL REFERENCES gateway_connections(id),
  template_id TEXT NOT NULL REFERENCES message_templates(id),
  schedule_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'pending_approval', 'approved', 'scheduled', 'queued', 'running', 'completed', 'completed_with_failures', 'cancelled')),
  audience_filter_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  submitted_by_user_id TEXT REFERENCES users(id),
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE campaign_contacts (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, contact_id)
);

CREATE INDEX campaigns_org_state_idx
  ON campaigns (organization_id, state, updated_at DESC);

CREATE INDEX campaign_contacts_contact_idx
  ON campaign_contacts (contact_id, campaign_id);
