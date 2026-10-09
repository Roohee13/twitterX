package com.project.Xclone_backend.conversation;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.conversation.ConversationDtos.ConversationResponse;
import com.project.Xclone_backend.conversation.ConversationDtos.LastMessage;
import com.project.Xclone_backend.conversation.ConversationMemberRepository.MemberCount;
import com.project.Xclone_backend.conversation.ConversationRepository.InboxRow;
import com.project.Xclone_backend.message.Message;
import com.project.Xclone_backend.message.MessageRepository;
import com.project.Xclone_backend.user.AccountStatus;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ConversationService {

    private final ConversationRepository conversationRepository;
    private final ConversationMemberRepository memberRepository;
    private final UserService userService;
    private final UserMapper userMapper;
    private final MessageRepository messageRepository;

    public record Result(ConversationResponse conversation, boolean created) {
    }

    @Transactional
    public Result getOrCreate(Long meId, String username) {
        User other = userService.requireByUsername(username);
        if (other.getId().equals(meId)) {
            throw ApiException.badRequest("You cannot message yourself");
        }
        requireMessageable(meId, other);

        Long low = Math.min(meId, other.getId());
        Long high = Math.max(meId, other.getId());
        boolean created = conversationRepository.createIfAbsent(low, high) > 0;
        Conversation c = conversationRepository.findByPair(low, high)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        return new Result(toResponse(c, meId), created);
    }

    /** The inbox: conversations (direct and groups) with messages, most recently active first (see ConversationRepository.findInbox). */
    @Transactional(readOnly = true)
    public CursorPage<ConversationResponse> list(Long meId, Long cursor, Integer limit) {
        int size = CursorPage.clampLimit(limit);
        var rows = conversationRepository.findInbox(meId, CursorPage.cursorOrMax(cursor), size + 1);
        return CursorPage.of(rows, size, InboxRow::getLastMessageId, page -> {
            Map<Long, Conversation> conversations = new HashMap<>();
            conversationRepository.findAllWithUsers(page.stream().map(InboxRow::getConversationId).toList())
                    .forEach(c -> conversations.put(c.getId(), c));
            Map<Long, Message> lastMessages = new HashMap<>();
            messageRepository.findAllById(page.stream().map(InboxRow::getLastMessageId).toList())
                    .forEach(m -> lastMessages.put(m.getId(), m));
            List<Long> groupIds = conversations.values().stream().filter(Conversation::isGroup).map(Conversation::getId).toList();
            Map<Long, Integer> memberCounts = new HashMap<>();
            if (!groupIds.isEmpty()) {
                for (MemberCount count : memberRepository.countByConversationIds(groupIds)) {
                    memberCounts.put(count.getConversationId(), count.getMembers().intValue());
                }
            }
            return page.stream().map(row -> toResponse(conversations.get(row.getConversationId()), meId,
                    lastMessages.get(row.getLastMessageId()), row.getUnread(),
                    memberCounts.get(row.getConversationId()))).toList();
        });
    }

    /** Non-participants get a 404 so the existence of other people's conversations is not revealed. */
    @Transactional(readOnly = true)
    public ConversationResponse get(Long meId, Long id) {
        return toResponse(requireReadable(meId, id), meId);
    }

    /**
     * "Delete conversation" for one person: everything in it up to now disappears from their side (inbox, history, unread counts) and is marked
     * read. The others keep their copy and are not told. A message sent afterwards (by anyone) shows up again, on its own.
     * Allowed even when the other account is deactivated or the pair is blocked: it only changes the caller's own view. In a group the caller
     * stays a member; to stop receiving the group's messages they leave it.
     */
    @Transactional
    public void deleteForMe(Long meId, Long id) {
        Conversation c = conversationRepository.findByIdAndParticipant(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        long newest = messageRepository.findFirstByConversationIdOrderByIdDesc(c.getId()).map(Message::getId).orElse(0L);
        if (c.isGroup()) {
            memberRepository.clearFor(c.getId(), meId, newest);
            memberRepository.markReadUpTo(c.getId(), meId, newest);
            return;
        }
        conversationRepository.clearFor(c.getId(), meId, newest);
        messageRepository.markRead(c.getId(), meId, java.time.Instant.now());
    }

    /**
     * For reading: the caller must participate (else 404). A direct pair must not be blocked; a conversation with a deactivated or suspended
     * person stays readable (your history is yours), shown with "XClone user"; one with a removed account is gone. A group stays readable
     * for its members whatever happens between two of them.
     */
    public Conversation requireReadable(Long meId, Long id) {
        Conversation c = conversationRepository.findByIdAndParticipant(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        if (c.isGroup()) {
            return c;
        }
        User other = other(c, meId);
        if (other.getStatus() == AccountStatus.DELETED) {
            throw ApiException.notFound("Conversation not found");
        }
        userService.requireNotBlocked(meId, other.getId());
        return c;
    }

    /** For writing (send, edit, delete): the caller must participate (else 404); in a direct pair the other person must be active and not blocked (else 403). */
    public Conversation requireAccessible(Long meId, Long id) {
        Conversation c = conversationRepository.findByIdAndParticipant(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        if (!c.isGroup()) {
            requireMessageable(meId, other(c, meId));
        }
        return c;
    }

    /** Messages with an id up to this are hidden from the person: they deleted the conversation up to there (in a group: or it is older than their joining). */
    public long clearedBeforeFor(Conversation c, Long meId) {
        if (c.isGroup()) {
            return member(c, meId).getClearedBefore();
        }
        return c.clearedBeforeFor(meId);
    }

    /** The unread messages of this person in the conversation. */
    public long unreadCount(Conversation c, Long meId) {
        if (c.isGroup()) {
            return messageRepository.countUnreadAfter(c.getId(), meId, member(c, meId).unreadAfter());
        }
        return messageRepository.countUnread(c.getId(), meId, c.clearedBeforeFor(meId));
    }

    /** Everyone else in the conversation: who is told when the caller sends, edits or deletes a message. */
    public List<Long> otherParticipantIds(Conversation c, Long meId) {
        if (c.isGroup()) {
            return memberRepository.findOtherUserIds(c.getId(), meId);
        }
        return List.of(other(c, meId).getId());
    }

    private ConversationMember member(Conversation c, Long meId) {
        return memberRepository.findByConversationIdAndUserId(c.getId(), meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
    }

    private void requireMessageable(Long meId, User other) {
        if (other.getStatus() != AccountStatus.ACTIVE) {
            throw ApiException.forbidden("This user cannot receive messages");
        }
        userService.requireNotBlocked(meId, other.getId());
    }

    private static User other(Conversation c, Long meId) {
        return c.getUserOne().getId().equals(meId) ? c.getUserTwo() : c.getUserOne();
    }

    /** For a single conversation, as seen by this person: looks up its newest message, unread count and member count itself. */
    public ConversationResponse toResponse(Conversation c, Long meId) {
        if (c.isGroup()) {
            ConversationMember me = member(c, meId);
            return toResponse(c, meId,
                    messageRepository.findFirstByConversationIdAndIdGreaterThanOrderByIdDesc(c.getId(), me.getClearedBefore()).orElse(null),
                    messageRepository.countUnreadAfter(c.getId(), meId, me.unreadAfter()),
                    (int) memberRepository.countByConversationId(c.getId()));
        }
        long cleared = c.clearedBeforeFor(meId);
        return toResponse(c, meId, messageRepository.findFirstByConversationIdAndIdGreaterThanOrderByIdDesc(c.getId(), cleared).orElse(null),
                messageRepository.countUnread(c.getId(), meId, cleared), null);
    }

    private ConversationResponse toResponse(Conversation c, Long meId, Message last, long unread, Integer memberCount) {
        boolean group = c.isGroup();
        LastMessage lastMessage = last == null ? null : new LastMessage(last.getId(), last.getSender().getId(), last.getContent(),
                last.getCreatedAt(), last.isDeleted(), !last.getMedia().isEmpty(),
                group ? userMapper.toSummary(last.getSender()).displayName() : null);
        return new ConversationResponse(c.getId(), c.getType(), group ? c.getTitle() : null, group ? memberCount : null,
                group ? null : userMapper.toSummary(other(c, meId)), c.getCreatedAt(), c.getUpdatedAt(), lastMessage, unread);
    }
}
