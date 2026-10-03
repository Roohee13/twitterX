package com.project.Xclone_backend.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** With the cache switched on, deactivating an account must still cut off its token on the next request. */
@SpringBootTest(properties = "app.security.active-user-cache-ttl=60s")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ActiveUserCacheIntegrationTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    EmailSender emailSender;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    @Test
    void deactivationTakesEffectImmediatelyDespiteTheCache() throws Exception {
        String name = "c" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + name + "\",\"email\":\"" + name
                        + "@example.com\",\"password\":\"password123\",\"displayName\":\"C\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String auth = "Bearer " + JsonPath.read(body, "$.accessToken");

        // Primes the cache, then a second call is served from it.
        mvc.perform(get("/api/users/me").header("Authorization", auth)).andExpect(status().isOk());
        mvc.perform(get("/api/users/me").header("Authorization", auth)).andExpect(status().isOk());

        mvc.perform(post("/api/users/me/deactivate").header("Authorization", auth)).andExpect(status().isNoContent());

        mvc.perform(get("/api/users/me").header("Authorization", auth)).andExpect(status().isUnauthorized());
    }
}
