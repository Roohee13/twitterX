package com.project.Xclone_backend.report;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.post.Post;
import com.project.Xclone_backend.post.PostRepository;
import com.project.Xclone_backend.post.PostService;
import com.project.Xclone_backend.report.ReportDtos.AdminPostReportResponse;
import com.project.Xclone_backend.report.ReportDtos.AdminPostView;
import com.project.Xclone_backend.report.ReportDtos.AdminUserReportResponse;
import com.project.Xclone_backend.report.ReportDtos.ReportFilter;
import com.project.Xclone_backend.user.AccountStatus;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserDtos.UserSummary;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserRepository;
import com.project.Xclone_backend.user.UserService;

import lombok.RequiredArgsConstructor;

/**
 * Review of the reports users send about accounts and posts. Every method first checks that the caller is an admin
 * (a flag on the user, read from the database each time: admin traffic is tiny, and a revoked admin loses access at once).
 */
@Service
@RequiredArgsConstructor
public class AdminReportService {

    private final UserRepository userRepository;
    private final AdminGuard adminGuard;
    private final UserReportRepository userReportRepository;
    private final PostReportRepository postReportRepository;
    private final PostRepository postRepository;
    private final PostService postService;
    private final UserService userService;
    private final ModerationNotifier notifier;
    private final UserMapper userMapper;
    private final R2Properties r2;

    private void requireAdmin(Long userId) {
        adminGuard.requireAdmin(userId);
    }

    @Transactional(readOnly = true)
    public CursorPage<AdminUserReportResponse> userReports(Long adminId, ReportFilter filter, Long cursor, Integer limit) {
        requireAdmin(adminId);
        int n = CursorPage.clampLimit(limit);
        List<UserReport> rows = userReportRepository.findForAdmin(filter.statuses(), CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, UserReport::getId, page -> {
            Map<Long, Long> totals = totals(userReportRepository.countByReportedUser(
                    page.stream().map(r -> r.getReportedUser().getId()).distinct().toList()));
            return page.stream().map(r -> new AdminUserReportResponse(r.getId(), summary(r.getReporter()),
                    summary(r.getReportedUser()), r.getReportedUser().getStatus(), r.getReason(), r.getStatus(),
                    r.getCreatedAt(), summary(r.getHandledBy()), r.getHandledAt(), r.getAdminNote(), totals.getOrDefault(r.getReportedUser().getId(), 1L))).toList();
        });
    }

    @Transactional(readOnly = true)
    public CursorPage<AdminPostReportResponse> postReports(Long adminId, ReportFilter filter, Long cursor, Integer limit) {
        requireAdmin(adminId);
        int n = CursorPage.clampLimit(limit);
        List<PostReport> rows = postReportRepository.findForAdmin(filter.statuses(), CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, PostReport::getId, page -> {
            Map<Long, Long> totals = totals(postReportRepository.countByPost(
                    page.stream().map(r -> r.getPost().getId()).distinct().toList()));
            return page.stream().map(r -> new AdminPostReportResponse(r.getId(), summary(r.getReporter()), view(r.getPost()),
                    r.getReason(), r.getStatus(), r.getCreatedAt(), summary(r.getHandledBy()), r.getHandledAt(),
                    r.getAdminNote(), totals.getOrDefault(r.getPost().getId(), 1L))).toList();
        });
    }

    /** Sets a report's status. OPEN reopens it; the other two record who handled it and when, and tell the reporter the outcome. */
    @Transactional
    public void setUserReportStatus(Long adminId, Long reportId, ReportStatus status, String note) {
        requireAdmin(adminId);
        UserReport report = userReportRepository.findWithPeople(reportId)
                .orElseThrow(() -> ApiException.notFound("Report not found"));
        if (status == ReportStatus.OPEN) {
            userReportRepository.reopen(reportId);
            return;
        }
        userReportRepository.markHandled(reportId, status, adminId, Instant.now(), clean(note));
        if (report.getStatus() == ReportStatus.OPEN) {
            notifier.reportOutcome(report.getReporter(), status, "@" + report.getReportedUser().getUsername());
        }
    }

