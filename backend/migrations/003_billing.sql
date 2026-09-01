-- Internal billing ledger: plans, subscriptions, invoices, payments.
-- Stripe-shaped statuses so a real provider could slot in later. Money is
-- integer cents. Statuses are TEXT + CHECK (cheaper to evolve than PG enums
-- under append-only migrations).

CREATE TABLE IF NOT EXISTS plans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency     TEXT NOT NULL DEFAULT 'usd',
    "interval"   TEXT NOT NULL DEFAULT 'month' CHECK ("interval" IN ('month', 'year')),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, amount_cents, "interval") VALUES
    ('starter', 'Starter', 9900, 'month'),
    ('growth', 'Growth', 29900, 'month'),
    ('site', 'Multi-site', 99900, 'month')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id              UUID NOT NULL REFERENCES plans(id),
    status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end   TIMESTAMPTZ,
    canceled_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one live (non-canceled) subscription per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live_per_org
    ON subscriptions(org_id) WHERE status <> 'canceled';
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id   UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    number            TEXT NOT NULL UNIQUE
                      DEFAULT ('INV-' || to_char(nextval('invoice_number_seq'), 'FM000000')),
    amount_due_cents  INTEGER NOT NULL CHECK (amount_due_cents >= 0),
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency          TEXT NOT NULL DEFAULT 'usd',
    status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
    memo              TEXT,
    period_start      TIMESTAMPTZ,
    period_end        TIMESTAMPTZ,
    due_at            TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_created ON invoices(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS payments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id   UUID REFERENCES invoices(id) ON DELETE SET NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency     TEXT NOT NULL DEFAULT 'usd',
    method       TEXT NOT NULL DEFAULT 'manual'
                 CHECK (method IN ('manual', 'ach', 'wire', 'check', 'card', 'other')),
    status       TEXT NOT NULL DEFAULT 'succeeded'
                 CHECK (status IN ('succeeded', 'failed', 'refunded')),
    reference    TEXT,
    note         TEXT,
    recorded_by  TEXT,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_org_received ON payments(org_id, received_at DESC);

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS invoices_set_updated_at ON invoices;
CREATE TRIGGER invoices_set_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
