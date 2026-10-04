-- Admins: a flag on the user, granted by hand (update users set is_admin = true where username = '...').
ALTER TABLE public.users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Reports get a review status, and who handled them and when.
ALTER TABLE public.user_reports
    ADD COLUMN status varchar(20) NOT NULL DEFAULT 'OPEN',
    ADD COLUMN handled_by bigint REFERENCES public.users (id),
    ADD COLUMN handled_at timestamp(6) with time zone,
    ADD CONSTRAINT user_reports_status_check CHECK (status IN ('OPEN', 'DISMISSED', 'RESOLVED'));

ALTER TABLE public.post_reports
    ADD COLUMN status varchar(20) NOT NULL DEFAULT 'OPEN',
    ADD COLUMN handled_by bigint REFERENCES public.users (id),
    ADD COLUMN handled_at timestamp(6) with time zone,
    ADD CONSTRAINT post_reports_status_check CHECK (status IN ('OPEN', 'DISMISSED', 'RESOLVED'));

-- The admin lists page through reports by status; the totals per reported account / post look reports up by target.
CREATE INDEX idx_user_reports_status ON public.user_reports USING btree (status, id);
CREATE INDEX idx_user_reports_reported ON public.user_reports USING btree (reported_user_id);
CREATE INDEX idx_post_reports_status ON public.post_reports USING btree (status, id);
CREATE INDEX idx_post_reports_post ON public.post_reports USING btree (post_id);
