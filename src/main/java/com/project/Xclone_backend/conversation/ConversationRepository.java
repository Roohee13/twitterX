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

    /** A direct conversation's two people, or a group's members. The pair is fetched with left joins because a group has none. */
    @Query("""
            select c from Conversation c left join fetch c.userOne left join fetch c.userTwo
            where c.id = :id and (c.userOne.id = :userId or c.userTwo.id = :userId
               or exists (select 1 from ConversationMember m where m.conversation = c and m.user.id = :userId))
            """)
    Optional<Conversation> findByIdAndParticipant(Long id, Long userId);

    /** One row of the inbox: a conversation, its newest message and how many messages from the other person are unread. */
    interface InboxRow {
        Long getConversationId();

        Long getLastMessageId();

        Long getUnread();
    }

    /**
     * The inbox: conversations that have at least one message you have not deleted, most recently active first. The cursor is the id of the newest
     * message (unique per conversation, and growing with time), so paging by it is exact. Direct conversations hide pairs blocked either way and
     * those with a removed account; one with a deactivated person stays (shown as "XClone user"). Groups you belong to are listed as well;
     * their unread count is what came after your read marker (or after what you deleted, whichever is later).
     */
    @Query(value = """
            select * from (
                select c.id as conversationId, lm.id as lastMessageId,
                       (select count(*) from messages m
                        where m.conversation_id = c.id and m.sender_id <> :userId and m.read_at is null and not m.deleted
                          and m.id > case when c.user_one_id = :userId then c.user_one_cleared_before else c.user_two_cleared_before end) as unread
                from conversations c
                join users u1 on u1.id = c.user_one_id
                join users u2 on u2.id = c.user_two_id
                join lateral (select m.id from messages m
                              where m.conversation_id = c.id
                                and m.id > case when c.user_one_id = :userId then c.user_one_cleared_before else c.user_two_cleared_before end
                              order by m.id desc limit 1) lm on true
                where (c.user_one_id = :userId or c.user_two_id = :userId) and lm.id < :cursor
                  and u1.status <> 'DELETED' and u2.status <> 'DELETED'
                  and not exists (select 1 from blocks b
                       where (b.blocker_id = c.user_one_id and b.blocked_id = c.user_two_id)
                          or (b.blocker_id = c.user_two_id and b.blocked_id = c.user_one_id))
                union all
                select c.id as conversationId, lm.id as lastMessageId,
                       (select count(*) from messages m
                        where m.conversation_id = c.id and m.sender_id <> :userId and not m.deleted
                          and m.id > greatest(cm.cleared_before, cm.last_read_message_id)) as unread
                from conversations c
                join conversation_members cm on cm.conversation_id = c.id and cm.user_id = :userId
                join lateral (select m.id from messages m
                              where m.conversation_id = c.id and m.id > cm.cleared_before
                              order by m.id desc limit 1) lm on true
                where c.type = 'GROUP' and lm.id < :cursor
            ) inbox
            order by lastMessageId desc
            limit :limit
            """, nativeQuery = true)
    List<InboxRow> findInbox(Long userId, long cursor, int limit);

    @Query("""
            select c from Conversation c left join fetch c.userOne left join fetch c.userTwo where c.id in :ids
            """)
    List<Conversation> findAllWithUsers(Collection<Long> ids);

    /** Bumps updatedAt explicitly, since a new message does not dirty the conversation entity. */
    @Modifying
    @Query("update Conversation c set c.updatedAt = :now where c.id = :id")
    int touch(Long id, Instant now);

    /** Hides every message up to {@code upTo} from this participant only (never moves the marker back). */
    @Modifying
    @Query(value = """
            update conversations set
              user_one_cleared_before = case when user_one_id = :userId then greatest(user_one_cleared_before, :upTo) else user_one_cleared_before end,
              user_two_cleared_before = case when user_two_id = :userId then greatest(user_two_cleared_before, :upTo) else user_two_cleared_before end
            where id = :id
            """, nativeQuery = true)
    int clearFor(Long id, Long userId, long upTo);
}
