-- Demo/contact intake, the admin audit trail, and the email outbox.

CREATE TABLE IF NOT EXISTS demo_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         TEXT NOT NULL DEFAULT 'demo' CHECK (kind IN ('demo', 'contact')),
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    company      TEXT,
    lot_size     TEXT,
    cameras      TEXT,
    topic        TEXT,
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'archived')),
    submitted_ip INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_status_created
    ON demo_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created
    ON demo_requests(created_at DESC);

-- Append-only. org_name is a snapshot so "who removed which org, when"
-- survives any future purge of the organizations table.
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin', 'member', 'system')),
    actor_id    TEXT,
    action      TEXT NOT NULL,
    org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL,
    org_name    TEXT,
    target_type TEXT,
    target_id   TEXT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip          INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- Outbox-first email: every send starts as a row. status='captured' means
-- SMTP was not configured and the message is viewable in the portal instead.
CREATE TABLE IF NOT EXISTS email_outbox (
    id         BIGSERIAL PRIMARY KEY,
    to_email   TEXT NOT NULL,
    to_name    TEXT,
    subject    TEXT NOT NULL,
    body_text  TEXT NOT NULL,
    template   TEXT NOT NULL,
    org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'failed', 'captured')),
    error      TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status_created
    ON email_outbox(status, created_at DESC);

DROP TRIGGER IF EXISTS demo_requests_set_updated_at ON demo_requests;
CREATE TRIGGER demo_requests_set_updated_at
BEFORE UPDATE ON demo_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
