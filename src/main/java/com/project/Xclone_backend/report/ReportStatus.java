package com.project.Xclone_backend.report;

/** Where a report is in review. New reports are OPEN; an admin dismisses or resolves them (and can reopen). */
public enum ReportStatus {
    OPEN,
    /** Looked at; no action needed. */
    DISMISSED,
    /** Looked at and acted on (for example the post was removed). */
    RESOLVED
}
