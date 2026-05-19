ALTER TABLE feed_comments ADD COLUMN organization_id UUID;
UPDATE feed_comments fc SET organization_id = fp.organization_id FROM feed_posts fp WHERE fp.id = fc.post_id;
ALTER TABLE feed_comments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE feed_comments ADD CONSTRAINT feed_comments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_feed_comments_org_post ON feed_comments(organization_id, post_id);
