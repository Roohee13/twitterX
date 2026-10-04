package com.project.Xclone_backend.media;

import java.util.List;

import jakarta.validation.constraints.Size;

public final class StorageCheckDtos {

    private StorageCheckDtos() {
    }

    /** Without a key: the server checks everything it can by itself. With the key of a test image the admin's browser uploaded: verifies and removes that one. */
    public record StorageCheckRequest(@Size(max = 300) String browserTestKey) {
    }

    /** {@code hint}: what to change when the step failed (null when it passed). */
    public record StorageStep(String id, String label, boolean ok, String detail, String hint) {
    }

    public record StorageCheckResponse(boolean ok, List<StorageStep> steps) {
    }
}