    @Transactional
    public void setPostReportStatus(Long adminId, Long reportId, ReportStatus status, String note) {
        requireAdmin(adminId);
        PostReport report = postReportRepository.findWithPeople(reportId)
                .orElseThrow(() -> ApiException.notFound("Report not found"));
        if (status == ReportStatus.OPEN) {
            postReportRepository.reopen(reportId);
            return;
        }
        postReportRepository.markHandled(reportId, status, adminId, Instant.now(), clean(note));
        if (report.getStatus() == ReportStatus.OPEN) {
            notifier.reportOutcome(report.getReporter(), status, "a post");
        }
    }

    /**
     * Removes a reported post (the same soft delete as the author's) and resolves every open report about it. The author
     * and the reporters are told. Safe to repeat: a second removal changes and tells nobody.
     */
    @Transactional
    public void removePost(Long adminId, Long postId, String note) {
        requireAdmin(adminId);
        Post post = postRepository.findById(postId).filter(p -> p.getRepostOf() == null)
                .orElseThrow(() -> ApiException.notFound("Post not found"));
        List<PostReport> open = postReportRepository.findOpenAbout(postId);
        if (!post.isDeleted()) {
            postService.softDelete(post);
            notifier.postRemoved(post, clean(note));
        }
        postReportRepository.resolveOpenForPost(postId, adminId, Instant.now(), clean(note));
        open.forEach(r -> notifier.reportOutcome(r.getReporter(), ReportStatus.RESOLVED, "a post"));
    }

    /** Reversible. Signs the account out everywhere, hides it, resolves its open reports and emails the user. */
    @Transactional
    public void suspendUser(Long adminId, Long userId, String note) {
        requireAdmin(adminId);
        User target = requireModerationTarget(adminId, userId);
        if (target.getStatus() == AccountStatus.SUSPENDED) {
            return;
        }
        userService.suspend(userId);
        resolveReportsAbout(adminId, userId, note);
        notifier.accountSuspended(target, clean(note));
    }

    @Transactional
    public void unsuspendUser(Long adminId, Long userId) {
        requireAdmin(adminId);
        User target = requireModerationTarget(adminId, userId);
        if (target.getStatus() == AccountStatus.SUSPENDED) {
            userService.unsuspend(userId);
            notifier.accountRestored(target);
        }
    }

    /** Permanent: the same anonymization as the user deleting their own account. The user is emailed first. */
    @Transactional
    public void removeUser(Long adminId, Long userId, String note) {
        requireAdmin(adminId);
        User target = requireModerationTarget(adminId, userId);
        String email = target.getEmail();
        resolveReportsAbout(adminId, userId, note);
        userService.removeAccountByAdmin(userId);
        notifier.accountRemoved(email, clean(note));
    }

    private User requireModerationTarget(Long adminId, Long userId) {
        User target = userRepository.findById(userId).filter(u -> u.getStatus() != AccountStatus.DELETED)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        if (target.getId().equals(adminId) || target.isAdmin()) {
            throw ApiException.forbidden("Admins cannot be suspended or removed");
        }
        return target;
    }

    private void resolveReportsAbout(Long adminId, Long userId, String note) {
        List<UserReport> open = userReportRepository.findOpenAbout(userId);
        userReportRepository.resolveOpenForUser(userId, adminId, Instant.now(), clean(note));
        String subject = "@" + userRepository.getReferenceById(userId).getUsername();
        open.forEach(r -> notifier.reportOutcome(r.getReporter(), ReportStatus.RESOLVED, subject));
    }

    private static String clean(String note) {
        return note == null || note.isBlank() ? null : note.strip();
    }

    private static Map<Long, Long> totals(List<Object[]> rows) {
        Map<Long, Long> totals = new HashMap<>();
        rows.forEach(row -> totals.put((Long) row[0], (Long) row[1]));
        return totals;
    }

    private UserSummary summary(User user) {
        return user == null ? null : userMapper.toSummary(user);
    }

    private AdminPostView view(Post post) {
        return new AdminPostView(post.getId(), userMapper.toSummary(post.getAuthor()), post.getContent(),
                post.getMedia().stream().map(m -> r2.publicUrl(m.getR2Key())).toList(), post.getCreatedAt(), post.isDeleted());
    }
}
