package com.project.Xclone_backend.message;

import java.time.Instant;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class MessageDtos {

    private MessageDtos() {
    }

    public record SendMessageRequest(@NotBlank @Size(max = Message.MAX_LENGTH) String content) {
    }

    /** {@code content} is empty and {@code deleted} true once the sender deleted it; {@code editedAt} is null if never edited. */
    public record MessageResponse(Long id, Long conversationId, UserSummary sender, String content,
            Instant createdAt, Instant editedAt, boolean deleted) {
    }

    public record EditMessageRequest(@NotBlank @Size(max = Message.MAX_LENGTH) String content) {
    }

    public record UnreadCountResponse(long count) {
    }
}
