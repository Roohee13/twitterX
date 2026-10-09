package com.project.Xclone_backend.conversation;

import com.project.Xclone_backend.conversation.ConversationDtos.ConversationUpdate;

/** Published inside the transaction that changed a group; consumers react after it commits. One per person told, since each sees their own unread count. */
public record ConversationUpdatedEvent(Long recipientId, ConversationUpdate update) {
}
