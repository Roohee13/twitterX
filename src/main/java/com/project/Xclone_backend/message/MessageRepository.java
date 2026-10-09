package com.project.Xclone_backend.message;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MessageRepository extends JpaRepository<Message, Long> {

    /** The newest message in the conversation, deleted conversations' history included (used to know where "delete conversation" cuts). */
    java.util.Optional<Message> findFirstByConversationIdOrderByIdDesc(Long conversationId);

    /** The newest message this person can see (newer than the one they deleted the conversation up to). */
    java.util.Optional<Message> findFirstByConversationIdAndIdGreaterThanOrderByIdDesc(Long conversationId, Long clearedBefore);

    @Query("select m from Message m join fetch m.sender join fetch m.conversation c left join fetch c.userOne left join fetch c.userTwo where m.id = :id and c.id = :conversationId")
    java.util.Optional<Message> findInConversation(Long id, Long conversationId);

    /** Newest first; callers reverse the page for display. Messages up to {@code clearedBefore} were deleted by the viewer and are not returned. */
    @Query("""
            select m from Message m join fetch m.sender
            where m.conversation.id = :conversationId and m.id < :cursor and m.id > :clearedBefore
            order by m.id desc
            """)
    List<Message> findPage(Long conversationId, long cursor, long clearedBefore, Limit limit);

    /** Messages in the conversation that someone else sent and the user has not read yet. */
    @Query("""
            select count(m) from Message m
            where m.conversation.id = :conversationId and m.sender.id <> :userId and m.readAt is null and m.deleted = false
              and m.id > :clearedBefore
            """)
    long countUnread(Long conversationId, Long userId, long clearedBefore);

    /** Across the user's conversations, hiding those blocked either way or with a removed account (a deactivated person's messages still count). */
    @Query("""
            select count(m) from Message m join m.conversation c
            where (c.userOne.id = :userId or c.userTwo.id = :userId)
              and m.sender.id <> :userId and m.readAt is null and m.deleted = false
              and m.id > (case when c.userOne.id = :userId then c.userOneClearedBefore else c.userTwoClearedBefore end)
              and c.userOne.status <> com.project.Xclone_backend.user.AccountStatus.DELETED
              and c.userTwo.status <> com.project.Xclone_backend.user.AccountStatus.DELETED
              and not exists (select 1 from Block b
                   where (b.blocker.id = c.userOne.id and b.blocked.id = c.userTwo.id)
                      or (b.blocker.id = c.userTwo.id and b.blocked.id = c.userOne.id))
            """)
    long countUnreadTotal(Long userId);

    /** Group conversations: messages from others after {@code after} (the member's read marker or deletion marker, whichever is later). */
    @Query("""
            select count(m) from Message m
            where m.conversation.id = :conversationId and m.sender.id <> :userId and m.deleted = false and m.id > :after
            """)
    long countUnreadAfter(Long conversationId, Long userId, long after);

    /** Unread messages across all the groups the user belongs to. */
    @Query("""
            select count(m) from Message m, ConversationMember cm
            where cm.conversation.id = m.conversation.id and cm.user.id = :userId
              and m.sender.id <> :userId and m.deleted = false
              and m.id > (case when cm.clearedBefore > cm.lastReadMessageId then cm.clearedBefore else cm.lastReadMessageId end)
            """)
    long countUnreadTotalInGroups(Long userId);

    /** Never touches the user's own messages. Direct conversations only: a group keeps a read marker per member instead. */
    @Modifying
    @Query("""
            update Message m set m.readAt = :now
            where m.conversation.id = :conversationId and m.sender.id <> :userId and m.readAt is null
            """)
    int markRead(Long conversationId, Long userId, Instant now);
}
