-- A sender can edit or delete their own messages. An edit records when; a delete erases the text and keeps the row,
-- so the conversation shows "This message was deleted" and ids, ordering and the inbox keep working.
ALTER TABLE public.messages
    ADD COLUMN edited_at timestamp(6) with time zone,
    ADD COLUMN deleted boolean NOT NULL DEFAULT false;
