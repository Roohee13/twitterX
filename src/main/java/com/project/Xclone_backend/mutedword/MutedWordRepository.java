package com.project.Xclone_backend.mutedword;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MutedWordRepository extends JpaRepository<MutedWord, Long> {

    List<MutedWord> findByUserIdOrderByIdDesc(Long userId);

    Optional<MutedWord> findByUserIdAndWord(Long userId, String word);

    long countByUserId(Long userId);

    /** Idempotent: returns 1 if the word was added, 0 if the user already had it. */
    @Modifying
    @Query(value = """
            insert into muted_words (user_id, word, created_at) values (:userId, :word, now())
            on conflict (user_id, word) do nothing
            """, nativeQuery = true)
    int add(Long userId, String word);

    @Modifying
    @Query("delete from MutedWord w where w.id = :id and w.userId = :userId")
    int remove(Long id, Long userId);

    /** Account deletion: a deleted user's word list is personal data. */
    @Modifying
    @Query("delete from MutedWord w where w.userId = :userId")
    void deleteAllByUser(Long userId);
}
