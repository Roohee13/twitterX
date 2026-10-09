package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Deleting an account erases what the person wrote in direct messages and their stored files. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccountErasureTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    EmailSender emailSender;

    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    record Account(long id, String username, String token) {
    }

    @BeforeEach
    void storageHasEveryUpload() {
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenAnswer(inv -> {
                    String key = inv.<HeadObjectRequest>getArgument(0).key();
                    if (key.endsWith("missing.png")) {
                        throw NoSuchKeyException.builder().build();
                    }
                    return HeadObjectResponse.builder().contentType("image/png").contentLength(1000L).build();
                });
    }

    private Account register() throws Exception {
        String username = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\",\"password\":\"password123\",\"displayName\":\"Test User\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.user.id")).longValue(), username, JsonPath.read(body, "$.accessToken"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, Account a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private long conversation(Account me, Account other) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations"), me).contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + other.username() + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private String key(Account owner, String name) {
        return "users/" + owner.id() + "/" + name;
    }

    private String send(Account from, long conversationId, String json, int expected) throws Exception {
        return mvc.perform(auth(post("/api/conversations/" + conversationId + "/messages"), from).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    @Test
    void deletingAnAccountErasesItsMessagesAndFilesButNotTheOtherPersonsMessages() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);
        send(ann, c, "{\"content\":\"secret words\",\"mediaKeys\":[\"" + key(ann, "a.png") + "\"]}", 201);
        send(ben, c, "{\"content\":\"ben says hi\"}", 201);
        when(s3Client.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder()
                .contents(S3Object.builder().key(key(ann, "a.png")).build(), S3Object.builder().key(key(ann, "avatar.png")).build())
                .isTruncated(false).build());

        mvc.perform(auth(delete("/api/users/me"), ann).contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());

        assertThat(jdbc.queryForObject("select count(*) from messages where sender_id = ? and content <> ''", Integer.class, ann.id())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from messages where sender_id = ? and deleted = false", Integer.class, ann.id())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from message_media mm join messages m on m.id = mm.message_id where m.sender_id = ?",
                Integer.class, ann.id())).isZero();
        assertThat(jdbc.queryForObject("select content from messages where sender_id = ?", String.class, ben.id())).isEqualTo("ben says hi");

        ArgumentCaptor<ListObjectsV2Request> listed = ArgumentCaptor.forClass(ListObjectsV2Request.class);
        verify(s3Client).listObjectsV2(listed.capture());
        assertThat(listed.getValue().prefix()).isEqualTo("users/" + ann.id() + "/");
        ArgumentCaptor<DeleteObjectsRequest> deleted = ArgumentCaptor.forClass(DeleteObjectsRequest.class);
        verify(s3Client).deleteObjects(deleted.capture());
        assertThat(deleted.getValue().delete().objects()).hasSize(2);
    }
}
