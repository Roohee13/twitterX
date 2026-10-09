package com.project.Xclone_backend.conversation;

import java.time.Instant;
import java.util.List;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class GroupDtos {

    private static final String USERNAME = "^[a-zA-Z0-9_]{3,15}$";
    private static final String USERNAME_MESSAGE = "must be 3-15 characters: letters, digits or underscore";

    private GroupDtos() {
    }

    /** {@code usernames}: the people to start the group with, not counting the caller (who becomes its owner). */
    public record CreateGroupRequest(
            @NotBlank @Size(max = Conversation.MAX_TITLE) String title,
            @NotEmpty @Size(max = GroupConversationService.MAX_MEMBERS - 1) List<@NotBlank @Pattern(regexp = USERNAME, message = USERNAME_MESSAGE) String> usernames) {
    }

    public record UpdateGroupRequest(@NotBlank @Size(max = Conversation.MAX_TITLE) String title) {
    }

    public record AddMembersRequest(
            @NotEmpty @Size(max = GroupConversationService.MAX_MEMBERS - 1) List<@NotBlank @Pattern(regexp = USERNAME, message = USERNAME_MESSAGE) String> usernames) {
    }

    public record MemberResponse(UserSummary user, MemberRole role, Instant joinedAt) {
    }
}
