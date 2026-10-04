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

    public UserSummary toSummary(User u) {
        return new UserSummary(u.getId(), u.getUsername(), u.getDisplayName(), r2.publicUrl(u.getAvatarKey()),
                u.isProtectedAccount());
    }

    public UserSummary toSummary(Long id, String username, String displayName, String avatarKey,
            boolean protectedAccount) {
        return new UserSummary(id, username, displayName, r2.publicUrl(avatarKey), protectedAccount);
    }

    public ProfileResponse toProfile(User u, long followers, long following, boolean followedByMe,
            boolean blockedByMe, boolean mutedByMe, boolean followRequestedByMe) {
        return new ProfileResponse(u.getId(), u.getUsername(), u.getDisplayName(), u.getBio(),
                r2.publicUrl(u.getAvatarKey()), r2.publicUrl(u.getBannerKey()), u.getCreatedAt(),
                followers, following, followedByMe, blockedByMe, mutedByMe, u.isProtectedAccount(), followRequestedByMe);
    }
}
