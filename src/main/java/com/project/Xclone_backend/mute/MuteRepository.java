package com.project.Xclone_backend.mute;

import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MuteRepository extends JpaRepository<Mute, Long> {

    /** Idempotent: returns 1 if a new mute was created, 0 if it already existed. */
    @Modifying
    @Query(value = """
            insert into mutes (muter_id, muted_id, created_at)
            values (:muterId, :mutedId, now())
            on conflict (muter_id, muted_id) do nothing
            """, nativeQuery = true)
    int mute(Long muterId, Long mutedId);

    @Modifying
    @Query("delete from Mute m where m.muter.id = :muterId and m.muted.id = :mutedId")
    int unmute(Long muterId, Long mutedId);

    boolean existsByMuterIdAndMutedId(Long muterId, Long mutedId);

    @Query("""
            select m from Mute m join fetch m.muted
            where m.muter.id = :userId and m.id < :cursor
              and m.muted.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE
            order by m.id desc
            """)
    List<Mute> findMuted(Long userId, long cursor, Limit limit);

    /** Account deletion: a deleted user's own mutes are personal data. */
    @Modifying
    @Query("delete from Mute m where m.muter.id = :userId or m.muted.id = :userId")
    void deleteAllInvolving(Long userId);
}
