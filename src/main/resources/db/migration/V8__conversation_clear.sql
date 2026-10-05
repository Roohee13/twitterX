-- "Delete conversation" hides a conversation's history for one person only. Each side remembers the newest message it deleted: that message
-- and everything older is invisible to that person, newer messages (including ones that arrive later) show again.
ALTER TABLE public.conversations
    ADD COLUMN user_one_cleared_before bigint NOT NULL DEFAULT 0,
    ADD COLUMN user_two_cleared_before bigint NOT NULL DEFAULT 0;
