package com.project.Xclone_backend.conversation;

import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.conversation.ConversationDtos.ConversationResponse;
import com.project.Xclone_backend.conversation.ConversationDtos.LastMessage;
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

    /** The inbox: conversations with messages, most recently active first (see ConversationRepository.findInbox). */
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
            return page.stream().map(row -> toResponse(conversations.get(row.getConversationId()), meId,
                    lastMessages.get(row.getLastMessageId()), row.getUnread())).toList();
        });
    }

    /** Non-participants get a 404 so the existence of other users' conversations is not revealed. */
    @Transactional(readOnly = true)
    public ConversationResponse get(Long meId, Long id) {
        return toResponse(requireAccessible(meId, id), meId);
    }

    /** The caller must participate (else 404) and the other participant must be reachable (else 403). */
    public Conversation requireAccessible(Long meId, Long id) {
        Conversation c = conversationRepository.findByIdAndParticipant(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        requireMessageable(meId, other(c, meId));
        return c;
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

    /** For a single conversation: looks up its newest message and unread count itself. */
    private ConversationResponse toResponse(Conversation c, Long meId) {
        return toResponse(c, meId, messageRepository.findFirstByConversationIdOrderByIdDesc(c.getId()).orElse(null),
                messageRepository.countUnread(c.getId(), meId));
    }

    private ConversationResponse toResponse(Conversation c, Long meId, Message last, long unread) {
        return new ConversationResponse(c.getId(), userMapper.toSummary(other(c, meId)), c.getCreatedAt(),
                c.getUpdatedAt(), last == null ? null : new LastMessage(last.getId(), last.getSender().getId(),
                        last.getContent(), last.getCreatedAt(), last.isDeleted()), unread);
    }
}
