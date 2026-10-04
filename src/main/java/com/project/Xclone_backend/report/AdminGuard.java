package com.project.Xclone_backend.report;

import org.springframework.stereotype.Component;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserRepository;

import lombok.RequiredArgsConstructor;

/**
 * Who may use the admin endpoints. The flag is read from the database each time (admin traffic is tiny), so a revoked admin
 * loses access at once; login tokens carry no roles.
 */
@Component
@RequiredArgsConstructor
public class AdminGuard {

    private final UserRepository userRepository;

    /** Returns the admin, or throws 403 "Admins only". */
    public User requireAdmin(Long userId) {
        return userRepository.findById(userId).filter(User::isAdmin).orElseThrow(() -> ApiException.forbidden("Admins only"));
    }
}
