package com.project.Xclone_backend.message;

import com.project.Xclone_backend.message.MessageDtos.MessageResponse;

/** Published inside the edit or delete transaction; consumers react after it commits. */
public record MessageChangedEvent(Long recipientId, MessageResponse message) {
}
