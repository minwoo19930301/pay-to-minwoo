CREATE TABLE IF NOT EXISTS donation_intents (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  region TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  donor TEXT NOT NULL,
  status TEXT NOT NULL,
  active_attempt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS donation_intents_status_idx ON donation_intents (status);
CREATE UNIQUE INDEX IF NOT EXISTS donation_intents_idempotency_key_idx ON donation_intents (idempotency_key);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES donation_intents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_id TEXT
);

CREATE INDEX IF NOT EXISTS payment_attempts_intent_id_idx ON payment_attempts (intent_id);
CREATE INDEX IF NOT EXISTS payment_attempts_status_idx ON payment_attempts (status);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL REFERENCES donation_intents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  signature_verified INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_events_attempt_id_idx ON provider_events (attempt_id, received_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS settlement_records (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES payment_attempts(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL REFERENCES donation_intents(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  gross_amount BIGINT NOT NULL,
  fee_amount BIGINT NOT NULL,
  net_amount BIGINT NOT NULL,
  status TEXT NOT NULL,
  payout_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_out_at TEXT
);

CREATE INDEX IF NOT EXISTS settlement_records_status_idx ON settlement_records (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL REFERENCES donation_intents(id) ON DELETE CASCADE,
  settlement_id TEXT REFERENCES settlement_records(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS ledger_entries_attempt_id_idx ON ledger_entries (attempt_id, created_at DESC);
