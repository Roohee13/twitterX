package com.project.Xclone_backend.poll;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "poll_options", indexes = @Index(name = "idx_poll_options_poll", columnList = "poll_id, position"))
@Getter
@Setter
@NoArgsConstructor
public class PollOption {

    public static final int MAX_LENGTH = 25;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "poll_id", nullable = false)
    private Long pollId;

    @Column(nullable = false)
    private int position;

    @Column(nullable = false, length = MAX_LENGTH)
    private String text;

    /** Kept in step with the votes by atomic updates in {@link PollRepository}. */
    @Column(nullable = false)
    private int voteCount;
}
