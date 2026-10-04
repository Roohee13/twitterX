-- System notifications (to admins about reports, to authors about removed posts, to reporters about outcomes) have no actor.
ALTER TABLE public.notifications ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.notifications ADD COLUMN detail varchar(500);

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
    ('FOLLOW', 'LIKE', 'REPLY', 'MENTION', 'REPOST', 'FOLLOW_REQUEST', 'REPORT_RECEIVED', 'POST_REMOVED', 'REPORT_OUTCOME'));

-- Suspended accounts: cannot sign in and are hidden, until an admin lifts the suspension.
ALTER TABLE public.users DROP CONSTRAINT users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'DEACTIVATED', 'DELETED', 'SUSPENDED'));

-- An optional explanation the admin gives when handling a report; it is sent to the people affected.
ALTER TABLE public.user_reports ADD COLUMN admin_note varchar(500);
ALTER TABLE public.post_reports ADD COLUMN admin_note varchar(500);
