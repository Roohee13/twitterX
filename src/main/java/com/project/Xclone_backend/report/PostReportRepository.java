package com.project.Xclone_backend.report;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PostReportRepository extends JpaRepository<PostReport, Long> {

    /** Returns 1 if the report was created, 0 if this reporter already reported this post. */
    @Modifying
    @Query(value = """
            insert into post_reports (reporter_id, post_id, reason, created_at)
            values (:reporterId, :postId, :reason, now())
            on conflict (reporter_id, post_id) do nothing
            """, nativeQuery = true)
    int report(Long reporterId, Long postId, String reason);

    boolean existsByReporterIdAndPostId(Long reporterId, Long postId);

    /** Reports in the given statuses, newest first (cursor = report id). */
    @Query("""
            select r from PostReport r join fetch r.reporter join fetch r.post p join fetch p.author left join fetch r.handledBy
            where r.status in :statuses and r.id < :cursor
            order by r.id desc
            """)
    List<PostReport> findForAdmin(Collection<ReportStatus> statuses, long cursor, Limit limit);

    /** How many reports each of these posts has received in total, as {@code [postId, count]} rows. */
    @Query("select r.post.id, count(r) from PostReport r where r.post.id in :postIds group by r.post.id")
    List<Object[]> countByPost(Collection<Long> postIds);

    boolean existsByPostIdAndStatus(Long postId, ReportStatus status);

    @Query("select r from PostReport r join fetch r.reporter where r.post.id = :postId and r.status = com.project.Xclone_backend.report.ReportStatus.OPEN")
    List<PostReport> findOpenAbout(Long postId);

    @Modifying
    @Query("update PostReport r set r.status = :status, r.handledBy.id = :adminId, r.handledAt = :now, r.adminNote = :note where r.id = :id")
    int markHandled(Long id, ReportStatus status, Long adminId, Instant now, String note);

    @Query("select r from PostReport r join fetch r.reporter join fetch r.post where r.id = :id")
    java.util.Optional<PostReport> findWithPeople(Long id);

    @Modifying
    @Query("update PostReport r set r.status = com.project.Xclone_backend.report.ReportStatus.OPEN, r.handledBy = null, r.handledAt = null, r.adminNote = null where r.id = :id")
    int reopen(Long id);

    /** Every still-open report about a post becomes RESOLVED (the post was removed). */
    @Modifying
    @Query("""
            update PostReport r set r.status = com.project.Xclone_backend.report.ReportStatus.RESOLVED,
                   r.handledBy.id = :adminId, r.handledAt = :now, r.adminNote = :note
            where r.post.id = :postId and r.status = com.project.Xclone_backend.report.ReportStatus.OPEN
            """)
    int resolveOpenForPost(Long postId, Long adminId, Instant now, String note);
}
