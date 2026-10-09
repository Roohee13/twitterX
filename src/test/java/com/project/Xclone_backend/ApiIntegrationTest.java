package com.project.Xclone_backend;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;
import com.project.Xclone_backend.hashtag.HashtagRepository;
import com.project.Xclone_backend.report.PostReportRepository;
import com.project.Xclone_backend.report.UserReportRepository;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    HashtagRepository hashtagRepository;

    @Autowired
    UserReportRepository userReportRepository;

    @Autowired
    PostReportRepository postReportRepository;

    @Autowired
    JdbcTemplate jdbc;

    @MockitoBean
    EmailSender emailSender;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    record Account(long id, String username, String accessToken, String refreshToken) {
    }

    @Test
    void registerLoginRefreshAndLogout() throws Exception {
        Account a = register();

        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + a.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(a.username()));

        mvc.perform(json(post("/api/auth/login"),
                        "{\"usernameOrEmail\":\"" + a.username().toUpperCase() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk());
        mvc.perform(json(post("/api/auth/login"),
                        "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized());

        String refreshed = mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken())))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String newRefresh = JsonPath.read(refreshed, "$.refreshToken");

        // The rotated-out token is dead, and reusing it revokes the whole token family.
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken())))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(newRefresh)))
                .andExpect(status().isUnauthorized());

        Account b = register();
        mvc.perform(json(post("/api/auth/logout"), refreshBody(b.refreshToken())))
                .andExpect(status().isNoContent());
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(b.refreshToken())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void duplicateAndInvalidRegistrationsAreRejected() throws Exception {
        Account a = register();
        mvc.perform(json(post("/api/auth/register"), registerBody(a.username(), "other-" + a.username())))
                .andExpect(status().isConflict());
        mvc.perform(json(post("/api/auth/register"),
                        "{\"username\":\"a!\",\"email\":\"bad\",\"password\":\"short\",\"displayName\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.username").exists())
                .andExpect(jsonPath("$.errors.password").exists());
    }

    @Test
    void writesRequireAuthentication() throws Exception {
        mvc.perform(json(post("/api/posts"), "{\"content\":\"hi\"}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/timeline")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void postsRepliesLikesAndDeletion() throws Exception {
        Account alice = register();
        Account bob = register();

        long postId = createPost(alice, "{\"content\":\"hello world\"}");
        mvc.perform(json(auth(post("/api/posts"), alice), "{\"content\":\"   \"}"))
                .andExpect(status().isBadRequest());

        long replyId = createPost(bob, "{\"content\":\"hi alice\",\"replyToId\":" + postId + "}");

        // Liking twice is idempotent.
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/posts/" + postId), bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.likeCount").value(1))
                .andExpect(jsonPath("$.replyCount").value(1))
                .andExpect(jsonPath("$.likedByMe").value(true));
        mvc.perform(get("/api/posts/" + postId))
                .andExpect(jsonPath("$.likedByMe").value(false));

        mvc.perform(get("/api/posts/" + postId + "/replies"))
                .andExpect(jsonPath("$.items[0].id").value(replyId))
                .andExpect(jsonPath("$.items[0].replyToId").value(postId));
        mvc.perform(get("/api/posts/" + postId + "/likes"))
                .andExpect(jsonPath("$.items[0].username").value(bob.username()));
        mvc.perform(get("/api/users/" + bob.username() + "/likes"))
                .andExpect(jsonPath("$.items[0].id").value(postId));
        mvc.perform(get("/api/users/" + bob.username() + "/replies"))
                .andExpect(jsonPath("$.items[0].id").value(replyId));

        mvc.perform(auth(delete("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.likeCount").value(0));

        // Only the author may delete; deleting a reply decrements the parent's reply count.
        mvc.perform(auth(delete("/api/posts/" + postId), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/posts/" + replyId), bob)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.replyCount").value(0));
        mvc.perform(auth(delete("/api/posts/" + postId), alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isNotFound());
    }

    @Test
    void editingPosts() throws Exception {
        Account alice = register();
        Account bob = register();
        long postId = createPost(alice, "{\"content\":\"original\"}");
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        String before = mvc.perform(get("/api/posts/" + postId)).andReturn().getResponse().getContentAsString();

        mvc.perform(json(patch("/api/posts/" + postId), "{\"content\":\"x\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(auth(patch("/api/posts/" + postId), bob), "{\"content\":\"hijack\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(json(auth(patch("/api/posts/999999999"), alice), "{\"content\":\"x\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(json(auth(patch("/api/posts/" + postId), alice), "{\"content\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch("/api/posts/" + postId), alice), "{\"content\":\"" + "a".repeat(281) + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.content").value("original"));

        mvc.perform(json(auth(patch("/api/posts/" + postId), alice), "{\"content\":\"  edited  \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(postId))
                .andExpect(jsonPath("$.content").value("edited"))
                .andExpect(jsonPath("$.author.username").value(alice.username()))
                .andExpect(jsonPath("$.likeCount").value(1));

        String after = mvc.perform(get("/api/posts/" + postId)).andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertEquals(JsonPath.read(before, "$.createdAt").toString(),
                JsonPath.read(after, "$.createdAt").toString());
        org.junit.jupiter.api.Assertions.assertEquals("edited", JsonPath.read(after, "$.content"));

        mvc.perform(auth(delete("/api/posts/" + postId), alice)).andExpect(status().isNoContent());
        mvc.perform(json(auth(patch("/api/posts/" + postId), alice), "{\"content\":\"x\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void hashtags() throws Exception {
        Account alice = register();
        Account bob = register();
        // Unique per run so tags don't collide with posts from other tests.
        String t = "t" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);

        long postId = createPost(alice, "{\"content\":\"Learning #Java" + t + " #Spring" + t + " #JAVA" + t + "\"}");
        long otherId = createPost(bob, "{\"content\":\"#java" + t + " too\"}");

        // Case-insensitive lookup; a repeated tag links the post only once.
        mvc.perform(get("/api/hashtags/JAVA" + t + "/posts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", contains((int) otherId, (int) postId)));
        mvc.perform(get("/api/hashtags/{name}/posts", "#Spring" + t))
                .andExpect(jsonPath("$.items[*].id", contains((int) postId)));
        org.assertj.core.api.Assertions.assertThat(
                hashtagRepository.findByNameIn(List.of("java" + t, "spring" + t))).hasSize(2);

        // Keyset paging.
        mvc.perform(get("/api/hashtags/java" + t + "/posts").param("limit", "1"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.nextCursor").value(otherId));

        // Editing re-syncs tags: adding keeps old ones, replacing drops them.
        mvc.perform(json(auth(patch("/api/posts/" + postId), alice),
                        "{\"content\":\"Learning #Java" + t + " and #Boot" + t + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hashtags/java" + t + "/posts"))
                .andExpect(jsonPath("$.items[*].id", contains((int) otherId, (int) postId)));
        mvc.perform(get("/api/hashtags/boot" + t + "/posts"))
                .andExpect(jsonPath("$.items[*].id", contains((int) postId)));
        mvc.perform(get("/api/hashtags/spring" + t + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));

        mvc.perform(json(auth(patch("/api/posts/" + postId), alice), "{\"content\":\"Learning #React" + t + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hashtags/java" + t + "/posts"))
                .andExpect(jsonPath("$.items[*].id", contains((int) otherId)));
        mvc.perform(get("/api/hashtags/boot" + t + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/hashtags/react" + t + "/posts"))
                .andExpect(jsonPath("$.items[*].id", contains((int) postId)))
                .andExpect(jsonPath("$.items[0].author.username").value(alice.username()));

        // Deleted posts drop out; unknown tags give an empty page.
        mvc.perform(auth(delete("/api/posts/" + postId), alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/hashtags/react" + t + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/hashtags/nothing" + t + "/posts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void postSearch() throws Exception {
        Account alice = register();
        Account bob = register();
        String t = "s" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);

        long first = createPost(alice, "{\"content\":\"Hello Wide " + t.toUpperCase() + " world\"}");
        long second = createPost(bob, "{\"content\":\"another " + t + " post\"}");
        createPost(alice, "{\"content\":\"unrelated text\"}");

        // Matches are case-insensitive in both directions, newest first, and need no login.
        mvc.perform(get("/api/posts/search").param("q", t))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", contains((int) second, (int) first)))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
        mvc.perform(get("/api/posts/search").param("q", "  " + t.toUpperCase() + "  "))
                .andExpect(jsonPath("$.items[*].id", contains((int) second, (int) first)));

        // LIKE wildcards in the query are literal.
        mvc.perform(get("/api/posts/search").param("q", "%%"))
                .andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/posts/search").param("q", "__"))
                .andExpect(jsonPath("$.items", hasSize(0)));

        // Keyset paging.
        mvc.perform(get("/api/posts/search").param("q", t).param("limit", "1"))
                .andExpect(jsonPath("$.items[*].id", contains((int) second)))
                .andExpect(jsonPath("$.nextCursor").value(second));
        mvc.perform(get("/api/posts/search").param("q", t).param("limit", "1").param("cursor", String.valueOf(second)))
                .andExpect(jsonPath("$.items[*].id", contains((int) first)))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));

        // Blocking hides the blocked author's posts from the blocker (and vice versa), but not from anonymous users.
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/posts/search").param("q", t), alice))
                .andExpect(jsonPath("$.items[*].id", contains((int) first)));
        mvc.perform(auth(get("/api/posts/search").param("q", t), bob))
                .andExpect(jsonPath("$.items[*].id", contains((int) second)));
        mvc.perform(get("/api/posts/search").param("q", t))
                .andExpect(jsonPath("$.items", hasSize(2)));

        // Deleted posts drop out.
        mvc.perform(auth(delete("/api/posts/" + first), alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/search").param("q", t))
                .andExpect(jsonPath("$.items[*].id", contains((int) second)));

        // Empty, too short and too long queries are rejected.
        mvc.perform(get("/api/posts/search")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/posts/search").param("q", "")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/posts/search").param("q", "   ")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/posts/search").param("q", "a")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/posts/search").param("q", "a".repeat(101))).andExpect(status().isBadRequest());
    }

    @Test
    void trendingHashtags() throws Exception {
        Account alice = register();
        Account bob = register();
        String t = "t" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String wide = "wide" + t, spam = "spam" + t, once = "once" + t, gone = "gone" + t;

        // wide: 2 authors / 2 posts. spam: 1 author / 2 posts. once: 1 author / 1 post (neither of those can trend).
        createPost(alice, "{\"content\":\"#Wide" + t + " #Once" + t + "\"}");
        createPost(bob, "{\"content\":\"#wide" + t + "\"}");
        createPost(alice, "{\"content\":\"#spam" + t + "\"}");
        createPost(alice, "{\"content\":\"#spam" + t + " again\"}");
        long deleted = createPost(alice, "{\"content\":\"#" + gone + "\"}");
        mvc.perform(auth(delete("/api/posts/" + deleted), alice)).andExpect(status().isNoContent());

        // Public; a tag needs at least two different authors (one account posting twice cannot trend), and deleted posts do not count.
        String body = mvc.perform(get("/api/trending/hashtags").param("limit", "50"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> names = JsonPath.read(body, "$[*].name");
        org.assertj.core.api.Assertions.assertThat(names).contains(wide).doesNotContain(gone, spam, once);
        List<Integer> wideCounts = JsonPath.read(body, "$[?(@.name=='" + wide + "')].postCount");
        List<Integer> wideUsers = JsonPath.read(body, "$[?(@.name=='" + wide + "')].userCount");
        org.assertj.core.api.Assertions.assertThat(wideCounts).containsExactly(2);
        org.assertj.core.api.Assertions.assertThat(wideUsers).containsExactly(2);

        // Limit is honoured and out-of-range params are clamped rather than rejected.
        mvc.perform(get("/api/trending/hashtags").param("limit", "1"))
                .andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(get("/api/trending/hashtags").param("hours", "-5").param("limit", "0"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/trending/hashtags").param("hours", "100000"))
                .andExpect(status().isOk());
    }

    @Test
    void reportUser() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        String url = "/api/users/" + bob.username() + "/report";

        mvc.perform(json(post(url), "{\"reason\":\"SPAM\"}")).andExpect(status().isUnauthorized());
        mvc.perform(json(auth(post(url), alice), "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post(url), alice), "{\"reason\":\"FOO\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/users/nobody_" + UUID.randomUUID().toString().substring(0, 8) + "/report"),
                        alice), "{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(json(auth(post("/api/users/" + alice.username() + "/report"), alice), "{\"reason\":\"SPAM\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(json(auth(post(url), alice), "{\"reason\":\"HARASSMENT\"}")).andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(
                userReportRepository.existsByReporterIdAndReportedUserId(alice.id(), bob.id())).isTrue();
        mvc.perform(json(auth(post(url), alice), "{\"reason\":\"SPAM\"}")).andExpect(status().isConflict());
        mvc.perform(json(auth(post(url), carol), "{\"reason\":\"OTHER\"}")).andExpect(status().isNoContent());

        // Reporting does not affect the reported account.
        mvc.perform(get("/api/users/" + bob.username())).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/me"), bob)).andExpect(status().isOk());
    }

    @Test
    void reportPost() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long postId = createPost(alice, "{\"content\":\"reportable\"}");
        String url = "/api/posts/" + postId + "/report";

        mvc.perform(json(post(url), "{\"reason\":\"SPAM\"}")).andExpect(status().isUnauthorized());
        mvc.perform(json(auth(post(url), bob), "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post(url), bob), "{\"reason\":\"spam\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/posts/999999999/report"), bob), "{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(json(auth(post(url), alice), "{\"reason\":\"SPAM\"}")).andExpect(status().isBadRequest());

        mvc.perform(json(auth(post(url), bob), "{\"reason\":\"MISINFORMATION\"}")).andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(
                postReportRepository.existsByReporterIdAndPostId(bob.id(), postId)).isTrue();
        mvc.perform(json(auth(post(url), bob), "{\"reason\":\"SPAM\"}")).andExpect(status().isConflict());
        mvc.perform(json(auth(post(url), carol), "{\"reason\":\"OTHER\"}")).andExpect(status().isNoContent());

        // Reporting does not hide or change the post.
        mvc.perform(get("/api/posts/" + postId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("reportable"));

        // Deleted posts can no longer be reported.
        mvc.perform(auth(delete("/api/posts/" + postId), alice)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post(url), register()), "{\"reason\":\"SPAM\"}")).andExpect(status().isNotFound());
    }

    @Test
    void changeUsernameAndEmail() throws Exception {
        Account alice = register();
        Account bob = register();
        String newName = "n" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

        mvc.perform(json(patch("/api/users/me/username"), "{\"username\":\"" + newName + "\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(auth(patch("/api/users/me/username"), alice), "{\"username\":\"a!\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch("/api/users/me/username"), alice), "{\"username\":\"" + bob.username() + "\"}"))
                .andExpect(status().isConflict());
        mvc.perform(json(auth(patch("/api/users/me/username"), alice),
                        "{\"username\":\"" + alice.username().toUpperCase() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(alice.username()));

        mvc.perform(json(auth(patch("/api/users/me/username"), alice), "{\"username\":\"" + newName.toUpperCase() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(alice.id()))
                .andExpect(jsonPath("$.username").value(newName))
                .andExpect(jsonPath("$.displayName").value("Test User"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
        mvc.perform(get("/api/users/" + alice.username())).andExpect(status().isNotFound());
        mvc.perform(get("/api/users/" + newName)).andExpect(jsonPath("$.id").value(alice.id()));
        mvc.perform(auth(get("/api/users/me"), alice)).andExpect(jsonPath("$.username").value(newName));
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + newName + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk());
        mvc.perform(json(auth(patch("/api/users/me/username"), bob), "{\"username\":\"" + newName + "\"}"))
                .andExpect(status().isConflict());

        String newEmail = newName + "@Example.org";
        mvc.perform(json(auth(patch("/api/users/me/email"), alice), "{\"email\":\"not-an-email\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch("/api/users/me/email"), alice), "{\"email\":\"" + bob.username() + "@example.com\"}"))
                .andExpect(status().isConflict());
        mvc.perform(json(auth(patch("/api/users/me/email"), alice), "{\"email\":\"" + newEmail + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(newEmail.toLowerCase()))
                .andExpect(jsonPath("$.username").value(newName));
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + newEmail + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void changePassword() throws Exception {
        Account a = register();
        String url = "/api/users/me/password";

        mvc.perform(json(patch(url), "{\"currentPassword\":\"password123\",\"newPassword\":\"newpassword1\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(auth(patch(url), a), "{\"currentPassword\":\"wrong-pass\",\"newPassword\":\"newpassword1\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch(url), a), "{\"currentPassword\":\"password123\",\"newPassword\":\"short\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch(url), a), "{\"currentPassword\":\"password123\",\"newPassword\":\"newpassword1\"}"))
                .andExpect(status().isNoContent())
                .andExpect(jsonPath("$").doesNotExist());

        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"newpassword1\"}"))
                .andExpect(status().isOk());
        // Existing sessions are signed out.
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken()))).andExpect(status().isUnauthorized());
    }

    @Test
    void deactivateAccount() throws Exception {
        Account a = register();
        long postId = createPost(a, "{\"content\":\"still here\"}");

        mvc.perform(post("/api/users/me/deactivate")).andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/api/users/me/deactivate"), a)).andExpect(status().isNoContent());

        // The old access token stops working immediately, and no new session can be started.
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(status().isUnauthorized());
        mvc.perform(json(auth(post("/api/posts"), a), "{\"content\":\"nope\"}")).andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken()))).andExpect(status().isUnauthorized());

        // A wrong password does not reactivate: the old token would work again if the status had flipped.
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"wrong-pass\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(status().isUnauthorized());

        // Nothing is deleted, but nobody can see it: the profile is a blank "XClone user" and the post is gone for everyone.
        mvc.perform(get("/api/users/" + a.username())).andExpect(status().isOk())
                .andExpect(jsonPath("$.unavailable").value(true)).andExpect(jsonPath("$.displayName").value("XClone user"))
                .andExpect(jsonPath("$.username").value(""));
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isNotFound());

        // Logging in with the correct password (by email here) reactivates and issues a normal token pair.
        String body = mvc.perform(json(post("/api/auth/login"),
                        "{\"usernameOrEmail\":\"" + a.username() + "@example.com\",\"password\":\"password123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.user.id").value(a.id()))
                .andReturn().getResponse().getContentAsString();
        Account back = new Account(a.id(), a.username(), JsonPath.read(body, "$.accessToken"),
                JsonPath.read(body, "$.refreshToken"));

        mvc.perform(auth(get("/api/users/me"), back)).andExpect(status().isOk());
        // Signing in again brings the profile and the post back exactly as they were.
        mvc.perform(get("/api/users/" + a.username())).andExpect(status().isOk()).andExpect(jsonPath("$.unavailable").value(false))
                .andExpect(jsonPath("$.username").value(a.username()));
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk()).andExpect(jsonPath("$.content").value("still here"));
        createPost(back, "{\"content\":\"back again\"}");
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(back.refreshToken()))).andExpect(status().isOk());
        // Sessions revoked at deactivation stay revoked.
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken()))).andExpect(status().isUnauthorized());
    }

    @Test
    void deleteAccount() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        String tag = "d" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);

        long bobPost = createPost(bob, "{\"content\":\"bob here\"}");
        long alicePost = createPost(alice, "{\"content\":\"alice #" + tag + "\"}");
        createPost(alice, "{\"content\":\"reply from alice\",\"replyToId\":" + bobPost + "}");
        long bobReply = createPost(bob, "{\"content\":\"reply to alice\",\"replyToId\":" + alicePost + "}");
        mvc.perform(auth(post("/api/posts/" + bobPost + "/like"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), carol)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post("/api/users/" + alice.username() + "/report"), bob), "{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + bobPost))
                .andExpect(jsonPath("$.likeCount").value(1))
                .andExpect(jsonPath("$.replyCount").value(1));

        mvc.perform(json(delete("/api/users/me"), "{\"password\":\"password123\"}")).andExpect(status().isUnauthorized());
        mvc.perform(json(auth(delete("/api/users/me"), alice), "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(delete("/api/users/me"), alice), "{\"password\":\"wrong-pass\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/users/" + alice.username())).andExpect(status().isOk());

        mvc.perform(json(auth(delete("/api/users/me"), alice), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());

        // The account is gone and cannot be used.
        mvc.perform(get("/api/users/" + alice.username())).andExpect(status().isNotFound());
        mvc.perform(get("/api/users/search").param("q", alice.username())).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(auth(get("/api/users/me"), alice)).andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(alice.refreshToken()))).andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + alice.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isUnauthorized());

        // Alice's content and activity are removed, and counts on other users' posts are corrected.
        mvc.perform(get("/api/posts/" + alicePost)).andExpect(status().isNotFound());
        mvc.perform(get("/api/hashtags/" + tag + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/posts/" + bobPost))
                .andExpect(jsonPath("$.likeCount").value(0))
                .andExpect(jsonPath("$.replyCount").value(0));
        mvc.perform(get("/api/users/" + bob.username())).andExpect(jsonPath("$.followerCount").value(0));
        mvc.perform(get("/api/users/" + carol.username())).andExpect(jsonPath("$.followingCount").value(0));

        // Other users' content and reports stay intact.
        mvc.perform(get("/api/posts/" + bobReply))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replyToId").value(alicePost));
        org.assertj.core.api.Assertions.assertThat(
                userReportRepository.existsByReporterIdAndReportedUserId(bob.id(), alice.id())).isTrue();

        // The username and email are free again.
        mvc.perform(json(post("/api/auth/register"), registerBody(alice.username(), alice.username())))
                .andExpect(status().isCreated());
    }

    @Test
    void reposts() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long postId = createPost(alice, "{\"content\":\"worth sharing\"}");
        String url = "/api/posts/" + postId + "/repost";
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), carol)).andExpect(status().isNoContent());

        // Auth, existence and ownership rules.
        mvc.perform(post(url)).andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/api/posts/999999999/repost"), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(post(url), alice)).andExpect(status().isBadRequest());

        // Reposting twice keeps a single repost.
        mvc.perform(auth(post(url), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post(url), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/posts/" + postId), bob))
                .andExpect(jsonPath("$.repostCount").value(1))
                .andExpect(jsonPath("$.repostedByMe").value(true))
                .andExpect(jsonPath("$.repostedBy").value(nullValue()));
        mvc.perform(auth(get("/api/posts/" + postId), carol)).andExpect(jsonPath("$.repostedByMe").value(false));

        // The author gets exactly one REPOST notification; the self-repost attempt and the duplicate add none.
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].type").value("REPOST"))
                .andExpect(jsonPath("$.items[0].actor.username").value(bob.username()))
                .andExpect(jsonPath("$.items[0].postId").value(postId));

        // The repost appears in followers' timelines and the reposter's profile as the original post.
        String timeline = mvc.perform(auth(get("/api/timeline"), carol))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(postId))
                .andExpect(jsonPath("$.items[0].author.username").value(alice.username()))
                .andExpect(jsonPath("$.items[0].content").value("worth sharing"))
                .andExpect(jsonPath("$.items[0].repostedBy.username").value(bob.username()))
                .andExpect(jsonPath("$.items[0].repostCount").value(1))
                .andExpect(jsonPath("$.items[0].repostedByMe").value(false))
                .andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat((Object) JsonPath.read(timeline, "$.nextCursor")).isNull();
        mvc.perform(auth(get("/api/users/" + bob.username() + "/posts"), bob))
                .andExpect(jsonPath("$.items[0].id").value(postId))
                .andExpect(jsonPath("$.items[0].repostedBy.username").value(bob.username()))
                .andExpect(jsonPath("$.items[0].repostedByMe").value(true));
        // The original author's profile is unchanged: one post, not reposted.
        mvc.perform(get("/api/users/" + alice.username() + "/posts"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].repostedBy").value(nullValue()));

        // Undo is idempotent and removes the repost everywhere.
        mvc.perform(auth(delete(url), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(delete(url), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.repostCount").value(0));
        mvc.perform(auth(get("/api/timeline"), carol)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/users/" + bob.username() + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));

        // Reposting again works after an undo.
        mvc.perform(auth(post(url), bob)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.repostCount").value(1));

        // Deleting the original hides existing reposts, and it can no longer be reposted.
        mvc.perform(auth(delete("/api/posts/" + postId), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/timeline"), carol)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(post(url), carol)).andExpect(status().isNotFound());
    }

    @Test
    void repostAccessRules() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long postId = createPost(alice, "{\"content\":\"original\"}");
        mvc.perform(auth(post("/api/posts/" + postId + "/repost"), bob)).andExpect(status().isNoContent());

        // A repost row's own id is not a post that can be fetched or reposted.
        Long repostRowId = jdbc.queryForObject("select id from posts where author_id = ? and repost_of_id = ?",
                Long.class, bob.id(), postId);
        mvc.perform(get("/api/posts/" + repostRowId)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/posts/" + repostRowId + "/repost"), carol)).andExpect(status().isNotFound());

        // A deactivated user cannot repost with an old token.
        mvc.perform(auth(post("/api/users/me/deactivate"), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + postId + "/repost"), carol)).andExpect(status().isUnauthorized());

        // When the reposter deletes their account, their repost and its count go away.
        mvc.perform(json(auth(delete("/api/users/me"), bob), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + postId)).andExpect(jsonPath("$.repostCount").value(0));

        // Posts of a deleted account cannot be reposted.
        Account dave = register();
        mvc.perform(json(auth(delete("/api/users/me"), alice), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + postId + "/repost"), dave)).andExpect(status().isNotFound());
    }

    @Test
    void quotePosts() throws Exception {
        Account alice = register();
        Account bob = register();
        long original = createPost(alice, "{\"content\":\"original\"}");

        String res = mvc.perform(json(auth(post("/api/posts"), bob),
                        "{\"content\":\"my take\",\"quotedPostId\":" + original + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value("my take"))
                .andExpect(jsonPath("$.author.id").value(bob.id()))
                .andExpect(jsonPath("$.quotedPost.id").value(original))
                .andExpect(jsonPath("$.quotedPost.content").value("original"))
                .andExpect(jsonPath("$.quotedPost.author.id").value(alice.id()))
                .andExpect(jsonPath("$.quotedPost.quotedPost").value(nullValue()))
                .andReturn().getResponse().getContentAsString();
        long quote = ((Number) JsonPath.read(res, "$.id")).longValue();
        org.assertj.core.api.Assertions.assertThat(quote).isNotEqualTo(original);

        // The original is untouched, and the quote is a normal post on timelines and by id.
        mvc.perform(get("/api/posts/" + original))
                .andExpect(jsonPath("$.content").value("original"))
                .andExpect(jsonPath("$.likeCount").value(0))
                .andExpect(jsonPath("$.repostCount").value(0))
                .andExpect(jsonPath("$.quotedPost").value(nullValue()));
        mvc.perform(get("/api/posts/" + quote)).andExpect(jsonPath("$.quotedPost.id").value(original));
        mvc.perform(get("/api/users/" + bob.username() + "/posts"))
                .andExpect(jsonPath("$.items[0].id").value(quote))
                .andExpect(jsonPath("$.items[0].quotedPost.content").value("original"));
        mvc.perform(auth(get("/api/timeline"), bob)).andExpect(jsonPath("$.items[0].quotedPost.id").value(original));

        // A user can quote their own post, and quoting a quote shows only one level.
        mvc.perform(json(auth(post("/api/posts"), alice),
                        "{\"content\":\"quoting the quote\",\"quotedPostId\":" + quote + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.quotedPost.id").value(quote))
                .andExpect(jsonPath("$.quotedPost.quotedPost").value(nullValue()));

        // Deleting the original soft-deletes it; the quote survives and no longer exposes the original.
        mvc.perform(auth(delete("/api/posts/" + original), alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + quote))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("my take"))
                .andExpect(jsonPath("$.quotedPost").value(nullValue()));
        // ...and it cannot be quoted any more.
        mvc.perform(json(auth(post("/api/posts"), bob),
                        "{\"content\":\"too late\",\"quotedPostId\":" + original + "}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void quotePostValidationAndAccessRules() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long original = createPost(alice, "{\"content\":\"original\"}");
        String quoteBody = "{\"content\":\"hi\",\"quotedPostId\":" + original + "}";

        // Authentication is required.
        mvc.perform(json(post("/api/posts"), quoteBody)).andExpect(status().isUnauthorized());

        // The quoted post must exist.
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"hi\",\"quotedPostId\":999999999}"))
                .andExpect(status().isNotFound());

        // The usual content rules apply.
        mvc.perform(json(auth(post("/api/posts"), bob),
                        "{\"content\":\"" + "x".repeat(281) + "\",\"quotedPostId\":" + original + "}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"  \",\"quotedPostId\":" + original + "}"))
                .andExpect(status().isBadRequest());
        // A post is either a reply or a quote.
        mvc.perform(json(auth(post("/api/posts"), bob),
                        "{\"content\":\"hi\",\"quotedPostId\":" + original + ",\"replyToId\":" + original + "}"))
                .andExpect(status().isBadRequest());

        // A repost row's own id is not a post that can be quoted.
        mvc.perform(auth(post("/api/posts/" + original + "/repost"), bob)).andExpect(status().isNoContent());
        Long repostRowId = jdbc.queryForObject("select id from posts where author_id = ? and repost_of_id = ?",
                Long.class, bob.id(), original);
        mvc.perform(json(auth(post("/api/posts"), carol),
                        "{\"content\":\"hi\",\"quotedPostId\":" + repostRowId + "}"))
                .andExpect(status().isNotFound());

        // A deactivated user cannot quote with an old token.
        mvc.perform(auth(post("/api/users/me/deactivate"), carol)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post("/api/posts"), carol), quoteBody)).andExpect(status().isUnauthorized());

        // Posts of a deleted account cannot be quoted.
        mvc.perform(json(auth(delete("/api/users/me"), alice), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(json(auth(post("/api/posts"), bob), quoteBody)).andExpect(status().isNotFound());

        // Nothing was created by the rejected requests.
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "select count(*) from posts where author_id in (?, ?) and quote_of_id is not null",
                Long.class, bob.id(), carol.id())).isZero();
    }

    @Test
    void bookmarks() throws Exception {
        Account alice = register();
        Account bob = register();
        long p1 = createPost(alice, "{\"content\":\"first\"}");
        long p2 = createPost(alice, "{\"content\":\"second\"}");
        long p3 = createPost(alice, "{\"content\":\"third\"}");

        // Authentication is required.
        mvc.perform(post("/api/posts/" + p1 + "/bookmark")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/bookmarks")).andExpect(status().isUnauthorized());

        // Create, and a duplicate is rejected (also enforced by the unique constraint).
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isConflict());
        mvc.perform(auth(post("/api/posts/" + p2 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + p3 + "/bookmark"), bob)).andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "select count(*) from bookmarks where user_id = ? and post_id = ?", Long.class, bob.id(), p1)).isEqualTo(1L);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update(
                "insert into bookmarks (user_id, post_id, created_at) values (?, ?, now())", bob.id(), p1))
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);

        // Bookmarking does not change the post or show up for other users.
        mvc.perform(get("/api/posts/" + p1)).andExpect(jsonPath("$.content").value("first"));
        mvc.perform(auth(get("/api/bookmarks"), alice)).andExpect(jsonPath("$.items", hasSize(0)));

        // Listing: most recently bookmarked first, cursor paged.
        String page1 = mvc.perform(auth(get("/api/bookmarks").param("limit", "2"), bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].id").value(p3))
                .andExpect(jsonPath("$.items[1].id").value(p2))
                .andExpect(jsonPath("$.items[0].author.id").value(alice.id()))
                .andReturn().getResponse().getContentAsString();
        String next = String.valueOf(((Number) JsonPath.read(page1, "$.nextCursor")).longValue());
        mvc.perform(auth(get("/api/bookmarks").param("limit", "2").param("cursor", next), bob))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(p1))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));

        // Remove; removing again is harmless, and the post leaves the list.
        mvc.perform(auth(delete("/api/posts/" + p2 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(delete("/api/posts/" + p2 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/bookmarks"), bob))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].id").value(p3))
                .andExpect(jsonPath("$.items[1].id").value(p1));
        mvc.perform(get("/api/posts/" + p2)).andExpect(status().isOk());

        // A deleted post drops out of the list and can no longer be bookmarked.
        mvc.perform(auth(delete("/api/posts/" + p3), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/bookmarks"), bob)).andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(auth(post("/api/posts/" + p3 + "/bookmark"), bob)).andExpect(status().isNotFound());

        // Nonexistent posts, and repost rows, are 404.
        mvc.perform(auth(post("/api/posts/999999999/bookmark"), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/posts/999999999/bookmark"), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/posts/" + p1 + "/repost"), bob)).andExpect(status().isNoContent());
        Long repostRowId = jdbc.queryForObject("select id from posts where author_id = ? and repost_of_id = ?",
                Long.class, bob.id(), p1);
        mvc.perform(auth(post("/api/posts/" + repostRowId + "/bookmark"), bob)).andExpect(status().isNotFound());

        // A deactivated user cannot use bookmarks with an old token.
        mvc.perform(auth(post("/api/users/me/deactivate"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/bookmarks"), bob)).andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isUnauthorized());
    }

    @Test
    void deletingAnAccountRemovesItsBookmarks() throws Exception {
        Account alice = register();
        Account bob = register();
        long postId = createPost(alice, "{\"content\":\"keep\"}");
        mvc.perform(auth(post("/api/posts/" + postId + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(json(auth(delete("/api/users/me"), bob), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "select count(*) from bookmarks where user_id = ?", Long.class, bob.id())).isZero();
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk());
    }

    @Test
    void mentions() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        Account author = register();

        // Valid, multiple and duplicate mentions (case-insensitive) are stored once each.
        String body = "{\"content\":\"hey @" + bob.username().toUpperCase() + " and @" + carol.username() + " again @"
                + bob.username() + "\"}";
        String res = mvc.perform(json(auth(post("/api/posts"), author), body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mentions", hasSize(2)))
                .andReturn().getResponse().getContentAsString();
        long postId = ((Number) JsonPath.read(res, "$.id")).longValue();
        org.assertj.core.api.Assertions.assertThat(mentionedIds(postId)).containsExactlyInAnyOrder(bob.id(), carol.id());
        mvc.perform(get("/api/posts/" + postId))
                .andExpect(jsonPath("$.mentions[*].id", org.hamcrest.Matchers.containsInAnyOrder(
                        (int) bob.id(), (int) carol.id())));

        // Nonexistent users, emails and over-long handles are plain text: the post is created, nothing is linked.
        long plain = createPost(author, "{\"content\":\"@nobody_" + UUID.randomUUID().toString().substring(0, 6)
                + " mail x@" + alice.username() + ".com @thisnameiswaytoolong\"}");
        org.assertj.core.api.Assertions.assertThat(mentionedIds(plain)).isEmpty();

        // A mention of someone who exists mixed with one who doesn't only links the one who exists.
        long mixed = createPost(author, "{\"content\":\"@" + alice.username() + " @ghost_user_zz\"}");
        org.assertj.core.api.Assertions.assertThat(mentionedIds(mixed)).containsExactly(alice.id());

        // Deactivated users cannot be mentioned.
        mvc.perform(auth(post("/api/users/me/deactivate"), carol)).andExpect(status().isNoContent());
        long toDeactivated = createPost(author, "{\"content\":\"@" + carol.username() + "\"}");
        org.assertj.core.api.Assertions.assertThat(mentionedIds(toDeactivated)).isEmpty();

        // Editing re-syncs: keep one, drop one, add one.
        mvc.perform(json(auth(patch("/api/posts/" + postId), author),
                        "{\"content\":\"now only @" + bob.username() + " and @" + alice.username() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mentions", hasSize(2)));
        org.assertj.core.api.Assertions.assertThat(mentionedIds(postId)).containsExactlyInAnyOrder(bob.id(), alice.id());
        mvc.perform(json(auth(patch("/api/posts/" + postId), author), "{\"content\":\"no mentions now\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mentions", hasSize(0)));
        org.assertj.core.api.Assertions.assertThat(mentionedIds(postId)).isEmpty();

        // Deleting the post removes its mention rows.
        mvc.perform(json(auth(patch("/api/posts/" + postId), author), "{\"content\":\"back @" + bob.username() + "\"}"))
                .andExpect(status().isOk());
        org.assertj.core.api.Assertions.assertThat(mentionedIds(postId)).containsExactly(bob.id());
        mvc.perform(auth(delete("/api/posts/" + postId), author)).andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(mentionedIds(postId)).isEmpty();

        // Mentions also work in replies, and deleting the mentioned user's account removes the link.
        long reply = createPost(alice, "{\"content\":\"@" + bob.username() + " thanks\",\"replyToId\":" + mixed + "}");
        org.assertj.core.api.Assertions.assertThat(mentionedIds(reply)).containsExactly(bob.id());
        mvc.perform(json(auth(delete("/api/users/me"), bob), "{\"password\":\"password123\"}"))
                .andExpect(status().isNoContent());
        org.assertj.core.api.Assertions.assertThat(mentionedIds(reply)).isEmpty();
        mvc.perform(get("/api/posts/" + reply)).andExpect(jsonPath("$.mentions", hasSize(0)));
    }

    @Test
    void notifications() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();

        // Follow notifies once, even if repeated; self actions and unfollow don't leave extras behind.
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].type").value("FOLLOW"))
                .andExpect(jsonPath("$.items[0].actor.username").value(bob.username()))
                .andExpect(jsonPath("$.items[0].read").value(false));
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), bob)).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/api/notifications"), bob)).andExpect(jsonPath("$.items", hasSize(0)));

        // Likes: repeat like is one notification, unlike retracts, self-like is silent.
        long postId = createPost(alice, "{\"content\":\"hello\"}");
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(2));
        mvc.perform(auth(delete("/api/posts/" + postId + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(1));

        // Replies notify the parent's author; a mention of that same author is not doubled.
        long replyId = createPost(carol, "{\"content\":\"@" + alice.username() + " @" + bob.username()
                + "\",\"replyToId\":" + postId + "}");
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].type").value("REPLY"))
                .andExpect(jsonPath("$.items[0].postId").value(replyId));
        mvc.perform(auth(get("/api/notifications"), bob))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].type").value("MENTION"));
        // Replying to your own post, and mentioning yourself, are silent.
        createPost(alice, "{\"content\":\"@" + alice.username() + "\",\"replyToId\":" + postId + "}");
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(2));

        // Edit only notifies newly added mentions.
        long carolPost = createPost(carol, "{\"content\":\"hi @" + bob.username() + "\"}");
        mvc.perform(json(auth(patch("/api/posts/" + carolPost), carol),
                        "{\"content\":\"hi @" + bob.username() + " @" + alice.username() + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/api/notifications/unread-count"), bob)).andExpect(jsonPath("$.count").value(2));
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(3));

        // Paging, reading, deleting; other users can't touch your notifications.
        String page = mvc.perform(auth(get("/api/notifications?limit=2"), alice))
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andReturn().getResponse().getContentAsString();
        long cursor = ((Number) JsonPath.read(page, "$.nextCursor")).longValue();
        long firstId = ((Number) JsonPath.read(page, "$.items[0].id")).longValue();
        mvc.perform(auth(get("/api/notifications?limit=2&cursor=" + cursor), alice))
                .andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(auth(post("/api/notifications/" + firstId + "/read"), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/notifications/" + firstId), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/notifications/" + firstId + "/read"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(2));
        mvc.perform(auth(post("/api/notifications/read"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(auth(delete("/api/notifications/" + firstId), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications?limit=50"), alice)).andExpect(jsonPath("$.items", hasSize(2)));

        // Blocking: no notifications across a block, and existing ones from the blocked user are hidden.
        mvc.perform(auth(post("/api/users/" + carol.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications?limit=50"), alice))
                .andExpect(jsonPath("$.items[?(@.actor.username == '" + carol.username() + "')]", hasSize(0)));
        mvc.perform(json(auth(patch("/api/posts/" + carolPost), carol),
                        "{\"content\":\"hi @" + alice.username() + " @" + bob.username() + " again\"}"))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(0));

        // Deleting the post removes its notifications; unauthenticated access is rejected.
        mvc.perform(auth(delete("/api/posts/" + carolPost), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(get("/api/notifications")).andExpect(status().isUnauthorized());
    }

    private List<Long> mentionedIds(long postId) {
        return jdbc.queryForList("select user_id from post_mentions where post_id = ?", Long.class, postId);
    }

    @Test
    void followAndTimelinePaging() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();

        long a1 = createPost(alice, "{\"content\":\"a1\"}");
        long c1 = createPost(carol, "{\"content\":\"c1 - not followed\"}");
        long a2 = createPost(alice, "{\"content\":\"a2\"}");
        long b1 = createPost(bob, "{\"content\":\"b1\"}");

        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), bob)).andExpect(status().isBadRequest());

        mvc.perform(auth(get("/api/users/" + alice.username()), bob))
                .andExpect(jsonPath("$.followerCount").value(1))
                .andExpect(jsonPath("$.followedByMe").value(true));
        mvc.perform(get("/api/users/" + alice.username() + "/followers"))
                .andExpect(jsonPath("$.items[*].username", contains(bob.username())));

        String page1 = mvc.perform(auth(get("/api/timeline?limit=2"), bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", contains((int) b1, (int) a2)))
                .andReturn().getResponse().getContentAsString();
        Number cursor = JsonPath.read(page1, "$.nextCursor");

        mvc.perform(auth(get("/api/timeline?limit=2&cursor=" + cursor), bob))
                .andExpect(jsonPath("$.items[*].id", contains((int) a1)))
                .andExpect(jsonPath("$.nextCursor", nullValue()));

        mvc.perform(auth(delete("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/timeline"), bob))
                .andExpect(jsonPath("$.items[*].id", contains((int) b1)));

        // Carol's post is visible on her profile but never reached Bob's timeline.
        mvc.perform(get("/api/users/" + carol.username() + "/posts"))
                .andExpect(jsonPath("$.items[*].id", contains((int) c1)));
    }

    @Test
    void blockingUsers() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();

        long a1 = createPost(alice, "{\"content\":\"a1\"}");
        long b1 = createPost(bob, "{\"content\":\"b1\"}");
        long carolReplyId = createPost(carol, "{\"content\":\"carol reply\",\"replyToId\":" + a1 + "}");
        long bobReplyId = createPost(bob, "{\"content\":\"bob reply\",\"replyToId\":" + a1 + "}");
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isNoContent());

        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + alice.username() + "/block"), alice)).andExpect(status().isBadRequest());

        // Blocking removed the follows both ways and shows on the profile.
        mvc.perform(auth(get("/api/users/" + bob.username()), alice))
                .andExpect(jsonPath("$.followerCount").value(0))
                .andExpect(jsonPath("$.followingCount").value(0))
                .andExpect(jsonPath("$.blockedByMe").value(true));
        mvc.perform(auth(get("/api/users/me/blocks"), alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].username", contains(bob.username())));
        mvc.perform(get("/api/users/me/blocks")).andExpect(status().isUnauthorized());

        // No interactions in either direction.
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/posts/" + a1 + "/like"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/posts/" + b1 + "/like"), alice)).andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"hi\",\"replyToId\":" + a1 + "}"))
                .andExpect(status().isForbidden());

        // Content is hidden from both sides, but not from others.
        mvc.perform(auth(get("/api/posts/" + a1), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/users/" + bob.username() + "/posts"), alice)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/posts/" + a1 + "/replies"), alice))
                .andExpect(jsonPath("$.items[*].id", contains((int) carolReplyId)));
        mvc.perform(auth(get("/api/posts/" + a1 + "/replies"), carol))
                .andExpect(jsonPath("$.items[*].id", contains((int) carolReplyId, (int) bobReplyId)));
        mvc.perform(auth(post("/api/users/" + carol.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/" + carol.username() + "/followers"), alice))
                .andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/users/" + carol.username() + "/followers"))
                .andExpect(jsonPath("$.items[*].username", contains(bob.username())));

        mvc.perform(auth(delete("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/" + bob.username()), alice))
                .andExpect(jsonPath("$.blockedByMe").value(false));
        mvc.perform(auth(post("/api/posts/" + a1 + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me/blocks"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void postWithUploadedMedia() throws Exception {
        Account alice = register();
        Account bob = register();
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenReturn(HeadObjectResponse.builder().contentType("image/png").contentLength(1024L).build());

        String key = "users/" + alice.id() + "/" + UUID.randomUUID() + ".png";
        mvc.perform(json(auth(post("/api/posts"), alice), "{\"mediaKeys\":[\"" + key + "\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mediaUrls", hasSize(1)))
                .andExpect(jsonPath("$.mediaUrls[0]").value("https://media.test/" + key));

        // Bob cannot attach Alice's upload.
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"mediaKeys\":[\"" + key + "\"]}"))
                .andExpect(status().isBadRequest());

        mvc.perform(json(auth(patch("/api/users/me"), alice),
                        "{\"avatarKey\":\"" + key + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.avatarUrl").value("https://media.test/" + key));
    }

    @Test
    void conversations() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();

        // Authentication is required.
        mvc.perform(json(post("/api/conversations"), convBody(bob.username()))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/conversations")).andExpect(status().isUnauthorized());

        // Create: shows the other participant, never the caller.
        String created = mvc.perform(json(auth(post("/api/conversations"), alice), convBody(bob.username())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.participant.username").value(bob.username()))
                .andExpect(jsonPath("$.participant.id").value(bob.id()))
                .andExpect(jsonPath("$.createdAt").isNotEmpty())
                .andExpect(jsonPath("$.updatedAt").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        long convId = ((Number) JsonPath.read(created, "$.id")).longValue();

        // Get existing: same id, from either side, no duplicate row.
        mvc.perform(json(auth(post("/api/conversations"), alice), convBody(bob.username())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(convId));
        mvc.perform(json(auth(post("/api/conversations"), bob), convBody(alice.username())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(convId))
                .andExpect(jsonPath("$.participant.username").value(alice.username()));
        Integer rows = jdbc.queryForObject(
                "select count(*) from conversations where user_one_id in (?, ?) and user_two_id in (?, ?)",
                Integer.class, alice.id(), bob.id(), alice.id(), bob.id());
        assertEquals(1, rows);

        // The database itself rejects duplicates, reversed pairs and self-conversations.
        long low = Math.min(alice.id(), bob.id());
        long high = Math.max(alice.id(), bob.id());
        String insert = "insert into conversations (user_one_id, user_two_id, created_at, updated_at) values (?, ?, now(), now())";
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(insert, low, high));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(insert, high, low));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(insert, low, low));

        // Listing: only my conversations that have messages, most recently active first, paged.
        sendMessage(alice, convId, "hi bob");
        long carolConv = ((Number) JsonPath.read(mvc.perform(json(auth(post("/api/conversations"), alice), convBody(carol.username())))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id")).longValue();
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(1))); // nothing written to carol yet
        sendMessage(alice, carolConv, "hi carol");
        mvc.perform(auth(get("/api/conversations"), alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].participant.username", contains(carol.username(), bob.username())));
        mvc.perform(auth(get("/api/conversations"), bob))
                .andExpect(jsonPath("$.items[*].participant.username", contains(alice.username())));
        mvc.perform(auth(get("/api/conversations?limit=1"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.nextCursor").isNotEmpty());

        // Only participants can open a conversation.
        mvc.perform(auth(get("/api/conversations/" + convId), alice)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/conversations/" + convId), bob)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/conversations/" + convId), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/999999999"), alice)).andExpect(status().isNotFound());

        // Validation, unknown user and self.
        mvc.perform(json(auth(post("/api/conversations"), alice), "{\"username\":\"\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/conversations"), alice), "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/conversations"), alice), convBody("nobody_here_1")))
                .andExpect(status().isNotFound());
        mvc.perform(json(auth(post("/api/conversations"), alice), convBody(alice.username())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void conversationsAndBlocks() throws Exception {
        Account alice = register();
        Account bob = register();
        long convId = ((Number) JsonPath.read(mvc.perform(
                json(auth(post("/api/conversations"), alice), convBody(bob.username())))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id")).longValue();

        sendMessage(alice, convId, "before the block");
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());

        // Blocked in either direction: no new access, hidden from both lists.
        mvc.perform(json(auth(post("/api/conversations"), alice), convBody(bob.username())))
                .andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/conversations"), bob), convBody(alice.username())))
                .andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/conversations/" + convId), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(0)));

        // A new conversation with a blocked user is never created.
        Account carol = register();
        mvc.perform(auth(post("/api/users/" + carol.username() + "/block"), bob)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post("/api/conversations"), carol), convBody(bob.username())))
                .andExpect(status().isForbidden());

        // Unblocking restores the same conversation.
        mvc.perform(auth(delete("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/conversations"), alice))
                .andExpect(jsonPath("$.items[*].id", contains((int) convId)));
    }

    @Test
    void conversationsAndDeactivatedUsers() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long convId = convId(alice, bob);
        sendMessage(alice, convId, "before the deactivation");

        mvc.perform(auth(post("/api/users/me/deactivate"), bob)).andExpect(status().isNoContent());

        // The deactivated user's token stops working, and nobody can start a conversation with their handle any more.
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(status().isUnauthorized());
        mvc.perform(json(auth(post("/api/conversations"), carol), convBody(bob.username()))).andExpect(status().isNotFound());
        // The existing conversation stays in alice's inbox, with the person shown as "XClone user"; she can read it but not write to it.
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].participant.unavailable").value(true))
                .andExpect(jsonPath("$.items[0].participant.displayName").value("XClone user"))
                .andExpect(jsonPath("$.items[0].participant.username").value(""));
        mvc.perform(auth(get("/api/conversations/" + convId + "/messages"), alice)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].content").value("before the deactivation"));
        mvc.perform(json(auth(post("/api/conversations/" + convId + "/messages"), alice), msgBody("anyone there?"))).andExpect(status().isForbidden());
    }

    @Test
    void inboxIsOrderedByLatestMessageAndShowsThePreviewAndUnreadCount() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        Account dave = register();
        long withBob = convId(alice, bob);
        long withCarol = convId(alice, carol);
        long withDave = convId(alice, dave);
        sendMessage(bob, withBob, "first from bob");
        sendMessage(carol, withCarol, "from carol");
        sendMessage(dave, withDave, "from dave");
        sendMessage(bob, withBob, "second from bob");   // the oldest conversation becomes the most recently active
        sendMessage(alice, withDave, "alice answers dave");

        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", contains((int) withDave, (int) withBob, (int) withCarol)))
                .andExpect(jsonPath("$.items[0].lastMessage.content").value("alice answers dave"))
                .andExpect(jsonPath("$.items[0].lastMessage.senderId").value(alice.id()))
                .andExpect(jsonPath("$.items[0].unreadCount").value(1)) // dave's own message is still unread
                .andExpect(jsonPath("$.items[1].lastMessage.content").value("second from bob"))
                .andExpect(jsonPath("$.items[1].unreadCount").value(2))
                .andExpect(jsonPath("$.items[2].unreadCount").value(1));
        // Bob's side: only the conversation he is in, nothing unread (alice never wrote to him).
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].unreadCount").value(0));

        // Paging by the cursor does not skip or repeat.
        String first = mvc.perform(auth(get("/api/conversations?limit=2"), alice)).andExpect(jsonPath("$.items", hasSize(2)))
                .andReturn().getResponse().getContentAsString();
        long cursor = ((Number) JsonPath.read(first, "$.nextCursor")).longValue();
        mvc.perform(auth(get("/api/conversations?limit=2&cursor=" + cursor), alice))
                .andExpect(jsonPath("$.items[*].id", contains((int) withCarol))).andExpect(jsonPath("$.nextCursor").doesNotExist());

        // Reading clears the count; the single-conversation endpoint carries the same fields.
        mvc.perform(auth(post("/api/conversations/" + withBob + "/read"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/conversations/" + withBob), alice)).andExpect(jsonPath("$.unreadCount").value(0))
                .andExpect(jsonPath("$.lastMessage.content").value("second from bob"));
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items[1].unreadCount").value(0));
    }

    @Test
    void aConversationWithoutMessagesHasNoPreviewAndIsNotInTheInbox() throws Exception {
        Account alice = register();
        Account bob = register();
        long convId = convId(alice, bob);
        mvc.perform(auth(get("/api/conversations/" + convId), alice)).andExpect(jsonPath("$.lastMessage").doesNotExist())
                .andExpect(jsonPath("$.unreadCount").value(0));
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void messages() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long convId = createConversation(alice, bob);
        String url = "/api/conversations/" + convId + "/messages";

        // Authentication is required.
        mvc.perform(json(post(url), msgBody("hi"))).andExpect(status().isUnauthorized());
        mvc.perform(get(url)).andExpect(status().isUnauthorized());

        Instant before = jdbcUpdatedAt(convId);

        // Send: sender is the caller, content is stripped.
        mvc.perform(json(auth(post(url), alice), msgBody("  hello bob  ")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.conversationId").value(convId))
                .andExpect(jsonPath("$.sender.username").value(alice.username()))
                .andExpect(jsonPath("$.content").value("hello bob"))
                .andExpect(jsonPath("$.createdAt").isNotEmpty());
        mvc.perform(json(auth(post(url), bob), msgBody("hi alice"))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.sender.username").value(bob.username()));
        assertTrue(jdbcUpdatedAt(convId).isAfter(before));

        // Both participants see both messages, oldest first.
        for (Account who : List.of(alice, bob)) {
            mvc.perform(auth(get(url), who))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items[*].content", contains("hello bob", "hi alice")))
                    .andExpect(jsonPath("$.nextCursor").value(nullValue()));
        }

        // Non-participants and unknown conversations get 404; nothing is stored.
        mvc.perform(auth(get(url), carol)).andExpect(status().isNotFound());
        mvc.perform(json(auth(post(url), carol), msgBody("intruder"))).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/999999999/messages"), alice)).andExpect(status().isNotFound());
        mvc.perform(json(auth(post("/api/conversations/999999999/messages"), alice), msgBody("x")))
                .andExpect(status().isNotFound());
        assertEquals(2, jdbc.queryForObject("select count(*) from messages where conversation_id = ?",
                Integer.class, convId));

        // Validation.
        mvc.perform(json(auth(post(url), alice), msgBody(""))).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post(url), alice), msgBody("   \n "))).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post(url), alice), "{}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(post(url), alice), msgBody("a".repeat(2000)))).andExpect(status().isCreated());
        mvc.perform(json(auth(post(url), alice), msgBody("a".repeat(2001)))).andExpect(status().isBadRequest());
    }

    @Test
    void messagePagination() throws Exception {
        Account alice = register();
        Account bob = register();
        long convId = createConversation(alice, bob);
        String url = "/api/conversations/" + convId + "/messages";
        for (int i = 1; i <= 5; i++) {
            mvc.perform(json(auth(post(url), i % 2 == 0 ? bob : alice), msgBody("m" + i)))
                    .andExpect(status().isCreated());
        }

        // Newest page first, each page oldest to newest; the cursor walks back in time.
        String p1 = mvc.perform(auth(get(url + "?limit=2"), alice))
                .andExpect(jsonPath("$.items[*].content", contains("m4", "m5")))
                .andReturn().getResponse().getContentAsString();
        Number c1 = JsonPath.read(p1, "$.nextCursor");
        String p2 = mvc.perform(auth(get(url + "?limit=2&cursor=" + c1), alice))
                .andExpect(jsonPath("$.items[*].content", contains("m2", "m3")))
                .andReturn().getResponse().getContentAsString();
        Number c2 = JsonPath.read(p2, "$.nextCursor");
        mvc.perform(auth(get(url + "?limit=2&cursor=" + c2), alice))
                .andExpect(jsonPath("$.items[*].content", contains("m1")))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));

        // Default and clamped limits, and a cursor before everything.
        mvc.perform(auth(get(url), alice)).andExpect(jsonPath("$.items", hasSize(5)));
        mvc.perform(auth(get(url + "?limit=1000"), alice)).andExpect(jsonPath("$.items", hasSize(5)));
        mvc.perform(auth(get(url + "?cursor=1"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void messagesAndBlocksAndDeactivation() throws Exception {
        Account alice = register();
        Account bob = register();
        long convId = createConversation(alice, bob);
        String url = "/api/conversations/" + convId + "/messages";
        mvc.perform(json(auth(post(url), alice), msgBody("before"))).andExpect(status().isCreated());

        // Blocked either way: no sending or reading.
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post(url), alice), msgBody("x"))).andExpect(status().isForbidden());
        mvc.perform(json(auth(post(url), bob), msgBody("x"))).andExpect(status().isForbidden());
        mvc.perform(auth(get(url), alice)).andExpect(status().isForbidden());
        mvc.perform(auth(get(url), bob)).andExpect(status().isForbidden());

        // Unblocking restores access and the history.
        mvc.perform(auth(delete("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post(url), bob), msgBody("after"))).andExpect(status().isCreated());
        mvc.perform(auth(get(url), alice))
                .andExpect(jsonPath("$.items[*].content", contains("before", "after")));

        // Deactivated counterpart: cannot be messaged; their own token stops working.
        mvc.perform(auth(post("/api/users/me/deactivate"), bob)).andExpect(status().isNoContent());
        mvc.perform(json(auth(post(url), alice), msgBody("anyone?"))).andExpect(status().isForbidden());
        mvc.perform(json(auth(post(url), bob), msgBody("x"))).andExpect(status().isUnauthorized());
        mvc.perform(auth(get(url), bob)).andExpect(status().isUnauthorized());
    }

    @Test
    void unreadMessages() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long ab = createConversation(alice, bob);
        long cb = createConversation(carol, bob);
        long ac = createConversation(alice, carol);
        String abUrl = "/api/conversations/" + ab;

        // Authentication is required on every new endpoint.
        mvc.perform(get(abUrl + "/unread-count")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/conversations/unread-count")).andExpect(status().isUnauthorized());
        mvc.perform(post(abUrl + "/read")).andExpect(status().isUnauthorized());

        // Zero unread to start with.
        assertUnread(abUrl + "/unread-count", bob, 0);
        assertUnread("/api/conversations/unread-count", bob, 0);

        // A new message is unread for the recipient only.
        sendMessage(alice, ab, "one");
        assertEquals(1, jdbc.queryForObject("select count(*) from messages where conversation_id = ? and read_at is null",
                Integer.class, ab));
        assertUnread(abUrl + "/unread-count", bob, 1);
        assertUnread(abUrl + "/unread-count", alice, 0);
        assertUnread("/api/conversations/unread-count", alice, 0);

        // Multiple unread, in both directions.
        sendMessage(alice, ab, "two");
        sendMessage(alice, ab, "three");
        sendMessage(bob, ab, "reply");
        assertUnread(abUrl + "/unread-count", bob, 3);
        assertUnread(abUrl + "/unread-count", alice, 1);

        // Total spans only my conversations; the unrelated alice-carol chat never counts for bob.
        sendMessage(carol, cb, "hey bob");
        sendMessage(alice, ac, "hey carol");
        assertUnread("/api/conversations/unread-count", bob, 4);
        assertUnread("/api/conversations/unread-count", alice, 1);
        assertUnread("/api/conversations/unread-count", carol, 1);

        // Non-participants and unknown conversations.
        mvc.perform(auth(get(abUrl + "/unread-count"), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(post(abUrl + "/read"), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/999999999/unread-count"), bob)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/conversations/999999999/read"), bob)).andExpect(status().isNotFound());
        assertUnread(abUrl + "/unread-count", bob, 3);

        // Marking read only affects the other side's messages in that conversation, and is idempotent.
        mvc.perform(auth(post(abUrl + "/read"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post(abUrl + "/read"), bob)).andExpect(status().isNoContent());
        assertUnread(abUrl + "/unread-count", bob, 0);
        assertUnread(abUrl + "/unread-count", alice, 1);
        assertUnread("/api/conversations/unread-count", bob, 1);
        assertEquals(3, jdbc.queryForObject(
                "select count(*) from messages where conversation_id = ? and sender_id = ? and read_at is not null",
                Integer.class, ab, alice.id()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from messages where conversation_id = ? and sender_id = ? and read_at is null",
                Integer.class, ab, bob.id()));

        // Blocked pairs: no access and excluded from the total; restored after unblocking.
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), carol)).andExpect(status().isNoContent());
        assertUnread("/api/conversations/unread-count", bob, 0);
        mvc.perform(auth(get("/api/conversations/" + cb + "/unread-count"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/conversations/" + cb + "/read"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/users/" + bob.username() + "/block"), carol)).andExpect(status().isNoContent());
        assertUnread("/api/conversations/unread-count", bob, 1);
    }

    // --- helpers ---

    private long convId(Account me, Account other) throws Exception {
        String res = mvc.perform(json(auth(post("/api/conversations"), me), convBody(other.username()))).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private void sendMessage(Account from, long conversationId, String content) throws Exception {
        mvc.perform(json(auth(post("/api/conversations/" + conversationId + "/messages"), from), msgBody(content)))
                .andExpect(status().isCreated());
    }

    private void assertUnread(String url, Account who, int expected) throws Exception {
        mvc.perform(auth(get(url), who)).andExpect(status().isOk()).andExpect(jsonPath("$.count").value(expected));
    }

    private long createConversation(Account a, Account b) throws Exception {
        String res = mvc.perform(json(auth(post("/api/conversations"), a), convBody(b.username())))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private Instant jdbcUpdatedAt(long conversationId) {
        return jdbc.queryForObject("select updated_at from conversations where id = ?", Instant.class,
                conversationId);
    }

    private static String msgBody(String content) {
        return "{\"content\":\"" + content.replace("\n", "\\n") + "\"}";
    }

    private static String convBody(String username) {
        return "{\"username\":\"" + username + "\"}";
    }

    // --- protected accounts ---

    private void follow(Account who, Account target) throws Exception {
        mvc.perform(auth(post("/api/users/" + target.username() + "/follow"), who)).andExpect(status().isNoContent());
    }

    private void setProtected(Account owner, boolean value) throws Exception {
        mvc.perform(json(auth(patch("/api/users/me"), owner), "{\"protectedAccount\":" + value + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.protectedAccount").value(value));
    }

    private List<String> timelineIds(Account viewer) throws Exception {
        String body = mvc.perform(auth(get("/api/timeline"), viewer)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Integer> ids = JsonPath.read(body, "$.items[*].id");
        return ids.stream().map(String::valueOf).toList();
    }

    @Test
    void protectedAccountPostsAreVisibleOnlyToTheOwnerAndApprovedFollowers() throws Exception {
        Account alice = register(); // becomes protected
        Account bob = register();   // stranger
        Account carol = register(); // follows alice before she protects the account
        String tag = "tag" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String needle = "needle" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        follow(carol, alice);
        long p1 = createPost(alice, "{\"content\":\"" + needle + " #" + tag + "\"}");
        setProtected(alice, true);

        // A stranger and an anonymous visitor can see the profile, but nothing else.
        mvc.perform(auth(get("/api/users/" + alice.username()), bob)).andExpect(status().isOk())
                .andExpect(jsonPath("$.protectedAccount").value(true))
                .andExpect(jsonPath("$.followRequestedByMe").value(false));
        for (String path : List.of("/api/posts/" + p1, "/api/posts/" + p1 + "/thread", "/api/posts/" + p1 + "/replies",
                "/api/posts/" + p1 + "/likes", "/api/users/" + alice.username() + "/posts",
                "/api/users/" + alice.username() + "/replies", "/api/users/" + alice.username() + "/likes",
                "/api/users/" + alice.username() + "/followers", "/api/users/" + alice.username() + "/following")) {
            mvc.perform(auth(get(path), bob)).andExpect(status().isForbidden());
            mvc.perform(get(path)).andExpect(status().isForbidden());
        }
        mvc.perform(auth(post("/api/posts/" + p1 + "/like"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/posts/" + p1 + "/repost"), bob)).andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/posts/" + p1 + "/report"), bob), "{\"reason\":\"SPAM\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"hi\",\"replyToId\":" + p1 + "}"))
                .andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"hi\",\"quotedPostId\":" + p1 + "}"))
                .andExpect(status().isForbidden());
        // Search, hashtag pages and trending leave protected posts out.
        mvc.perform(auth(get("/api/posts/search?q=" + needle), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/hashtags/" + tag + "/posts"), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/hashtags/" + tag + "/posts")).andExpect(jsonPath("$.items", hasSize(0)));
        String trending = mvc.perform(get("/api/trending/hashtags")).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(trending).doesNotContain(tag);

        // The existing follower keeps access, but still cannot repost or quote.
        mvc.perform(auth(get("/api/posts/" + p1), carol)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/" + alice.username() + "/posts"), carol)).andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(auth(get("/api/users/" + alice.username() + "/followers"), carol)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/posts/search?q=" + needle), carol)).andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(auth(get("/api/hashtags/" + tag + "/posts"), carol)).andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(auth(post("/api/posts/" + p1 + "/like"), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/bookmarks"), carol)).andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(json(auth(post("/api/posts"), carol), "{\"content\":\"reply\",\"replyToId\":" + p1 + "}"))
                .andExpect(status().isCreated());
        mvc.perform(auth(post("/api/posts/" + p1 + "/repost"), carol)).andExpect(status().isForbidden());
        mvc.perform(json(auth(post("/api/posts"), carol), "{\"content\":\"q\",\"quotedPostId\":" + p1 + "}"))
                .andExpect(status().isForbidden());
        org.assertj.core.api.Assertions.assertThat(timelineIds(carol)).contains(String.valueOf(p1));

        // The owner always sees everything of hers.
        mvc.perform(auth(get("/api/posts/" + p1), alice)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/" + alice.username() + "/followers"), alice)).andExpect(status().isOk());
    }

    @Test
    void followRequestsAreApprovedDeniedAndWithdrawn() throws Exception {
        Account alice = register();
        Account bob = register();
        Account dave = register();
        Account erin = register();
        long secret = createPost(alice, "{\"content\":\"for followers only\"}");
        setProtected(alice, true);

        // Following asks for approval: 202, a pending request, and a notification for the owner (only one).
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isAccepted());
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isAccepted());
        mvc.perform(auth(get("/api/users/" + alice.username()), bob))
                .andExpect(jsonPath("$.followRequestedByMe").value(true)).andExpect(jsonPath("$.followedByMe").value(false))
                .andExpect(jsonPath("$.followerCount").value(0));
        mvc.perform(auth(get("/api/posts/" + secret), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/users/me/follow-requests"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].username").value(bob.username()));
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].type").value("FOLLOW_REQUEST"))
                .andExpect(jsonPath("$.items[0].actor.username").value(bob.username()));
        mvc.perform(get("/api/users/me/follow-requests")).andExpect(status().isUnauthorized());

        // Withdrawing removes the request and its notification; asking again recreates them.
        mvc.perform(auth(delete("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me/follow-requests"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/notifications"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isAccepted());

        // Approving makes bob a follower with access, swaps the request notification for a FOLLOW one.
        mvc.perform(auth(post("/api/users/me/follow-requests/" + bob.username() + "/approve"), alice))
                .andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/me/follow-requests/" + bob.username() + "/approve"), alice))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/" + secret), bob)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/" + alice.username()), bob))
                .andExpect(jsonPath("$.followedByMe").value(true)).andExpect(jsonPath("$.followRequestedByMe").value(false))
                .andExpect(jsonPath("$.followerCount").value(1));
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.items[0].type").value("FOLLOW"));
        // Following an account you already follow stays a plain follow.
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());

        // Denying leaves dave locked out.
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), dave)).andExpect(status().isAccepted());
        mvc.perform(auth(post("/api/users/me/follow-requests/" + dave.username() + "/deny"), alice))
                .andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/me/follow-requests/" + dave.username() + "/deny"), alice))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/" + secret), dave)).andExpect(status().isForbidden());

        // Blocking cancels a pending request, and a blocked user cannot ask again.
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), erin)).andExpect(status().isAccepted());
        mvc.perform(auth(post("/api/users/" + erin.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me/follow-requests"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), erin)).andExpect(status().isForbidden());

        // Going public again turns every waiting request into a follow.
        Account frank = register();
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), frank)).andExpect(status().isAccepted());
        setProtected(alice, false);
        mvc.perform(auth(get("/api/users/me/follow-requests"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/users/" + alice.username()), frank)).andExpect(jsonPath("$.followedByMe").value(true));
        mvc.perform(auth(get("/api/posts/" + secret), dave)).andExpect(status().isOk()); // public again, for everyone
    }

    @Test
    void protectedAccountsRepliesAndMentionsDoNotNotifyPeopleWhoCannotSeeThem() throws Exception {
        Account alice = register();
        Account follower = register();
        Account stranger = register();
        follow(follower, alice);
        setProtected(alice, true);

        createPost(alice, "{\"content\":\"hi @" + follower.username() + " and @" + stranger.username() + "\"}");

        mvc.perform(auth(get("/api/notifications"), follower))
                .andExpect(jsonPath("$.items[?(@.type=='MENTION')]", hasSize(1)));
        mvc.perform(auth(get("/api/notifications"), stranger))
                .andExpect(jsonPath("$.items[?(@.type=='MENTION')]", hasSize(0)));
    }

    @Test
    void postsOfAnAccountThatLaterBecomesProtectedDisappearFromRepostsAndQuotes() throws Exception {
        Account pam = register();      // posts, later protects
        Account alice = register();    // reposts pam's post
        Account carol = register();    // quotes pam's post, follows alice
        Account bob = register();      // follows alice and carol, never pam
        long pp = createPost(pam, "{\"content\":\"pam's original\"}");
        mvc.perform(auth(post("/api/posts/" + pp + "/repost"), alice)).andExpect(status().isNoContent());
        long quote = createPost(carol, "{\"content\":\"quoting pam\",\"quotedPostId\":" + pp + "}");
        follow(carol, alice);
        follow(bob, alice);
        follow(bob, carol);
        org.assertj.core.api.Assertions.assertThat(timelineIds(carol)).contains(String.valueOf(pp)); // the repost row
        mvc.perform(auth(get("/api/posts/" + quote), bob)).andExpect(jsonPath("$.quotedPost.id").value(pp));

        setProtected(pam, true);

        // Neither the repost row nor alice's profile feed shows it to someone who cannot see pam's posts.
        org.assertj.core.api.Assertions.assertThat(timelineIds(carol)).doesNotContain(String.valueOf(pp));
        mvc.perform(auth(get("/api/users/" + alice.username() + "/posts"), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        // The quote post stays, but its embedded original is gone for bob (and still shown to pam herself).
        mvc.perform(auth(get("/api/posts/" + quote), bob)).andExpect(status().isOk())
                .andExpect(jsonPath("$.quotedPost").value(nullValue()));
        mvc.perform(auth(get("/api/posts/" + quote), pam)).andExpect(jsonPath("$.quotedPost.id").value(pp));
    }

    @Test
    void muteHidesAUsersPostsAndNotificationsOneWayAndSilently() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + carol.username() + "/follow"), alice)).andExpect(status().isNoContent());
        long alicePost = createPost(alice, "{\"content\":\"alice speaking\"}");
        long bobPost = createPost(bob, "{\"content\":\"bob speaking\"}");
        long carolPost = createPost(carol, "{\"content\":\"carol speaking\"}");
        mvc.perform(auth(post("/api/posts/" + alicePost + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + alicePost + "/like"), carol)).andExpect(status().isNoContent());
        // Carol reposts Bob's post, so it would reach Alice through Carol too.
        mvc.perform(auth(post("/api/posts/" + bobPost + "/repost"), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(2));

        mvc.perform(auth(post("/api/users/" + bob.username() + "/mute"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + bob.username() + "/mute"), alice)).andExpect(status().isNoContent()); // idempotent

        // Bob's post, and Carol's repost of it, are gone from Alice's timeline; Carol's own post stays.
        String timeline = mvc.perform(auth(get("/api/timeline"), alice)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Integer> ids = JsonPath.read(timeline, "$.items[*].id");
        org.assertj.core.api.Assertions.assertThat(ids).contains((int) carolPost, (int) alicePost)
                .doesNotContain((int) bobPost);

        // Bob's like notification disappears from the list and the unread count; Carol's stays.
        mvc.perform(auth(get("/api/notifications"), alice))
                .andExpect(jsonPath("$.items[?(@.actor.username=='" + bob.username() + "')]", hasSize(0)));
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(1));

        // The mute is visible to Alice only, and nothing else changes for Bob.
        mvc.perform(auth(get("/api/users/" + bob.username()), alice)).andExpect(jsonPath("$.mutedByMe").value(true));
        mvc.perform(auth(get("/api/users/" + alice.username()), bob)).andExpect(jsonPath("$.mutedByMe").value(false));
        mvc.perform(auth(get("/api/users/" + bob.username()), alice)).andExpect(jsonPath("$.followedByMe").value(true));
        mvc.perform(auth(get("/api/posts/" + alicePost), bob)).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/me/mutes"), alice))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].username").value(bob.username()));
        mvc.perform(get("/api/users/me/mutes")).andExpect(status().isUnauthorized());

        mvc.perform(auth(post("/api/users/" + alice.username() + "/mute"), alice)).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/users/nobody-here/mute"), alice)).andExpect(status().isNotFound());

        // Unmuting brings everything back, including the stored notification.
        mvc.perform(auth(delete("/api/users/" + bob.username() + "/mute"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(delete("/api/users/" + bob.username() + "/mute"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), alice)).andExpect(jsonPath("$.count").value(2));
        String after = mvc.perform(auth(get("/api/timeline"), alice)).andReturn().getResponse().getContentAsString();
        List<Integer> afterIds = JsonPath.read(after, "$.items[*].id");
        org.assertj.core.api.Assertions.assertThat(afterIds).contains((int) bobPost);
        mvc.perform(auth(get("/api/users/me/mutes"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void postsReportWhetherTheViewerBookmarkedThem() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        follow(bob, alice);
        follow(bob, carol);
        long p1 = createPost(alice, "{\"content\":\"bookmarked by bob\"}");
        long p2 = createPost(alice, "{\"content\":\"not bookmarked\"}");
        long reply = createPost(carol, "{\"content\":\"a reply\",\"replyToId\":" + p1 + "}");
        long quote = createPost(carol, "{\"content\":\"quoting\",\"quotedPostId\":" + p1 + "}");
        mvc.perform(auth(post("/api/posts/" + p1 + "/repost"), carol)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + reply + "/bookmark"), bob)).andExpect(status().isNoContent());

        // Single post: bob yes/no, everyone else (and anonymous visitors) no.
        mvc.perform(auth(get("/api/posts/" + p1), bob)).andExpect(jsonPath("$.bookmarkedByMe").value(true));
        mvc.perform(auth(get("/api/posts/" + p2), bob)).andExpect(jsonPath("$.bookmarkedByMe").value(false));
        mvc.perform(auth(get("/api/posts/" + p1), carol)).andExpect(jsonPath("$.bookmarkedByMe").value(false));
        mvc.perform(get("/api/posts/" + p1)).andExpect(jsonPath("$.bookmarkedByMe").value(false));

        // Timeline (computed inside the query): the post itself, and carol's repost row, which describes the original.
        String timeline = mvc.perform(auth(get("/api/timeline"), bob)).andReturn().getResponse().getContentAsString();
        assertEquals(List.of(true, true), JsonPath.read(timeline, "$.items[?(@.id==" + p1 + ")].bookmarkedByMe"));
        assertEquals(List.of(false), JsonPath.read(timeline, "$.items[?(@.id==" + p2 + ")].bookmarkedByMe"));

        // The other list paths: profile feed, replies, a quote post's embedded original, the bookmarks list itself.
        String profile = mvc.perform(auth(get("/api/users/" + alice.username() + "/posts"), bob)).andReturn().getResponse().getContentAsString();
        assertEquals(List.of(true), JsonPath.read(profile, "$.items[?(@.id==" + p1 + ")].bookmarkedByMe"));
        mvc.perform(auth(get("/api/posts/" + p1 + "/replies"), bob)).andExpect(jsonPath("$.items[0].bookmarkedByMe").value(true));
        mvc.perform(auth(get("/api/posts/" + quote), bob)).andExpect(jsonPath("$.quotedPost.bookmarkedByMe").value(true));
        String bookmarks = mvc.perform(auth(get("/api/bookmarks"), bob)).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat((List<Boolean>) JsonPath.read(bookmarks, "$.items[*].bookmarkedByMe"))
                .hasSize(2).containsOnly(true);

        // Removing the bookmark flips the flag everywhere; a new post's own response never claims one.
        mvc.perform(auth(delete("/api/posts/" + p1 + "/bookmark"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/posts/" + p1), bob)).andExpect(jsonPath("$.bookmarkedByMe").value(false));
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"fresh\"}")).andExpect(jsonPath("$.bookmarkedByMe").value(false));
    }

    @Test
    void whoToFollowRanksFriendsOfFriendsAndExcludesWhoYouShouldNotSee() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        Account dave = register();
        Account erin = register();
        Account frank = register();
        Account gina = register();
        for (Account followee : List.of(bob, carol)) {
            mvc.perform(auth(post("/api/users/" + followee.username() + "/follow"), alice)).andExpect(status().isNoContent());
        }
        // Dave is followed by both of Alice's follows, Erin by one; Frank and Gina by one each but excluded below.
        for (Account[] pair : new Account[][] {{bob, dave}, {carol, dave}, {bob, erin}, {bob, frank}, {bob, gina}}) {
            mvc.perform(auth(post("/api/users/" + pair[1].username() + "/follow"), pair[0])).andExpect(status().isNoContent());
        }
        mvc.perform(auth(post("/api/users/" + frank.username() + "/block"), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + gina.username() + "/mute"), alice)).andExpect(status().isNoContent());

        String body = mvc.perform(auth(get("/api/users/suggestions?limit=20"), alice)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> names = JsonPath.read(body, "$[*].user.username");
        org.assertj.core.api.Assertions.assertThat(names.subList(0, 2)).containsExactly(dave.username(), erin.username());
        org.assertj.core.api.Assertions.assertThat(names)
                .doesNotContain(alice.username(), bob.username(), carol.username(), frank.username(), gina.username());
        assertEquals(List.of(2, 1), JsonPath.read(body, "$[0:2].mutualFollowCount"));

        mvc.perform(auth(get("/api/users/suggestions?limit=1"), alice)).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(get("/api/users/suggestions")).andExpect(status().isUnauthorized());

        // A brand-new account follows nobody, so it gets popular accounts instead, never itself.
        Account newcomer = register();
        String cold = mvc.perform(auth(get("/api/users/suggestions"), newcomer)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> coldNames = JsonPath.read(cold, "$[*].user.username");
        org.assertj.core.api.Assertions.assertThat(coldNames).isNotEmpty().doesNotContain(newcomer.username());
        List<Integer> coldMutuals = JsonPath.read(cold, "$[*].mutualFollowCount");
        org.assertj.core.api.Assertions.assertThat(coldMutuals).allMatch(m -> m == 0);
    }

    @Test
    void timelineReportsLikedAndRepostedFlagsForTheViewer() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        mvc.perform(auth(post("/api/users/" + alice.username() + "/follow"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + carol.username() + "/follow"), bob)).andExpect(status().isNoContent());

        long liked = createPost(alice, "{\"content\":\"bob likes this\"}");
        long reposted = createPost(alice, "{\"content\":\"bob reposts this\"}");
        long plain = createPost(carol, "{\"content\":\"bob ignores this\"}");
        long quote = createPost(carol, "{\"content\":\"quoting\",\"quotedPostId\":" + liked + "}");
        mvc.perform(auth(post("/api/posts/" + liked + "/like"), bob)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + reposted + "/repost"), bob)).andExpect(status().isNoContent());

        String timeline = mvc.perform(auth(get("/api/timeline"), bob)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Every row for a post carries the viewer's flags about that post, including bob's own repost row.
        assertFlags(timeline, liked, true, false);
        assertFlags(timeline, reposted, false, true);
        assertFlags(timeline, plain, false, false);
        assertFlags(timeline, quote, false, false);
        // The quoted post inside a quote post is looked up separately and must also be flagged.
        List<Object> quotedLiked = JsonPath.read(timeline, "$.items[?(@.id==" + quote + ")].quotedPost.likedByMe");
        assertEquals(List.of(true), quotedLiked);
    }

    private static void assertFlags(String timeline, long postId, boolean liked, boolean reposted) {
        List<Object> likedFlags = JsonPath.read(timeline, "$.items[?(@.id==" + postId + ")].likedByMe");
        List<Object> repostedFlags = JsonPath.read(timeline, "$.items[?(@.id==" + postId + ")].repostedByMe");
        org.assertj.core.api.Assertions.assertThat(likedFlags).isNotEmpty().allMatch(f -> f.equals(liked));
        org.assertj.core.api.Assertions.assertThat(repostedFlags).isNotEmpty().allMatch(f -> f.equals(reposted));
    }

    private Account register() throws Exception {
        String username = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String body = mvc.perform(json(post("/api/auth/register"), registerBody(username, username)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        Number id = JsonPath.read(body, "$.user.id");
        return new Account(id.longValue(), username, JsonPath.read(body, "$.accessToken"),
                JsonPath.read(body, "$.refreshToken"));
    }

    private long createPost(Account author, String body) throws Exception {
        String res = mvc.perform(json(auth(post("/api/posts"), author), body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private static String registerBody(String username, String emailLocal) {
        return "{\"username\":\"" + username + "\",\"email\":\"" + emailLocal + "@example.com\","
                + "\"password\":\"password123\",\"displayName\":\"Test User\"}";
    }

    private static String refreshBody(String token) {
        return "{\"refreshToken\":\"" + token + "\"}";
    }

    @Test
    void replyPolicyLimitsWhoCanReplyAtAnyDepth() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isNoContent());

        // FOLLOWING: only accounts alice follows (bob), plus alice herself.
        long following = createPost(alice, "{\"content\":\"hi\",\"replyPolicy\":\"FOLLOWING\"}");
        mvc.perform(auth(get("/api/posts/" + following), bob)).andExpect(jsonPath("$.canReply").value(true))
                .andExpect(jsonPath("$.replyPolicy").value("FOLLOWING"))
                .andExpect(jsonPath("$.conversationId").value(following));
        mvc.perform(auth(get("/api/posts/" + following), carol)).andExpect(jsonPath("$.canReply").value(false));
        mvc.perform(get("/api/posts/" + following)).andExpect(jsonPath("$.canReply").value(false));
        long bobReply = createPost(bob, "{\"content\":\"ok\",\"replyToId\":" + following + "}");
        mvc.perform(auth(post("/api/posts"), carol)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"me too\",\"replyToId\":" + following + "}"))
                .andExpect(status().isForbidden());
        // The policy holds for a reply to a reply, and replies report the conversation they belong to.
        mvc.perform(auth(post("/api/posts"), carol)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"deep\",\"replyToId\":" + bobReply + "}"))
                .andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/posts/" + bobReply), carol)).andExpect(jsonPath("$.canReply").value(false))
                .andExpect(jsonPath("$.conversationId").value(following));
        createPost(alice, "{\"content\":\"alice again\",\"replyToId\":" + bobReply + "}");

        // MENTIONED: only people @mentioned in the top-level post.
        long mentioned = createPost(alice,
                "{\"content\":\"@" + carol.username() + " look\",\"replyPolicy\":\"MENTIONED\"}");
        createPost(carol, "{\"content\":\"seen\",\"replyToId\":" + mentioned + "}");
        mvc.perform(auth(post("/api/posts"), bob)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"hm\",\"replyToId\":" + mentioned + "}"))
                .andExpect(status().isForbidden());

        // Quoting is not a reply, so it is never limited.
        createPost(bob, "{\"content\":\"quote\",\"quotedPostId\":" + mentioned + "}");
    }

    @Test
    void replyPolicyCanOnlyBeSetOnTopLevelPostsByTheirAuthor() throws Exception {
        Account alice = register();
        Account bob = register();
        long top = createPost(alice, "{\"content\":\"hi\"}");
        long reply = createPost(bob, "{\"content\":\"yo\",\"replyToId\":" + top + "}");

        mvc.perform(json(auth(post("/api/posts"), bob),
                "{\"content\":\"x\",\"replyToId\":" + top + ",\"replyPolicy\":\"FOLLOWING\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/posts"), bob),
                "{\"content\":\"x\",\"quotedPostId\":" + top + ",\"replyPolicy\":\"FOLLOWING\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(json(auth(patch("/api/posts/" + top + "/reply-policy"), bob), "{\"replyPolicy\":\"FOLLOWING\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(json(auth(patch("/api/posts/" + reply + "/reply-policy"), bob),
                "{\"replyPolicy\":\"FOLLOWING\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch("/api/posts/" + top + "/reply-policy"), alice), "{\"replyPolicy\":\"MENTIONED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replyPolicy").value("MENTIONED"));
        // Applies to future replies only.
        mvc.perform(json(auth(post("/api/posts"), bob), "{\"content\":\"late\",\"replyToId\":" + top + "}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/posts/" + reply)).andExpect(status().isOk());
    }

    @Test
    void threadsChainTheAuthorsOwnPosts() throws Exception {
        Account alice = register();
        Account bob = register();

        String created = mvc.perform(json(auth(post("/api/posts/thread"), alice),
                "{\"posts\":[{\"content\":\"1/3\"},{\"content\":\"2/3\"},{\"content\":\"3/3\"}],"
                        + "\"replyPolicy\":\"FOLLOWING\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$", hasSize(3)))
                .andReturn().getResponse().getContentAsString();
        long first = ((Number) JsonPath.read(created, "$[0].id")).longValue();
        long second = ((Number) JsonPath.read(created, "$[1].id")).longValue();
        long third = ((Number) JsonPath.read(created, "$[2].id")).longValue();
        mvc.perform(get("/api/posts/" + third)).andExpect(jsonPath("$.replyToId").value(second))
                .andExpect(jsonPath("$.conversationId").value(first))
                .andExpect(jsonPath("$.replyPolicy").value("FOLLOWING"));

        // A reply by someone else under the thread is not part of it, wherever it sits.
        mvc.perform(auth(post("/api/users/" + bob.username() + "/follow"), alice)).andExpect(status().isNoContent());
        long bobReply = createPost(bob, "{\"content\":\"nice\",\"replyToId\":" + second + "}");
        mvc.perform(get("/api/posts/" + third + "/thread")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].id").value(first))
                .andExpect(jsonPath("$[1].id").value(second))
                .andExpect(jsonPath("$[2].id").value(third));
        // Any post in the conversation, including another person's reply, resolves to the same thread.
        mvc.perform(get("/api/posts/" + bobReply + "/thread")).andExpect(jsonPath("$", hasSize(3)));

        // Deleting a middle post breaks the chain after it.
        mvc.perform(auth(delete("/api/posts/" + second), alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/posts/" + first + "/thread")).andExpect(jsonPath("$", hasSize(1)));

        // Thread items cannot set their own links; a thread needs at least two posts.
        mvc.perform(json(auth(post("/api/posts/thread"), alice),
                "{\"posts\":[{\"content\":\"a\"},{\"content\":\"b\",\"replyToId\":" + first + "}]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(auth(post("/api/posts/thread"), alice), "{\"posts\":[{\"content\":\"a\"}]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void backfillSetsRootOnRepliesCreatedBeforeConversationsWereTracked() throws Exception {
        Account alice = register();
        long top = createPost(alice, "{\"content\":\"top\"}");
        long mid = createPost(alice, "{\"content\":\"mid\",\"replyToId\":" + top + "}");
        long leaf = createPost(alice, "{\"content\":\"leaf\",\"replyToId\":" + mid + "}");
        jdbc.update("update posts set root_id = null where id in (?, ?)", mid, leaf);

        new com.project.Xclone_backend.post.PostRootBackfillInitializer(jdbc).run(null);

        assertEquals(top, jdbc.queryForObject("select root_id from posts where id = ?", Long.class, mid));
        assertEquals(top, jdbc.queryForObject("select root_id from posts where id = ?", Long.class, leaf));
    }

    @Test
    void emailVerificationFlow() throws Exception {
        Account a = register();
        String email = a.username() + "@example.com";
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(jsonPath("$.emailVerified").value(false));
        String token = lastEmailedToken(email);

        mvc.perform(json(post("/api/auth/verify-email"), "{\"token\":\"nope\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/auth/verify-email"), "{\"token\":\"" + token + "\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(jsonPath("$.emailVerified").value(true));
        // A token works once, and there is nothing to resend for a verified address.
        mvc.perform(json(post("/api/auth/verify-email"), "{\"token\":\"" + token + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/users/me/verify-email"), a)).andExpect(status().isConflict());

        // Changing to the same address keeps the status; a new address needs verifying again.
        mvc.perform(json(auth(patch("/api/users/me/email"), a), "{\"email\":\"" + email + "\"}"))
                .andExpect(jsonPath("$.emailVerified").value(true));
        String newEmail = "new-" + a.username() + "@example.com";
        mvc.perform(json(auth(patch("/api/users/me/email"), a), "{\"email\":\"" + newEmail + "\"}"))
                .andExpect(jsonPath("$.emailVerified").value(false));
        String newToken = lastEmailedToken(newEmail);
        mvc.perform(auth(post("/api/users/me/verify-email"), a)).andExpect(status().isNoContent());
        // The resend replaced the earlier token.
        mvc.perform(json(post("/api/auth/verify-email"), "{\"token\":\"" + newToken + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/auth/verify-email"), "{\"token\":\"" + lastEmailedToken(newEmail) + "\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/users/me/verify-email")).andExpect(status().isUnauthorized());
    }

    @Test
    void passwordResetFlow() throws Exception {
        Account a = register();
        String email = a.username() + "@example.com";
        org.mockito.Mockito.clearInvocations(emailSender);

        // Always 204, but only a real active account is emailed.
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"nobody-" + a.username() + "@example.com\"}"))
                .andExpect(status().isNoContent());
        verify(emailSender, never()).send(any(), any(), any());
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"" + email.toUpperCase() + "\"}"))
                .andExpect(status().isNoContent());
        String first = lastEmailedToken(email);
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"" + email + "\"}"))
                .andExpect(status().isNoContent());
        String token = lastEmailedToken(email);

        // A newer reset token replaces the older one.
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(first, "brand-new-pass")))
                .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(token, "short"))).andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(token, "brand-new-pass")))
                .andExpect(status().isNoContent());
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(token, "another-pass1")))
                .andExpect(status().isBadRequest());

        mvc.perform(json(post("/api/auth/login"),
                "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/auth/login"),
                "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"brand-new-pass\"}"))
                .andExpect(status().isOk());
        // Every earlier session is signed out, access tokens included (they would otherwise live on until they expire).
        mvc.perform(json(post("/api/auth/refresh"), refreshBody(a.refreshToken()))).andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(status().isUnauthorized());
    }

    @Test
    void changingThePasswordInvalidatesEarlierAccessTokens() throws Exception {
        Account a = register();
        mvc.perform(auth(get("/api/users/me"), a)).andExpect(status().isOk());
        mvc.perform(json(auth(patch("/api/users/me/password"), a),
                "{\"currentPassword\":\"password123\",\"newPassword\":\"brand-new-pass\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/users/me"), a)).andExpect(status().isUnauthorized());
        String fresh = mvc.perform(json(post("/api/auth/login"),
                "{\"usernameOrEmail\":\"" + a.username() + "\",\"password\":\"brand-new-pass\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + JsonPath.read(fresh, "$.accessToken")))
                .andExpect(status().isOk());
    }

    @Test
    void expiredAndInactiveAccountResetsAreRejected() throws Exception {
        Account a = register();
        String email = a.username() + "@example.com";
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"" + email + "\"}"))
                .andExpect(status().isNoContent());
        String token = lastEmailedToken(email);
        jdbc.update("update email_tokens set expires_at = now() - interval '1 minute' where user_id = ?", a.id());
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(token, "brand-new-pass")))
                .andExpect(status().isBadRequest());

        // Deactivated accounts are not emailed and cannot redeem a token issued earlier.
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"" + email + "\"}"))
                .andExpect(status().isNoContent());
        String live = lastEmailedToken(email);
        mvc.perform(auth(post("/api/users/me/deactivate"), a)).andExpect(status().isNoContent());
        org.mockito.Mockito.clearInvocations(emailSender);
        mvc.perform(json(post("/api/auth/forgot-password"), "{\"email\":\"" + email + "\"}"))
                .andExpect(status().isNoContent());
        verify(emailSender, never()).send(any(), any(), any());
        mvc.perform(json(post("/api/auth/reset-password"), resetBody(live, "brand-new-pass")))
                .andExpect(status().isBadRequest());
    }

    private String lastEmailedToken(String email) {
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(emailSender, atLeastOnce()).send(eq(email), any(), body.capture());
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("token=([\\w-]+)")
                .matcher(body.getAllValues().get(body.getAllValues().size() - 1));
        assertTrue(m.find());
        return m.group(1);
    }

    private static String resetBody(String token, String password) {
        return "{\"token\":\"" + token + "\",\"newPassword\":\"" + password + "\"}";
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req, Account account) {
        return req.header("Authorization", "Bearer " + account.accessToken());
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder req, String body) {
        return req.contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
