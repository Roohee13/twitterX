package com.project.Xclone_backend.report;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import com.project.Xclone_backend.user.AccountStatus;

public final class ReportDtos {

    private ReportDtos() {
    }

    public record ReportRequest(@NotNull ReportReason reason) {
    }

    // --- Admin review ---

    /** Which reports the admin lists show: still open, already handled (dismissed or resolved), or all. */
    public enum ReportFilter {
        OPEN, HANDLED, ALL;

        Set<ReportStatus> statuses() {
            return switch (this) {
                case OPEN -> Set.of(ReportStatus.OPEN);
                case HANDLED -> Set.of(ReportStatus.DISMISSED, ReportStatus.RESOLVED);
                case ALL -> Set.of(ReportStatus.values());
            };
        }
    }

    /** {@code note}: optional explanation, sent to the people affected (e.g. a removed post's author). */
    public record UpdateReportStatusRequest(@NotNull ReportStatus status, @Size(max = 500) String note) {
    }

    /** Body of the account and post actions; the body itself is optional. */
    public record NoteRequest(@Size(max = 500) String note) {
    }

    /** {@code totalReports}: how many reports (any status) this account has received, so repeat reports stand out. */
    public record AdminUserReportResponse(Long id, UserSummary reporter, UserSummary reportedUser,
            AccountStatus reportedUserStatus, ReportReason reason, ReportStatus status, Instant createdAt,
            UserSummary handledBy, Instant handledAt, String adminNote, long totalReports) {
    }

    /** The reported post as an admin sees it, whoever may normally see it. {@code removed}: it has been deleted. */
    public record AdminPostView(Long id, UserSummary author, String content, List<String> mediaUrls, Instant createdAt,
            boolean removed) {
    }

    public record AdminPostReportResponse(Long id, UserSummary reporter, AdminPostView post, ReportReason reason,
            ReportStatus status, Instant createdAt, UserSummary handledBy, Instant handledAt, String adminNote,
            long totalReports) {
    }
}
