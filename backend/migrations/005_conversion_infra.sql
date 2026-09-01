-- Conversion infrastructure: fleet-size columns on organizations, the
-- demo-request -> organization link, and the 'converted' triage status.

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS sites_count   INT CHECK (sites_count >= 0),
    ADD COLUMN IF NOT EXISTS cameras_count INT CHECK (cameras_count >= 0),
    ADD COLUMN IF NOT EXISTS spaces_count  INT CHECK (spaces_count >= 0);

ALTER TABLE demo_requests
    ADD COLUMN IF NOT EXISTS converted_org_id UUID
        REFERENCES organizations(id) ON DELETE SET NULL;

-- Widen the demo-request status vocabulary with 'converted'. The column-level
-- CHECK from 004 got the auto-generated name demo_requests_status_check; drop
-- it and re-add under the same (now explicit) name. The DO block keeps a
-- re-run from failing on a duplicate constraint.
ALTER TABLE demo_requests DROP CONSTRAINT IF EXISTS demo_requests_status_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'demo_requests_status_check'
          AND conrelid = 'demo_requests'::regclass
    ) THEN
        ALTER TABLE demo_requests
            ADD CONSTRAINT demo_requests_status_check
            CHECK (status IN ('new', 'contacted', 'archived', 'converted'));
    END IF;
END $$;
