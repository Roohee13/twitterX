-- Who may start or continue a direct-message conversation with this account: EVERYONE, FOLLOWED (only accounts the user follows) or NOBODY.
ALTER TABLE public.users ADD COLUMN dm_policy character varying(20) NOT NULL DEFAULT 'EVERYONE';
