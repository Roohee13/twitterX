package com.project.Xclone_backend.report;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface UserReportRepository extends JpaRepository<UserReport, Long> {

    /** Returns 1 if the report was created, 0 if this reporter already reported this user. */
    @Modifying
    @Query(value = """
            insert into user_reports (reporter_id, reported_user_id, reason, created_at)
            values (:reporterId, :reportedUserId, :reason, now())
            on conflict (reporter_id, reported_user_id) do nothing
            """, nativeQuery = true)
    int report(Long reporterId, Long reportedUserId, String reason);

    boolean existsByReporterIdAndReportedUserId(Long reporterId, Long reportedUserId);

    /** Reports in the given statuses, newest first (cursor = report id). */
    @Query("""
            select r from UserReport r join fetch r.reporter join fetch r.reportedUser left join fetch r.handledBy
            where r.status in :statuses and r.id < :cursor
            order by r.id desc
            """)
    List<UserReport> findForAdmin(Collection<ReportStatus> statuses, long cursor, Limit limit);

    /** How many reports each of these accounts has received in total, as {@code [userId, count]} rows. */
    @Query("select r.reportedUser.id, count(r) from UserReport r where r.reportedUser.id in :userIds group by r.reportedUser.id")
    List<Object[]> countByReportedUser(Collection<Long> userIds);

    /** True when no report about this account is waiting for review (used to alert admins once, not once per report). */
    boolean existsByReportedUserIdAndStatus(Long reportedUserId, ReportStatus status);

    @Query("select r from UserReport r join fetch r.reporter where r.reportedUser.id = :userId and r.status = com.project.Xclone_backend.report.ReportStatus.OPEN")
    List<UserReport> findOpenAbout(Long userId);

    @Modifying
    @Query("update UserReport r set r.status = :status, r.handledBy.id = :adminId, r.handledAt = :now, r.adminNote = :note where r.id = :id")
    int markHandled(Long id, ReportStatus status, Long adminId, Instant now, String note);

    /** Every still-open report about the account becomes RESOLVED (it was suspended or removed). */
    @Modifying
    @Query("""
            update UserReport r set r.status = com.project.Xclone_backend.report.ReportStatus.RESOLVED,
                   r.handledBy.id = :adminId, r.handledAt = :now, r.adminNote = :note
            where r.reportedUser.id = :userId and r.status = com.project.Xclone_backend.report.ReportStatus.OPEN
            """)
    int resolveOpenForUser(Long userId, Long adminId, Instant now, String note);

    @Query("select r from UserReport r join fetch r.reporter join fetch r.reportedUser where r.id = :id")
    java.util.Optional<UserReport> findWithPeople(Long id);

    @Modifying
    @Query("update UserReport r set r.status = com.project.Xclone_backend.report.ReportStatus.OPEN, r.handledBy = null, r.handledAt = null, r.adminNote = null where r.id = :id")
    int reopen(Long id);
}
