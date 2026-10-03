package com.project.Xclone_backend.follow;

import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface FollowRequestRepository extends JpaRepository<FollowRequest, Long> {

    /** Idempotent: returns 1 if a new request was created, 0 if one was already pending. */
    @Modifying
    @Query(value = """
            insert into follow_requests (requester_id, target_id, created_at)
            values (:requesterId, :targetId, now())
            on conflict (requester_id, target_id) do nothing
            """, nativeQuery = true)
    int request(Long requesterId, Long targetId);

    @Modifying
    @Query("delete from FollowRequest r where r.requester.id = :requesterId and r.target.id = :targetId")
    int cancel(Long requesterId, Long targetId);

    boolean existsByRequesterIdAndTargetId(Long requesterId, Long targetId);

    /** Pending requests to one account, newest first. */
    @Query("""
            select r from FollowRequest r join fetch r.requester
            where r.target.id = :targetId and r.id < :cursor
              and r.requester.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE
            order by r.id desc
            """)
    List<FollowRequest> findIncoming(Long targetId, long cursor, Limit limit);

    @Modifying
    @Query("delete from FollowRequest r where r.target.id = :targetId")
    void deleteAllTo(Long targetId);

    @Modifying
    @Query("delete from FollowRequest r where r.requester.id = :userId or r.target.id = :userId")
    void deleteAllInvolving(Long userId);
}
