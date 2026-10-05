package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * A deactivated account shows as a blank "XClone user": no profile details, no posts anywhere, a plain row in lists, and a read-only
 * conversation for people who wrote to them. Signing in again restores everything. Uses the same mocked beans as AdminReportsTest so both
 * share one Spring context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DeactivatedAccountTest {

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

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private long createPost(Account author, String text) throws Exception {
        return createPost(author, "{\"content\":\"" + text + "\"}", true);
    }

    private long createPost(Account author, String body, boolean raw) throws Exception {
        String res = mvc.perform(json(auth(post("/api/posts"), author), body)).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private String fetch(Account who, String url) throws Exception {
        return mvc.perform(auth(get(url), who)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    /** Ids as Long (JSON gives small numbers as Integer, which would never equal a Long and make every "contains" check pass or fail by accident). */
    private List<Long> ids(String json) {
        List<Number> raw = JsonPath.read(json, "$.items[*].id");
        return raw.stream().map(Number::longValue).toList();
    }

    /** Everything an active account leaves around, then the deactivation. */
    private record Scene(Account viewer, Account ghost, long ghostPost, long ghostReply, long viewerPost, long viewerQuote, String ghostTag) {
    }

    private Scene scene() throws Exception {
        Account viewer = register();
        Account ghost = register();
        String tag = "gh" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        jdbc.update("update users set display_name = 'Secret Name', bio = 'my secret bio', avatar_key = 'users/1/avatar.png', banner_key = 'users/1/banner.png' where id = ?", ghost.id());
        long ghostPost = createPost(ghost, "ghost says #" + tag + " ghostword" + tag);
        long viewerPost = createPost(viewer, "viewer talks to @" + ghost.username());
        String reply = mvc.perform(json(auth(post("/api/posts"), ghost), "{\"content\":\"ghost reply\",\"replyToId\":" + viewerPost + "}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long ghostReply = ((Number) JsonPath.read(reply, "$.id")).longValue();
        long viewerQuote = createPost(viewer, "{\"content\":\"quoting the ghost\",\"quotedPostId\":" + ghostPost + "}", true);
        mvc.perform(auth(post("/api/users/" + ghost.username() + "/follow"), viewer)).andExpect(status().is2xxSuccessful());
        mvc.perform(auth(post("/api/users/" + viewer.username() + "/follow"), ghost)).andExpect(status().is2xxSuccessful());
        mvc.perform(auth(post("/api/posts/" + ghostPost + "/like"), viewer)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + ghostPost + "/bookmark"), viewer)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/posts/" + viewerPost + "/like"), ghost)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/me/deactivate"), ghost)).andExpect(status().isNoContent());
        return new Scene(viewer, ghost, ghostPost, ghostReply, viewerPost, viewerQuote, tag);
    }

    // --- the profile ---

    @Test
    void theProfileIsABlankXCloneUserForEveryone() throws Exception {
        Scene s = scene();

        for (MockHttpServletRequestBuilder request : List.of(get("/api/users/" + s.ghost().username()), auth(get("/api/users/" + s.ghost().username()), s.viewer()))) {
            mvc.perform(request).andExpect(status().isOk())
                    .andExpect(jsonPath("$.unavailable").value(true)).andExpect(jsonPath("$.displayName").value("XClone user"))
                    .andExpect(jsonPath("$.username").value("")).andExpect(jsonPath("$.bio").value(nullValue()))
                    .andExpect(jsonPath("$.avatarUrl").value(nullValue())).andExpect(jsonPath("$.bannerUrl").value(nullValue()))
                    .andExpect(jsonPath("$.createdAt").value(nullValue()))
                    .andExpect(jsonPath("$.followerCount").value(0)).andExpect(jsonPath("$.followingCount").value(0))
                    .andExpect(jsonPath("$.followedByMe").value(false)).andExpect(jsonPath("$.blockedByMe").value(false))
                    .andExpect(jsonPath("$.mutedByMe").value(false)).andExpect(jsonPath("$.protectedAccount").value(false));
        }
    }

    @Test
    void anUnknownHandleStillAnswers404AndASuspendedAccountStillDoes() throws Exception {
        Account viewer = register();
        Account suspended = register();
        mvc.perform(get("/api/users/nobody_" + UUID.randomUUID().toString().substring(0, 6))).andExpect(status().isNotFound());
        jdbc.update("update users set status = 'SUSPENDED' where id = ?", suspended.id());

        mvc.perform(auth(get("/api/users/" + suspended.username()), viewer)).andExpect(status().isNotFound());
    }

    // --- posts ---

    @Test
    void theirPostsAndRepliesAreGoneEverywhere() throws Exception {
        Scene s = scene();
        Account v = s.viewer();

        assertThat(ids(fetch(v, "/api/timeline?limit=50"))).doesNotContain(s.ghostPost(), s.ghostReply());
        assertThat(ids(fetch(v, "/api/timeline/for-you?limit=50"))).doesNotContain(s.ghostPost(), s.ghostReply());
        assertThat(ids(fetch(v, "/api/posts/search?q=ghostword" + s.ghostTag()))).isEmpty();
        assertThat(ids(fetch(v, "/api/hashtags/" + s.ghostTag() + "/posts"))).doesNotContain(s.ghostPost());
        assertThat(ids(fetch(v, "/api/posts/" + s.viewerPost() + "/replies"))).doesNotContain(s.ghostReply());
        assertThat(ids(fetch(v, "/api/users/me/likes".replace("/me/likes", "/" + v.username() + "/likes")))).doesNotContain(s.ghostPost());
        assertThat(ids(fetch(v, "/api/bookmarks"))).doesNotContain(s.ghostPost());
        mvc.perform(get("/api/posts/" + s.ghostPost())).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/" + s.ghostPost()), v)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/posts/" + s.ghostPost() + "/like"), v)).andExpect(status().isNotFound());
        mvc.perform(json(auth(post("/api/posts"), v), "{\"content\":\"replying\",\"replyToId\":" + s.ghostPost() + "}")).andExpect(status().isNotFound());
        // The viewer's own post that quoted theirs no longer carries their post.
        mvc.perform(auth(get("/api/posts/" + s.viewerQuote()), v)).andExpect(status().isOk()).andExpect(jsonPath("$.quotedPost").value(nullValue()));
    }

    @Test
    void theirNameInsideSomeoneElsesPostIsBlankedAndReplyCountsAreLeftAlone() throws Exception {
        Scene s = scene();

        mvc.perform(auth(get("/api/posts/" + s.viewerPost()), s.viewer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mentions", hasSize(1)))
                .andExpect(jsonPath("$.mentions[0].unavailable").value(true)).andExpect(jsonPath("$.mentions[0].username").value(""))
                .andExpect(jsonPath("$.mentions[0].displayName").value("XClone user")).andExpect(jsonPath("$.mentions[0].avatarUrl").value(nullValue()))
                .andExpect(jsonPath("$.replyCount").value(1)); // counters are not recomputed
    }

    // --- lists ---

    @Test
    void listsShowAPlainXCloneUserRowAndKeepTheCounts() throws Exception {
        Scene s = scene();
        Account v = s.viewer();

        String followers = fetch(v, "/api/users/" + v.username() + "/followers");
        assertThat((List<?>) JsonPath.read(followers, "$.items")).hasSize(1);
        assertThat((Boolean) JsonPath.read(followers, "$.items[0].unavailable")).isTrue();
        assertThat((String) JsonPath.read(followers, "$.items[0].username")).isEmpty();
        assertThat((String) JsonPath.read(followers, "$.items[0].displayName")).isEqualTo("XClone user");
        String following = fetch(v, "/api/users/" + v.username() + "/following");
        assertThat((Boolean) JsonPath.read(following, "$.items[0].unavailable")).isTrue();
        String likers = mvc.perform(get("/api/posts/" + s.viewerPost() + "/likes")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat((Boolean) JsonPath.read(likers, "$.items[0].unavailable")).isTrue();
        mvc.perform(get("/api/users/" + v.username())).andExpect(jsonPath("$.followerCount").value(1)).andExpect(jsonPath("$.followingCount").value(1));
        // The real name, handle and bio appear nowhere in those answers.
        assertThat(followers + following + likers).doesNotContain(s.ghost().username()).doesNotContain("Secret Name").doesNotContain("my secret bio");
    }

    @Test
    void searchActionsAndBlockedListsForgetThem() throws Exception {
        Scene s = scene();
        Account v = s.viewer();
        String handle = s.ghost().username();

        mvc.perform(get("/api/users/search?q=" + handle.substring(0, 10))).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.unavailable == true)]").isEmpty());
        assertThat(fetch(v, "/api/users/me/blocks")).doesNotContain("XClone user");
        for (MockHttpServletRequestBuilder request : List.of(post("/api/users/" + handle + "/follow"), delete("/api/users/" + handle + "/follow"),
                post("/api/users/" + handle + "/block"), post("/api/users/" + handle + "/mute"), json(post("/api/users/" + handle + "/report"), "{\"reason\":\"SPAM\"}"),
                json(post("/api/conversations"), "{\"username\":\"" + handle + "\"}"))) {
            mvc.perform(auth(request, v)).andExpect(status().isNotFound());
        }
    }

    @Test
    void aBlockOrMuteSurvivesButIsOutOfSightUntilTheyAreBack() throws Exception {
        Account me = register();
        Account other = register();
        mvc.perform(auth(post("/api/users/" + other.username() + "/block"), me)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me/blocks"), me)).andExpect(jsonPath("$.items", hasSize(1)));

        mvc.perform(auth(post("/api/users/me/deactivate"), other)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/users/me/blocks"), me)).andExpect(jsonPath("$.items", hasSize(0)));

        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + other.username() + "\",\"password\":\"password123\"}")).andExpect(status().isOk());
        mvc.perform(auth(get("/api/users/me/blocks"), me)).andExpect(jsonPath("$.items", hasSize(1)));
    }

    // --- messages ---

    @Test
    void aConversationWithThemStaysReadableWithTheirNameBlankedButCannotBeWrittenTo() throws Exception {
        Account viewer = register();
        Account ghost = register();
        String res = mvc.perform(json(auth(post("/api/conversations"), viewer), "{\"username\":\"" + ghost.username() + "\"}")).andReturn().getResponse().getContentAsString();
        long conv = ((Number) JsonPath.read(res, "$.id")).longValue();
        mvc.perform(json(auth(post("/api/conversations/" + conv + "/messages"), ghost), "{\"content\":\"hello from the ghost\"}")).andExpect(status().isCreated());
        mvc.perform(json(auth(post("/api/conversations/" + conv + "/messages"), ghost), "{\"content\":\"second one\"}")).andExpect(status().isCreated());
        String mine = mvc.perform(json(auth(post("/api/conversations/" + conv + "/messages"), viewer), "{\"content\":\"my reply\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        long myMessage = ((Number) JsonPath.read(mine, "$.id")).longValue();
        mvc.perform(auth(get("/api/conversations/unread-count"), viewer)).andExpect(jsonPath("$.count").value(2));

        mvc.perform(auth(post("/api/users/me/deactivate"), ghost)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations"), viewer)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].participant.unavailable").value(true)).andExpect(jsonPath("$.items[0].participant.username").value(""))
                .andExpect(jsonPath("$.items[0].unreadCount").value(2));
        mvc.perform(auth(get("/api/conversations/unread-count"), viewer)).andExpect(jsonPath("$.count").value(2));
        mvc.perform(auth(get("/api/conversations/" + conv), viewer)).andExpect(status().isOk()).andExpect(jsonPath("$.participant.displayName").value("XClone user"));
        String history = fetch(viewer, "/api/conversations/" + conv + "/messages");
        assertThat((List<?>) JsonPath.read(history, "$.items")).hasSize(3);
        assertThat((String) JsonPath.read(history, "$.items[0].content")).isEqualTo("hello from the ghost"); // the history is the viewer's own
        assertThat((Boolean) JsonPath.read(history, "$.items[0].sender.unavailable")).isTrue();
        assertThat(history).doesNotContain(ghost.username());
        mvc.perform(auth(post("/api/conversations/" + conv + "/read"), viewer)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/conversations/unread-count"), viewer)).andExpect(jsonPath("$.count").value(0));
        // No writing: no new messages, no edits, no deletes.
        mvc.perform(json(auth(post("/api/conversations/" + conv + "/messages"), viewer), "{\"content\":\"hello?\"}")).andExpect(status().isForbidden());
        mvc.perform(json(auth(patch("/api/conversations/" + conv + "/messages/" + myMessage), viewer), "{\"content\":\"edited\"}")).andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/messages/" + myMessage), viewer)).andExpect(status().isForbidden());
    }

    // --- admins and coming back ---

    @Test
    void adminsStillSeeWhoAReportIsAbout() throws Exception {
        Account admin = register();
        jdbc.update("update users set is_admin = true where id = ?", admin.id());
        Account reporter = register();
        Account ghost = register();
        mvc.perform(json(auth(post("/api/users/" + ghost.username() + "/report"), reporter), "{\"reason\":\"SPAM\"}")).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/me/deactivate"), ghost)).andExpect(status().isNoContent());

        String reports = mvc.perform(auth(get("/api/admin/reports/users?status=ALL"), admin)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        List<String> names = JsonPath.read(reports, "$.items[?(@.reportedUser.id == " + ghost.id() + ")].reportedUser.username");
        assertThat(names).containsExactly(ghost.username());
        List<String> statuses = JsonPath.read(reports, "$.items[?(@.reportedUser.id == " + ghost.id() + ")].reportedUserStatus");
        assertThat(statuses).containsExactly("DEACTIVATED");
    }

    @Test
    void signingInAgainBringsEverythingBack() throws Exception {
        Scene s = scene();
        Account v = s.viewer();
        mvc.perform(get("/api/posts/" + s.ghostPost())).andExpect(status().isNotFound());

        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + s.ghost().username() + "\",\"password\":\"password123\"}")).andExpect(status().isOk());

        mvc.perform(get("/api/users/" + s.ghost().username())).andExpect(status().isOk()).andExpect(jsonPath("$.unavailable").value(false))
                .andExpect(jsonPath("$.username").value(s.ghost().username())).andExpect(jsonPath("$.displayName").value("Secret Name"))
                .andExpect(jsonPath("$.bio").value("my secret bio"));
        mvc.perform(get("/api/posts/" + s.ghostPost())).andExpect(status().isOk());
        assertThat(ids(fetch(v, "/api/timeline?limit=50"))).contains(s.ghostPost());
        assertThat(ids(fetch(v, "/api/posts/" + s.viewerPost() + "/replies"))).contains(s.ghostReply());
        String followers = fetch(v, "/api/users/" + v.username() + "/followers");
        assertThat((Boolean) JsonPath.read(followers, "$.items[0].unavailable")).isFalse();
        assertThat((String) JsonPath.read(followers, "$.items[0].username")).isEqualTo(s.ghost().username());
        mvc.perform(auth(get("/api/posts/" + s.viewerQuote()), v)).andExpect(jsonPath("$.quotedPost.id").value(s.ghostPost()));
    }
}
