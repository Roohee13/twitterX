package com.project.Xclone_backend.user;

import java.time.Instant;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class UserDtos {

    private UserDtos() {
    }

    /** Full user, returned for the current user and on auth. */
    public record UserResponse(Long id, String username, String email, boolean emailVerified, String displayName,
            String bio, String avatarUrl, String bannerUrl, Instant createdAt, boolean protectedAccount,
            boolean admin) {
    }

    /** Compact user embedded in posts and user lists. */
    public record UserSummary(Long id, String username, String displayName, String avatarUrl,
            boolean protectedAccount) {
    }

    /** {@code mutualFollowCount}: how many people you follow follow this account (0 for popular-account fallbacks). */
    public record SuggestionResponse(UserSummary user, long mutualFollowCount) {
    }

    public record ProfileResponse(Long id, String username, String displayName, String bio, String avatarUrl,
            String bannerUrl, Instant createdAt, long followerCount, long followingCount, boolean followedByMe,
            boolean blockedByMe, boolean mutedByMe, boolean protectedAccount, boolean followRequestedByMe) {
    }

    /** Null fields are left unchanged. An empty string clears bio/avatar/banner. Turning protection off approves pending follow requests. */
    public record UpdateProfileRequest(
            @Size(min = 1, max = 50) String displayName,
            @Size(max = 160) String bio,
            @Pattern(regexp = "^$|^users/.+", message = "must be an uploaded media key") String avatarKey,
            @Pattern(regexp = "^$|^users/.+", message = "must be an uploaded media key") String bannerKey,
            Boolean protectedAccount) {
    }

    public record ChangeUsernameRequest(
            @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_]{3,15}$",
                    message = "must be 3-15 characters: letters, digits or underscore") String username) {
    }

    public record ChangeEmailRequest(@NotBlank @Email @Size(max = 254) String email) {
    }

    public record ChangePasswordRequest(@NotBlank String currentPassword,
            @NotBlank @Size(min = 8, max = 72) String newPassword) {
    }

    public record DeleteAccountRequest(@NotBlank String password) {
    }
}
