package com.project.Xclone_backend.poll;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One row per voter and poll. Inserted by a native ON CONFLICT query so two taps at once cannot count twice. */
@Entity
@Table(name = "poll_votes",
        uniqueConstraints = @UniqueConstraint(name = "uk_poll_votes_voter", columnNames = {"poll_id", "user_id"}),
        indexes = @Index(name = "idx_poll_votes_user", columnList = "user_id"))
@Getter
@NoArgsConstructor
public class PollVote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "poll_id", nullable = false)
    private Long pollId;

    @Column(name = "option_id", nullable = false)
    private Long optionId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false)
    private Instant createdAt;
}
