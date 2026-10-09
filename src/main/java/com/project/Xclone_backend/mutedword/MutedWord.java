package com.project.Xclone_backend.mutedword;

import java.time.Instant;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A word or phrase one user does not want to see. Stored trimmed, with single spaces, in lower case. Inserted by {@link MutedWordRepository#add}. */
@Entity
@Table(name = "muted_words", uniqueConstraints = @UniqueConstraint(name = "uk_muted_words_user_word", columnNames = {"user_id", "word"}))
@Getter
@NoArgsConstructor
public class MutedWord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 50)
    private String word;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
}
