-- The "For You" feed ranks the latest eligible top-level posts. This index makes "the latest N of them" an index scan
-- (replies, repost rows and deleted posts are never candidates).
CREATE INDEX idx_posts_feed ON public.posts USING btree (created_at DESC)
    WHERE deleted = false AND parent_id IS NULL AND repost_of_id IS NULL;
