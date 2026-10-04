package com.project.Xclone_backend;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;
import com.project.Xclone_backend.auth.MailDeliveryException;
import com.project.Xclone_backend.auth.MailNotConfiguredException;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * The admin diagnostics endpoints ("send test email", "check image storage"): who may use them, where the message goes, and how each outcome is reported. What really happens on
 * the wire (login, timeouts, what arrives) is covered against an embedded SMTP server in EmailSenderTest. This class deliberately uses the
 * same mocked beans as AdminReportsTest so both share one Spring context (every extra context makes the test JVM slower to shut down).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminToolsTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @MockitoBean
    EmailSender emailSender;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    record Account(long id, String email, String token) {
    }

    private Account register(boolean admin) throws Exception {
        String username = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String email = username + "@example.com";
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"email\":\"" + email + "\",\"password\":\"password123\",\"displayName\":\"Test User\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(body, "$.user.id")).longValue();
        if (admin) {
            jdbc.update("update users set is_admin = true where id = ?", id);
        }
        return new Account(id, email, JsonPath.read(body, "$.accessToken"));
    }

    private org.springframework.test.web.servlet.ResultActions callTest(Account who) throws Exception {
        return mvc.perform(post("/api/admin/email/test").header("Authorization", "Bearer " + who.token()));
    }

    @Test
    void anAdminGetsATestEmailAtTheirOwnAddressOnly() throws Exception {
        Account admin = register(true);

        callTest(admin).andExpect(status().isNoContent());

        verify(emailSender).sendNow(eq(admin.email()), eq("XClone test email"), anyString());
    }

    @Test
    void theMailServersOwnReasonIsReportedWhenItRefusesTheMessage() throws Exception {
        Account admin = register(true);
        doThrow(new MailDeliveryException("535-5.7.8 Username and Password not accepted. For more information, go to 535 5.7.8 https://support.google.com/mail/?p=BadCredentials", null))
                .when(emailSender).sendNow(eq(admin.email()), anyString(), anyString());

        callTest(admin).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.detail").value(Matchers.startsWith("The mail server did not accept the message")))
                .andExpect(jsonPath("$.detail").value(Matchers.containsString("535-5.7.8 Username and Password not accepted")));
    }

    @Test
    void anAdminIsToldWhenEmailIsNotConfiguredAtAll() throws Exception {
        Account admin = register(true);
        doThrow(new MailNotConfiguredException()).when(emailSender).sendNow(eq(admin.email()), anyString(), anyString());

        callTest(admin).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(Matchers.containsString("Email is not configured: set SPRING_MAIL_HOST")));
    }

    @Test
    void onlyAdminsMayUseIt() throws Exception {
        Account normal = register(false);

        mvc.perform(post("/api/admin/email/test")).andExpect(status().isUnauthorized());
        callTest(normal).andExpect(status().isForbidden()).andExpect(jsonPath("$.detail").value("Admins only"));
        verify(emailSender, never()).sendNow(anyString(), anyString(), anyString());
    }

    // --- image storage check ---

    @Test
    void theStorageCheckIsForAdminsOnly() throws Exception {
        Account normal = register(false);

        mvc.perform(post("/api/admin/storage/check")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/admin/storage/check").header("Authorization", "Bearer " + normal.token())).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value("Admins only"));
    }

    @Test
    void anAdminWithoutStorageSettingsGetsAClearFirstStepInsteadOfAnError() throws Exception {
        Account admin = register(true);

        // (The test configuration has no R2 settings.)
        mvc.perform(post("/api/admin/storage/check").header("Authorization", "Bearer " + admin.token()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.steps[0].id").value("config")).andExpect(jsonPath("$.steps[0].ok").value(false))
                .andExpect(jsonPath("$.steps[0].detail").value(Matchers.containsString("R2_ACCOUNT_ID")))
                .andExpect(jsonPath("$.steps.length()").value(1));
        // The browser part answers the same way, and a malformed key cannot get past validation.
        mvc.perform(post("/api/admin/storage/check").header("Authorization", "Bearer " + admin.token()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"browserTestKey\":\"" + "x".repeat(301) + "\"}")).andExpect(status().isBadRequest());
    }
}
