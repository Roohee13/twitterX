package com.project.Xclone_backend.conversation;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ConversationMemberRepository extends JpaRepository<ConversationMember, Long> {

    Optional<ConversationMember> findByConversationIdAndUserId(Long conversationId, Long userId);

    boolean existsByConversationIdAndUserId(Long conversationId, Long userId);

    long countByConversationId(Long conversationId);

    /** The oldest remaining member: who inherits a group when its owner leaves. */
    Optional<ConversationMember> findFirstByConversationIdOrderByIdAsc(Long conversationId);

    @Query("select m from ConversationMember m join fetch m.user where m.conversation.id = :conversationId order by m.id")
    List<ConversationMember> findAllWithUsers(Long conversationId);

    @Query("select m.user.id from ConversationMember m where m.conversation.id = :conversationId and m.user.id <> :userId")
    List<Long> findOtherUserIds(Long conversationId, Long userId);

    @Query("select m.conversation.id as conversationId, count(m) as members from ConversationMember m where m.conversation.id in :ids group by m.conversation.id")
    List<MemberCount> countByConversationIds(Collection<Long> ids);

    interface MemberCount {
        Long getConversationId();

        Long getMembers();
    }

    @Modifying
    @Query("delete from ConversationMember m where m.conversation.id = :conversationId and m.user.id = :userId")
    int remove(Long conversationId, Long userId);

    /** Never moves a marker back. */
    @Modifying
    @Query(value = """
            update conversation_members set last_read_message_id = greatest(last_read_message_id, :upTo)
            where conversation_id = :conversationId and user_id = :userId
            """, nativeQuery = true)
    int markReadUpTo(Long conversationId, Long userId, long upTo);

    /** Hides every message up to {@code upTo} from this member only (never moves the marker back). */
    @Modifying
    @Query(value = """
            update conversation_members set cleared_before = greatest(cleared_before, :upTo)
            where conversation_id = :conversationId and user_id = :userId
            """, nativeQuery = true)
    int clearFor(Long conversationId, Long userId, long upTo);
}
