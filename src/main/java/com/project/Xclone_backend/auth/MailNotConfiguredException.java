package com.project.Xclone_backend.auth;

/** There is no SMTP server configured, so a message could only have been logged. */
public class MailNotConfiguredException extends RuntimeException {

    public MailNotConfiguredException() {
        super("Email is not configured: set SPRING_MAIL_HOST (and the port, username and password) and restart the backend.");
    }
}
