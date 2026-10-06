package com.project.Xclone_backend.message;

import java.time.Instant;
import java.util.List;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class MessageDtos {

    private MessageDtos() {
    }

    /** Text, photos or both: at least one is needed. {@code mediaKeys} come from {@code POST /api/media/upload-url} (up to 4). */
    public record SendMessageRequest(@Size(max = Message.MAX_LENGTH) String content, @Size(max = Message.MAX_MEDIA) List<String> mediaKeys) {
    }

    /**
     * {@code content} is empty and {@code deleted} true once the sender deleted it; {@code editedAt} is null if never edited.
     * {@code mediaUrls} are the attached photos (empty for none, and once deleted); {@code content} may be empty when there are photos.
     */
    public record MessageResponse(Long id, Long conversationId, UserSummary sender, String content,
            Instant createdAt, Instant editedAt, boolean deleted, List<String> mediaUrls) {
    }

    public record EditMessageRequest(@Size(max = Message.MAX_LENGTH) String content) {
    }

    public record UnreadCountResponse(long count) {
    }
}
