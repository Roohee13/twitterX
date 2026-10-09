package com.project.Xclone_backend.poll;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;

/** At most one per post. Plain ids rather than relations: polls are always loaded in batches by post id. */
@Entity
@Table(name = "polls", uniqueConstraints = @UniqueConstraint(name = "uk_polls_post", columnNames = "post_id"))
@Getter
@Setter
@NoArgsConstructor
public class Poll {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "post_id", nullable = false)
    private Long postId;

    @Column(nullable = false)
    private Instant expiresAt;

    public boolean hasEnded(Instant now) {
        return !expiresAt.isAfter(now);
    }
}
