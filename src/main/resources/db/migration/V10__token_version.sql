-- Bumped when the password changes or is reset; access tokens carry the value they were issued with, so older ones stop working at once.
ALTER TABLE public.users ADD COLUMN token_version integer NOT NULL DEFAULT 0;
