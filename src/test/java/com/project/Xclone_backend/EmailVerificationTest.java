package com.project.Xclone_backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

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

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** With enforcement on, an account must confirm its email before it can post, like, follow, message or upload. */
@SpringBootTest(properties = "app.security.require-verified-email=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EmailVerificationTest {

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

    record Account(long id, String username, String auth) {
    }

    private Account register() throws Exception {
        String name = "v" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + name + "\",\"email\":\"" + name
                        + "@example.com\",\"password\":\"password123\",\"displayName\":\"V\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.user.id")).longValue(), name, "Bearer " + JsonPath.read(body, "$.accessToken"));
    }

    @Test
    void unverifiedAccountsCanReadAndManageThemselvesButNotPostOrInteract() throws Exception {
        Account verified = register();
        jdbc.update("update users set email_verified = true where id = ?", verified.id());
        Account fresh = register();
        String postId = JsonPath.read(mvc.perform(post("/api/posts").header("Authorization", verified.auth())
                .contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"hello\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id").toString();

        // Allowed: reading, own settings, safety tools.
        mvc.perform(get("/api/users/me").header("Authorization", fresh.auth())).andExpect(status().isOk());
        mvc.perform(get("/api/timeline").header("Authorization", fresh.auth())).andExpect(status().isOk());
        Account other = register();
        mvc.perform(post("/api/users/" + other.username() + "/block").header("Authorization", fresh.auth()))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/users/" + verified.username() + "/report").header("Authorization", fresh.auth())
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}")).andExpect(status().isNoContent());

        // Refused until verified.
        mvc.perform(post("/api/posts").header("Authorization", fresh.auth()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"spam\"}")).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Verify your email")));
        mvc.perform(post("/api/posts/" + postId + "/like").header("Authorization", fresh.auth())).andExpect(status().isForbidden());
        mvc.perform(post("/api/posts/" + postId + "/repost").header("Authorization", fresh.auth())).andExpect(status().isForbidden());
        mvc.perform(post("/api/users/" + verified.username() + "/follow").header("Authorization", fresh.auth()))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/conversations").header("Authorization", fresh.auth()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + verified.username() + "\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/media/upload-url").header("Authorization", fresh.auth()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"contentType\":\"image/png\",\"contentLength\":10}")).andExpect(status().isForbidden());

        // Confirming the address lifts every restriction at once.
        jdbc.update("update users set email_verified = true where id = ?", fresh.id());
        mvc.perform(post("/api/posts").header("Authorization", fresh.auth()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"now allowed\"}")).andExpect(status().isCreated());
        mvc.perform(post("/api/posts/" + postId + "/like").header("Authorization", fresh.auth())).andExpect(status().isNoContent());
    }
}
