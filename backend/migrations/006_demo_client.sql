-- Seed a demo client account so the hosted deployment has a working
-- member login out of the box (the portal has no self-serve signup).
-- Idempotent: skipped when the demo member already exists, and safe on
-- databases that already have their own orgs/members.
--
-- Login: demo@sightline.test (password distributed out-of-band; the value
-- below is only its bcrypt hash). Rotate or remove via the admin portal.

INSERT INTO organizations (name, contact_email, notes)
SELECT 'Demo Parking Co', 'demo@sightline.test', 'Seeded demo org (migration 006)'
WHERE NOT EXISTS (
    SELECT 1 FROM org_members WHERE lower(email) = 'demo@sightline.test'
)
AND NOT EXISTS (
    SELECT 1 FROM organizations WHERE name = 'Demo Parking Co' AND status = 'active'
);

INSERT INTO org_members (org_id, email, password_hash, full_name, role)
SELECT o.id,
       'demo@sightline.test',
       '$2b$12$bOMoQiCOJO7XRK.3DIQ1GOPH47rsniA2WmAivDcIH0be5i1e1dM3S',
       'Demo Operator',
       'owner'
FROM organizations o
WHERE o.name = 'Demo Parking Co' AND o.status = 'active'
AND NOT EXISTS (
    SELECT 1 FROM org_members WHERE lower(email) = 'demo@sightline.test'
)
LIMIT 1;
