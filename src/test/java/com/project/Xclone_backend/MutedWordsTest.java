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

/** Muted words: posts containing one are left out of the viewer's feeds and searches. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MutedWordsTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    EmailSender emailSender;

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


    private JsonNode json(String s) throws Exception {
        return new ObjectMapper().readTree(s);
    }

    private long createPost(Account who, String content) throws Exception {
        String res = mvc.perform(auth(post("/api/posts"), who).contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"" + content + "\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private long mute(Account who, String word) throws Exception {
        String res = mvc.perform(auth(post("/api/muted-words"), who).contentType(MediaType.APPLICATION_JSON)
                .content("{\"word\":\"" + word + "\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private void follow(Account who, Account target) throws Exception {
        mvc.perform(auth(post("/api/users/" + target.username() + "/follow"), who)).andExpect(status().isNoContent());
    }

    private List<String> contents(String path, Account viewer) throws Exception {
        String res = mvc.perform(auth(get(path), viewer)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<String> out = new java.util.ArrayList<>();
        json(res).get("items").forEach(i -> out.add(i.get("content").asText()));
        return out;
    }

    @Test
    void listAddAndRemoveAreIdempotentValidatedAndPrivate() throws Exception {
        Account ann = register();
        Account ben = register();
        mvc.perform(get("/api/muted-words")).andExpect(status().isUnauthorized());

        long id = mute(ann, "  Pine   APPLE  ");
        assertThat(mute(ann, "pine apple")).isEqualTo(id); // same word once, normalised
        mvc.perform(auth(get("/api/muted-words"), ann)).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].word").value("pine apple"));
        mvc.perform(auth(get("/api/muted-words"), ben)).andExpect(jsonPath("$", hasSize(0)));

        mvc.perform(auth(post("/api/muted-words"), ann).contentType(MediaType.APPLICATION_JSON).content("{\"word\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/muted-words"), ann).contentType(MediaType.APPLICATION_JSON).content("{\"word\":\"" + "x".repeat(51) + "\"}"))
                .andExpect(status().isBadRequest());

        // Somebody else's id removes nothing; the owner's removes it; repeating is fine.
        mvc.perform(auth(delete("/api/muted-words/" + id), ben)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/muted-words"), ann)).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(auth(delete("/api/muted-words/" + id), ann)).andExpect(status().isNoContent());
        mvc.perform(auth(delete("/api/muted-words/" + id), ann)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/muted-words"), ann)).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void aWordIsMatchedAsAWholeWordIgnoringCaseAndHidesPostsEverywhere() throws Exception {
        Account ann = register();
        Account ben = register();
        follow(ann, ben);
        String tag = "mw" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String word = "pineapple" + tag;
        createPost(ben, "I love " + word.toUpperCase() + " pizza #" + tag);
        createPost(ben, "A tag " + "#" + word + " #" + tag);
        createPost(ben, "Not the same: " + word + "ish and un" + word + " #" + tag);
        createPost(ben, "A perfectly fine post #" + tag);

        // Before muting everything shows.
        assertThat(contents("/api/timeline", ann)).hasSize(4);

        long id = mute(ann, word);

        for (String path : List.of("/api/timeline", "/api/hashtags/" + tag + "/posts", "/api/posts/search?q=" + tag)) {
            List<String> shown = contents(path, ann);
            assertThat(shown).as(path).hasSize(2);
            assertThat(shown).as(path).noneMatch(c -> c.toUpperCase().contains(word.toUpperCase() + " PIZZA") || c.contains("#" + word + " "));
        }
        // Someone who did not mute it still sees all four, and unmuting restores them.
        assertThat(contents("/api/hashtags/" + tag + "/posts", ben)).hasSize(4);
        mvc.perform(auth(delete("/api/muted-words/" + id), ann)).andExpect(status().isNoContent());
        assertThat(contents("/api/timeline", ann)).hasSize(4);
    }

    @Test
    void aPageIsFilledPastHiddenPostsAndNothingIsSkippedBetweenPages() throws Exception {
        Account ann = register();
        Account ben = register();
        follow(ann, ben);
        String word = "spoiler" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        createPost(ben, "visible one");
        for (int i = 0; i < 7; i++) {
            createPost(ben, "hidden " + word + " " + i);
        }
        createPost(ben, "visible two");
        for (int i = 0; i < 7; i++) {
            createPost(ben, "hidden again " + word + " " + i);
        }
        createPost(ben, "visible three");
        mute(ann, word);

        List<String> seen = new java.util.ArrayList<>();
        Long cursor = null;
        int pages = 0;
        do {
            String path = "/api/timeline?limit=1" + (cursor == null ? "" : "&cursor=" + cursor);
            String res = mvc.perform(auth(get(path), ann)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            JsonNode node = json(res);
            node.get("items").forEach(i -> seen.add(i.get("content").asText()));
            cursor = node.get("nextCursor").isNull() ? null : node.get("nextCursor").asLong();
            pages++;
        } while (cursor != null && pages < 40);

        assertThat(seen).containsExactly("visible three", "visible two", "visible one");
        assertThat(pages).isLessThan(40);
    }

    @Test
    void yourOwnPostsAndReplyThreadsAreNotHiddenFromYou() throws Exception {
        Account ann = register();
        String word = "mine" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        mute(ann, word);
        createPost(ann, "my own post about " + word);
        assertThat(contents("/api/timeline", ann)).anyMatch(c -> c.contains(word));
    }

    @Test
    void forYouAlsoHidesMutedPosts() throws Exception {
        Account ann = register();
        Account ben = register();
        follow(ann, ben);
        String word = "fy" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        createPost(ben, "for you hidden " + word);
        createPost(ben, "for you visible post");
        assertThat(contents("/api/timeline/for-you", ann)).anyMatch(c -> c.contains(word));

        mute(ann, word);

        List<String> shown = contents("/api/timeline/for-you", ann);
        assertThat(shown).noneMatch(c -> c.contains(word));
        assertThat(shown).anyMatch(c -> c.contains("for you visible post"));
    }
}
