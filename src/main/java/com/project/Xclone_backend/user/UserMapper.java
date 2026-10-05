package com.project.Xclone_backend.user;

import org.springframework.stereotype.Component;

import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.user.UserDtos.ProfileResponse;
import com.project.Xclone_backend.user.UserDtos.UserResponse;
import com.project.Xclone_backend.user.UserDtos.UserSummary;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class UserMapper {

    private final R2Properties r2;

    public UserResponse toResponse(User u) {
        return new UserResponse(u.getId(), u.getUsername(), u.getEmail(), u.isEmailVerified(),
                u.getDisplayName(), u.getBio(), r2.publicUrl(u.getAvatarKey()), r2.publicUrl(u.getBannerKey()), u.getCreatedAt(),
                u.isProtectedAccount(), u.isAdmin());
    }

    /** The name shown for a deactivated account, everywhere it would otherwise appear. */
    public static final String UNAVAILABLE_NAME = "XClone user";

    /**
     * Every user shown to other people goes through here, so a deactivated (or suspended or removed) account is masked in one place: no handle,
     * picture or anything else, just {@link #UNAVAILABLE_NAME}. The id stays; it says nothing about the person and clients use it as a key.
     */
    public UserSummary toSummary(User u) {
        if (u.getStatus() != AccountStatus.ACTIVE) {
            return new UserSummary(u.getId(), "", UNAVAILABLE_NAME, null, false, true);
        }
        return toSummaryForAdmin(u);
    }

    /** The real details whatever the account's status: only for admin screens, which must show who a report is about. */
    public UserSummary toSummaryForAdmin(User u) {
        return new UserSummary(u.getId(), u.getUsername(), u.getDisplayName(), r2.publicUrl(u.getAvatarKey()),
                u.isProtectedAccount(), false);
    }

    public UserSummary toSummary(Long id, String username, String displayName, String avatarKey,
            boolean protectedAccount) {
        return new UserSummary(id, username, displayName, r2.publicUrl(avatarKey), protectedAccount, false);
    }

    /** What anyone sees when they open the profile of a deactivated account. */
    public ProfileResponse toUnavailableProfile(Long id) {
        return new ProfileResponse(id, "", UNAVAILABLE_NAME, null, null, null, null, 0, 0, false, false, false, false, false, true);
    }

    public ProfileResponse toProfile(User u, long followers, long following, boolean followedByMe,
            boolean blockedByMe, boolean mutedByMe, boolean followRequestedByMe) {
        return new ProfileResponse(u.getId(), u.getUsername(), u.getDisplayName(), u.getBio(),
                r2.publicUrl(u.getAvatarKey()), r2.publicUrl(u.getBannerKey()), u.getCreatedAt(),
                followers, following, followedByMe, blockedByMe, mutedByMe, u.isProtectedAccount(), followRequestedByMe, false);
    }
}
