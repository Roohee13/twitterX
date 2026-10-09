package com.project.Xclone_backend.conversation;

import java.time.Instant;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public final class ConversationDtos {

    private ConversationDtos() {
    }

    public record CreateConversationRequest(
            @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]{3,15}$",
                    message = "must be 3-15 characters: letters, digits or underscore") String username) {
    }

    /**
     * {@code content} is empty and {@code deleted} true when the sender deleted the message; {@code hasMedia} when it carries photos.
     * {@code senderName} is the sender's display name, filled for groups only (the inbox shows "Alice: ..."), null otherwise.
     */
    public record LastMessage(Long id, Long senderId, String content, Instant createdAt, boolean deleted, boolean hasMedia, String senderName) {
    }

    /**
     * {@code participant} is the other user in a DIRECT conversation, never the caller; null for a GROUP, which has {@code title} and
     * {@code memberCount} instead (both null for a direct one). {@code lastMessage} is null while nobody has written yet;
     * {@code unreadCount} is how many of the other people's messages the caller has not read.
     */
    public record ConversationResponse(Long id, ConversationType type, String title, Integer memberCount, UserSummary participant,
            Instant createdAt, Instant updatedAt, LastMessage lastMessage, long unreadCount) {
    }

    /**
     * Pushed to /user/queue/conversation-updates when a group the person belongs to is created, renamed or has its members changed, or when
     * they are no longer in it ({@code removed} true, {@code conversation} null).
     */
    public record ConversationUpdate(Long conversationId, boolean removed, ConversationResponse conversation) {
    }
}
