package com.project.Xclone_backend.poll;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PollRepository extends JpaRepository<Poll, Long> {

    Optional<Poll> findByPostId(Long postId);

    List<Poll> findByPostIdIn(Collection<Long> postIds);

    @Query("select o from PollOption o where o.pollId in :pollIds order by o.pollId, o.position")
    List<PollOption> findOptions(Collection<Long> pollIds);

    @Query("select v from PollVote v where v.userId = :userId and v.pollId in :pollIds")
    List<PollVote> findVotes(Long userId, Collection<Long> pollIds);

    /** Idempotent: 1 if the vote was recorded, 0 if this person had already voted in the poll. */
    @Modifying
    @Query(value = """
            insert into poll_votes (poll_id, option_id, user_id, created_at) values (:pollId, :optionId, :userId, now())
            on conflict (poll_id, user_id) do nothing
            """, nativeQuery = true)
    int vote(Long pollId, Long optionId, Long userId);

    /** Clears the persistence context so options read afterwards (to answer the vote) show the new count, not the one loaded before the update. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PollOption o set o.voteCount = o.voteCount + :delta where o.id = :id")
    void addToVoteCount(Long id, int delta);

    // --- Account deletion: the person's votes leave the totals, like their likes do.

    @Modifying
    @Query(value = """
            update poll_options o set vote_count = o.vote_count - v.n
            from (select option_id, count(*) as n from poll_votes where user_id = :userId group by option_id) v
            where o.id = v.option_id
            """, nativeQuery = true)
    void decrementCountsForVoter(Long userId);

    @Modifying
    @Query("delete from PollVote v where v.userId = :userId")
    void deleteVotesByUser(Long userId);
}
