CREATE TYPE webhook_status AS ENUM ('RECEIVED', 'RETRYABLE', 'PROCESSED', 'IGNORED', 'REVIEW_REQUIRED');

ALTER TABLE payments
  ADD COLUMN stripe_payment_intent_id TEXT,
  ADD COLUMN provider_status TEXT,
  ADD COLUMN provider_create_params JSONB,
  ADD COLUMN first_provider_request_at TIMESTAMPTZ(3),
  ADD COLUMN create_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN next_provider_retry_at TIMESTAMPTZ(3),
  ADD COLUMN last_provider_error_code TEXT,
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ(3),
  ADD COLUMN last_synced_at TIMESTAMPTZ(3),
  ADD CONSTRAINT payments_create_attempt_check CHECK (create_attempt_count >= 0 AND create_attempt_count <= 6),
  ADD CONSTRAINT payments_lease_pair_check CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  ADD CONSTRAINT payments_provider_status_check CHECK (provider_status IN ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','requires_capture'));
CREATE UNIQUE INDEX payments_stripe_payment_intent_id_key ON payments(stripe_payment_intent_id);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  api_version TEXT NOT NULL,
  provider_created_at TIMESTAMPTZ(3) NOT NULL,
  livemode BOOLEAN NOT NULL CHECK (livemode = false),
  provider_object_id TEXT,
  metadata_payment_id TEXT,
  metadata_instance_id TEXT,
  metadata_operation_key TEXT,
  payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status webhook_status NOT NULL DEFAULT 'RECEIVED',
  delivery_count INTEGER NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  first_received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_retry_at TIMESTAMPTZ(3),
  processed_at TIMESTAMPTZ(3),
  last_error_code TEXT,
  processing_history JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(processing_history) = 'array')
);
CREATE INDEX webhook_events_payment_id_idx ON webhook_events(payment_id);
CREATE INDEX webhook_events_status_next_retry_at_idx ON webhook_events(status, next_retry_at);
ALTER TABLE payment_events ADD COLUMN webhook_event_id TEXT REFERENCES webhook_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX payment_events_webhook_event_id_idx ON payment_events(webhook_event_id);

-- Linked identity and the exact create operation cannot be replaced or cleared.
CREATE FUNCTION protect_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id)
     OR (OLD.provider_create_params IS NOT NULL AND NEW.provider_create_params IS DISTINCT FROM OLD.provider_create_params)
     OR NEW.provider_operation_key IS DISTINCT FROM OLD.provider_operation_key
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'immutable payment identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_provider_identity BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION protect_provider_identity();
