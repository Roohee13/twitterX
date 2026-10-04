package com.project.Xclone_backend.conversation;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ConversationRepository extends JpaRepository<Conversation, Long> {

    /** Idempotent and race-safe: returns 1 if the conversation was created, 0 if it already existed. */
    @Modifying
    @Query(value = """
            insert into conversations (user_one_id, user_two_id, created_at, updated_at)
            values (:userOneId, :userTwoId, now(), now())
            on conflict (user_one_id, user_two_id) do nothing
            """, nativeQuery = true)
    int createIfAbsent(Long userOneId, Long userTwoId);

    @Query("""
            select c from Conversation c join fetch c.userOne join fetch c.userTwo
            where c.userOne.id = :userOneId and c.userTwo.id = :userTwoId
            """)
    Optional<Conversation> findByPair(Long userOneId, Long userTwoId);

    @Query("""
            select c from Conversation c join fetch c.userOne join fetch c.userTwo
            where c.id = :id and (c.userOne.id = :userId or c.userTwo.id = :userId)
            """)
    Optional<Conversation> findByIdAndParticipant(Long id, Long userId);

    /** One row of the inbox: a conversation, its newest message and how many messages from the other person are unread. */
    interface InboxRow {
        Long getConversationId();

        Long getLastMessageId();

        Long getUnread();
    }

    /**
     * The inbox: conversations that have at least one message, most recently active first. The cursor is the id of the newest
     * message (unique per conversation, and growing with time), so paging by it is exact. Hides pairs blocked either way and
     * conversations with a non-active participant.
     */
    @Query(value = """
            select c.id as conversationId, lm.id as lastMessageId,
                   (select count(*) from messages m
                    where m.conversation_id = c.id and m.sender_id <> :userId and m.read_at is null and not m.deleted) as unread
            from conversations c
            join users u1 on u1.id = c.user_one_id
            join users u2 on u2.id = c.user_two_id
            join lateral (select m.id from messages m where m.conversation_id = c.id order by m.id desc limit 1) lm on true
            where (c.user_one_id = :userId or c.user_two_id = :userId) and lm.id < :cursor
              and u1.status = 'ACTIVE' and u2.status = 'ACTIVE'
              and not exists (select 1 from blocks b
                   where (b.blocker_id = c.user_one_id and b.blocked_id = c.user_two_id)
                      or (b.blocker_id = c.user_two_id and b.blocked_id = c.user_one_id))
            order by lm.id desc
            limit :limit
            """, nativeQuery = true)
    List<InboxRow> findInbox(Long userId, long cursor, int limit);

    @Query("""
            select c from Conversation c join fetch c.userOne join fetch c.userTwo where c.id in :ids
            """)
    List<Conversation> findAllWithUsers(Collection<Long> ids);

    /** Bumps updatedAt explicitly, since a new message does not dirty the conversation entity. */
    @Modifying
    @Query("update Conversation c set c.updatedAt = :now where c.id = :id")
    int touch(Long id, Instant now);
}
