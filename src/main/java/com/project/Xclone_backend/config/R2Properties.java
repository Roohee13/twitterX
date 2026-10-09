package com.project.Xclone_backend.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.r2")
public record R2Properties(
        String accountId,
        String accessKey,
        String secretKey,
        String bucket,
        String publicBaseUrl,
        Duration presignTtl,
        long maxImageBytes,
        /** Largest video a post may carry. */
        long maxVideoBytes,
        /** Empty for Cloudflare (the endpoint is derived from the account id). Set it only to point at another S3-compatible server, such as a local MinIO. */
        String endpointOverride) {

    public String endpoint() {
        if (endpointOverride != null && !endpointOverride.isBlank()) {
            return endpointOverride.strip();
        }
        return "https://" + accountId + ".r2.cloudflarestorage.com";
    }

    public String publicUrl(String key) {
        if (key == null) {
            return null;
        }
        String base = publicBaseUrl.endsWith("/") ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1) : publicBaseUrl;
        return base + "/" + key;
    }
}
