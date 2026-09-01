-- Customer organizations and their members. Orgs are soft-deleted
-- (status='removed') so billing history and the audit trail stay queryable;
-- members are hard-deleted on individual removal but survive org removal
-- alongside the org row.

CREATE TABLE IF NOT EXISTS organizations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    contact_email TEXT,
    notes         TEXT,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'removed')),
    removed_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

CREATE TABLE IF NOT EXISTS org_members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Member login is email+password with no org discriminator, so emails are
-- globally unique (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_email_unique
    ON org_members (lower(email));
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);

DROP TRIGGER IF EXISTS organizations_set_updated_at ON organizations;
CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS org_members_set_updated_at ON org_members;
CREATE TRIGGER org_members_set_updated_at
BEFORE UPDATE ON org_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
