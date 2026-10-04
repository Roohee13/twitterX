package com.project.Xclone_backend.auth;

/** The SMTP server refused the message or could not be reached. The message is the server's own reason (a login error, a timeout ...). */
public class MailDeliveryException extends RuntimeException {

    public MailDeliveryException(String reason, Throwable cause) {
        super(reason, cause);
    }
}
