package com.project.Xclone_backend.message;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.conversation.Conversation;
import com.project.Xclone_backend.conversation.ConversationRepository;
import com.project.Xclone_backend.conversation.ConversationService;
import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.message.MessageDtos.MessageResponse;
import com.project.Xclone_backend.message.MessageDtos.UnreadCountResponse;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MessageService {

    private final MessageRepository messageRepository;
    private final ConversationRepository conversationRepository;
    private final ConversationService conversationService;
    private final UserService userService;
    private final UserMapper userMapper;
    private final ApplicationEventPublisher events;

    @Transactional
    public MessageResponse send(Long meId, Long conversationId, String content) {
        Conversation conversation = conversationService.requireAccessible(meId, conversationId);
        Message message = new Message();
        message.setConversation(conversation);
        message.setSender(userService.requireById(meId));
        message.setContent(content.strip());
        messageRepository.save(message);
        conversationRepository.touch(conversationId, Instant.now());
        MessageResponse response = toResponse(message);
        Long recipientId = conversation.getUserOne().getId().equals(meId)
                ? conversation.getUserTwo().getId() : conversation.getUserOne().getId();
        events.publishEvent(new MessageSentEvent(recipientId, response));
        return response;
    }

    /**
     * Pages walk backwards through history: each page is ordered oldest to newest for display, and
     * {@code nextCursor} (the oldest id in the page) loads the next older page.
     */
    @Transactional(readOnly = true)
    public CursorPage<MessageResponse> list(Long meId, Long conversationId, Long cursor, Integer limit) {
        long clearedBefore = conversationService.requireReadable(meId, conversationId).clearedBeforeFor(meId);
        int size = CursorPage.clampLimit(limit);
        List<Message> rows = messageRepository.findPage(conversationId, CursorPage.cursorOrMax(cursor), clearedBefore,
                Limit.of(size + 1));
        return CursorPage.of(rows, size, Message::getId,
                page -> page.stream().map(this::toResponse).collect(Collectors.collectingAndThen(Collectors.toList(), l -> {
                    Collections.reverse(l);
                    return l;
                })));
    }

    /** Only the sender, only their own message, and not once it is deleted. Saving the same text again changes nothing. */
    @Transactional
    public MessageResponse edit(Long meId, Long conversationId, Long messageId, String content) {
        Message message = requireOwnMessage(meId, conversationId, messageId);
        if (message.isDeleted()) {
            throw ApiException.conflict("This message was deleted");
        }
        String text = content.strip();
        if (text.isEmpty()) {
            throw ApiException.badRequest("Message cannot be empty");
        }
        if (!text.equals(message.getContent())) {
            message.setContent(text);
            message.setEditedAt(Instant.now());
            announceChange(meId, message);
        }
        return toResponse(message);
    }

    /** Deletes for both people: the text is erased and the row stays as a "deleted" placeholder. Safe to repeat. */
    @Transactional
    public void delete(Long meId, Long conversationId, Long messageId) {
        Message message = requireOwnMessage(meId, conversationId, messageId);
        if (message.isDeleted()) {
            return;
        }
        message.setDeleted(true);
        message.setContent("");
        announceChange(meId, message);
    }

    private Message requireOwnMessage(Long meId, Long conversationId, Long messageId) {
        Conversation conversation = conversationService.requireAccessible(meId, conversationId);
        Message message = messageRepository.findInConversation(messageId, conversationId)
                .filter(m -> m.getId() > conversation.clearedBeforeFor(meId)) // one the person deleted with the conversation is gone for them
                .orElseThrow(() -> ApiException.notFound("Message not found"));
        if (!message.getSender().getId().equals(meId)) {
            throw ApiException.forbidden("You can only change your own messages");
        }
        return message;
    }

    /** After commit the other person's open chat is told, so the change shows without a reload. */
    private void announceChange(Long meId, Message message) {
        Conversation c = message.getConversation();
        Long recipientId = c.getUserOne().getId().equals(meId) ? c.getUserTwo().getId() : c.getUserOne().getId();
        events.publishEvent(new MessageChangedEvent(recipientId, toResponse(message)));
    }

    @Transactional(readOnly = true)
    public UnreadCountResponse unreadCount(Long meId, Long conversationId) {
        long clearedBefore = conversationService.requireReadable(meId, conversationId).clearedBeforeFor(meId);
        return new UnreadCountResponse(messageRepository.countUnread(conversationId, meId, clearedBefore));
    }

    @Transactional(readOnly = true)
    public UnreadCountResponse totalUnreadCount(Long meId) {
        return new UnreadCountResponse(messageRepository.countUnreadTotal(meId));
    }

    /** Idempotent; marks the other participant's messages as read. */
    @Transactional
    public void markRead(Long meId, Long conversationId) {
        conversationService.requireReadable(meId, conversationId);
        messageRepository.markRead(conversationId, meId, Instant.now());
    }

    private MessageResponse toResponse(Message m) {
        return new MessageResponse(m.getId(), m.getConversation().getId(), userMapper.toSummary(m.getSender()),
                m.getContent(), m.getCreatedAt(), m.getEditedAt(), m.isDeleted());
    }
}
