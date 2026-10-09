package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Polls attached to posts. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PollsTest {

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


    @org.junit.jupiter.api.BeforeEach
    void storageHasEveryUpload() {
        when(s3Client.headObject(any(software.amazon.awssdk.services.s3.model.HeadObjectRequest.class)))
                .thenReturn(software.amazon.awssdk.services.s3.model.HeadObjectResponse.builder().contentType("image/png").contentLength(1000L).build());
    }

    private String key(Account owner, String name) {
        return "users/" + owner.id() + "/" + name;
    }

    private static final String POLL = "{\"options\":[\"Cats\",\"Dogs\"],\"durationMinutes\":60}";

    private String create(Account who, String json, int expected) throws Exception {
        return mvc.perform(auth(post("/api/posts"), who).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    private long pollPost(Account who) throws Exception {
        String res = create(who, "{\"content\":\"Cats or dogs?\",\"poll\":" + POLL + "}", 201);
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private long optionId(long postId, int index) throws Exception {
        String res = mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.poll.options[" + index + "].id")).longValue();
    }

    private String vote(Account who, long postId, long optionId, int expected) throws Exception {
        return mvc.perform(auth(post("/api/posts/" + postId + "/poll/vote"), who).contentType(MediaType.APPLICATION_JSON)
                .content("{\"optionId\":" + optionId + "}")).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    @Test
    void aPollPostCarriesItsOptionsAndTheCreatorSeesNoVotesYet() throws Exception {
        Account ann = register();
        String res = create(ann, "{\"content\":\"Cats or dogs?\",\"poll\":" + POLL + "}", 201);

        JsonNode poll = new ObjectMapper().readTree(res).get("poll");
        assertThat(poll.get("options")).hasSize(2);
        assertThat(poll.get("options").get(0).get("text").asText()).isEqualTo("Cats");
        assertThat(poll.get("totalVotes").asInt()).isZero();
        assertThat(poll.get("ended").asBoolean()).isFalse();
        assertThat(poll.get("myVoteOptionId").isNull()).isTrue();

        // A poll with no text is fine; an ordinary post has no poll.
        create(ann, "{\"poll\":" + POLL + "}", 201);
        assertThat(create(ann, "{\"content\":\"plain\"}", 201)).contains("\"poll\":null");
    }

    @Test
    void invalidPollsAreRejected() throws Exception {
        Account ann = register();
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"Only one\"]}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"a\",\"b\",\"c\",\"d\",\"e\"]}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"Same\",\" same \"]}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"a\",\"   \"]}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"a\",\"" + "z".repeat(26) + "\"]}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"a\",\"b\"],\"durationMinutes\":1}}", 400);
        create(ann, "{\"content\":\"x\",\"poll\":{\"options\":[\"a\",\"b\"],\"durationMinutes\":99999}}", 400);

        long other = pollPost(register());
        create(ann, "{\"content\":\"reply\",\"replyToId\":" + other + ",\"poll\":" + POLL + "}", 400);
        create(ann, "{\"content\":\"quote\",\"quotedPostId\":" + other + ",\"poll\":" + POLL + "}", 400);
        create(ann, "{\"content\":\"pic\",\"mediaKeys\":[\"" + key(ann, "a.png") + "\"],\"poll\":" + POLL + "}", 400);
        mvc.perform(auth(post("/api/posts/thread"), ann).contentType(MediaType.APPLICATION_JSON)
                .content("{\"posts\":[{\"content\":\"one\"},{\"content\":\"two\",\"poll\":" + POLL + "}]}")).andExpect(status().isBadRequest());
    }

    @Test
    void votingCountsOncePerPersonAndShowsInEveryViewOfThePost() throws Exception {
        Account ann = register();
        Account ben = register();
        Account cat = register();
        long post = pollPost(ann);
        long cats = optionId(post, 0);
        long dogs = optionId(post, 1);

        String res = vote(ben, post, dogs, 200);
        assertThat(JsonPath.<Integer>read(res, "$.totalVotes")).isEqualTo(1);
        assertThat(JsonPath.<Number>read(res, "$.myVoteOptionId").longValue()).isEqualTo(dogs);
        vote(ben, post, cats, 409); // no second vote, not even for another option
        vote(ben, post, dogs, 409);
        vote(cat, post, cats, 200);
        vote(ann, post, cats, 200); // the author may vote too
        vote(register(), post, 999_999_999L, 400);
        mvc.perform(post("/api/posts/" + post + "/poll/vote").contentType(MediaType.APPLICATION_JSON).content("{\"optionId\":" + cats + "}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/api/posts/" + post + "/poll/vote"), ben).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());

        // Totals for everyone; "my vote" only for the voter.
        mvc.perform(get("/api/posts/" + post)).andExpect(jsonPath("$.poll.totalVotes").value(3))
                .andExpect(jsonPath("$.poll.options[0].voteCount").value(2)).andExpect(jsonPath("$.poll.options[1].voteCount").value(1))
                .andExpect(jsonPath("$.poll.myVoteOptionId").doesNotExist());
        mvc.perform(auth(get("/api/posts/" + post), ben)).andExpect(jsonPath("$.poll.myVoteOptionId").value(dogs));
        // In a feed, and inside a quote of the post.
        mvc.perform(auth(get("/api/users/" + ann.username() + "/posts"), ben)).andExpect(jsonPath("$.items[0].poll.myVoteOptionId").value(dogs));
        String quote = create(ben, "{\"content\":\"look\",\"quotedPostId\":" + post + "}", 201);
        assertThat(JsonPath.<Integer>read(quote, "$.quotedPost.poll.totalVotes")).isEqualTo(3);
        // A poll that is not on a post has nothing to vote in.
        long plain = ((Number) JsonPath.read(create(ann, "{\"content\":\"plain\"}", 201), "$.id")).longValue();
        vote(ben, plain, dogs, 404);
    }

    @Test
    void anEndedPollRefusesVotesButKeepsItsResults() throws Exception {
        Account ann = register();
        Account ben = register();
        long post = pollPost(ann);
        long cats = optionId(post, 0);
        vote(ben, post, cats, 200);

        jdbc.update("update polls set expires_at = now() - interval '1 minute' where post_id = ?", post);

        vote(register(), post, cats, 409);
        mvc.perform(get("/api/posts/" + post)).andExpect(jsonPath("$.poll.ended").value(true)).andExpect(jsonPath("$.poll.totalVotes").value(1));
    }

    @Test
    void votingFollowsTheSameAccessRulesAsReadingThePost() throws Exception {
        Account ann = register();
        Account blocked = register();
        Account stranger = register();
        long post = pollPost(ann);
        long cats = optionId(post, 0);
        mvc.perform(auth(post("/api/users/" + ann.username() + "/block"), blocked)).andExpect(status().isNoContent());
        vote(blocked, post, cats, 403);

        mvc.perform(auth(patch("/api/users/me"), ann).contentType(MediaType.APPLICATION_JSON).content("{\"protectedAccount\":true}"))
                .andExpect(status().isOk());
        vote(stranger, post, cats, 403);
    }

    @Test
    void deletingAnAccountTakesItsVotesOutOfTheTotals() throws Exception {
        Account ann = register();
        Account ben = register();
        Account cat = register();
        long post = pollPost(ann);
        long cats = optionId(post, 0);
        vote(ben, post, cats, 200);
        vote(cat, post, cats, 200);

        mvc.perform(auth(delete("/api/users/me"), ben).contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/posts/" + post)).andExpect(jsonPath("$.poll.totalVotes").value(1))
                .andExpect(jsonPath("$.poll.options[0].voteCount").value(1));
    }
}
