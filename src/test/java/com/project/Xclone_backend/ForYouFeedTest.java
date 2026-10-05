package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
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
 * The "For You" feed: what it ranks, what it never shows, and that paging it is stable. The test database is shared with other tests, so every
 * post made here is given a very large like count (it outscores anything left over) and the assertions are about relative order and presence.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ForYouFeedTest {

    /** Far above anything another test leaves behind, so these posts are at the top of the feed. */
    private static final int BIG = 1_000_000;

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
        String res = mvc.perform(json(auth(post("/api/posts"), author), "{\"content\":\"" + text + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    /** A post with a chosen like count, made {@code hoursAgo} hours ago. */
    private long popularPost(Account author, int likes, int hoursAgo) throws Exception {
        long id = createPost(author, "feed post " + UUID.randomUUID().toString().substring(0, 8));
        jdbc.update("update posts set like_count = ?, created_at = now() - make_interval(hours => ?) where id = ?", likes, hoursAgo, id);
        return id;
    }

    private void follow(Account who, Account target) throws Exception {
        mvc.perform(auth(post("/api/users/" + target.username() + "/follow"), who)).andExpect(status().is2xxSuccessful());
    }

    /** The ids of the first page of the feed (up to 50) in order. */
    private List<Long> feed(Account viewer) throws Exception {
        String res = mvc.perform(auth(get("/api/timeline/for-you?limit=50"), viewer)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<Number> ids = JsonPath.read(res, "$.items[*].id");
        return ids.stream().map(Number::longValue).toList();
    }

    private static void assertBefore(List<Long> feed, long first, long second) {
        assertThat(feed).contains(first, second);
        assertThat(feed.indexOf(first)).as("post %d should rank above post %d", first, second).isLessThan(feed.indexOf(second));
    }

    // --- ranking ---

    @Test
    void morePopularPostsRankAboveLessPopularOnes() throws Exception {
        Account viewer = register();
        long popular = popularPost(register(), 3 * BIG, 2);
        long quiet = popularPost(register(), BIG, 2);

        assertBefore(feed(viewer), popular, quiet);
    }

    @Test
    void aFresherPostRanksAboveAnOlderOneWithTheSameEngagement() throws Exception {
        Account viewer = register();
        long fresh = popularPost(register(), BIG, 1);
        long old = popularPost(register(), BIG, 72);

        assertBefore(feed(viewer), fresh, old);
    }

    @Test
    void aPostFromSomeoneYouFollowRanksAboveAnEqualOneFromAStranger() throws Exception {
        Account viewer = register();
        Account friend = register();
        follow(viewer, friend);
        long stranger = popularPost(register(), BIG, 3);
        long followed = popularPost(friend, BIG, 3);

        assertBefore(feed(viewer), followed, stranger);
    }

    @Test
    void aFriendOfAFriendRanksAboveAStrangerButBelowSomeoneYouFollow() throws Exception {
        Account viewer = register();
        Account friend = register();
        Account friendOfFriend = register();
        follow(viewer, friend);
        follow(friend, friendOfFriend);
        long stranger = popularPost(register(), BIG, 3);
        long fof = popularPost(friendOfFriend, BIG, 3);
        long followed = popularPost(friend, BIG, 3);

        List<Long> feed = feed(viewer);
        assertBefore(feed, followed, fof);
        assertBefore(feed, fof, stranger);
    }

    @Test
    void aBrandNewUserWithNoFollowsStillGetsPopularPostsAndYourOwnPostsCount() throws Exception {
        Account viewer = register();
        long popular = popularPost(register(), 5 * BIG, 1);
        long mine = popularPost(viewer, 4 * BIG, 1);

        List<Long> feed = feed(viewer);

        assertThat(feed).contains(popular, mine);
    }

    @Test
    void oneAuthorCannotTakeOverTheFeed() throws Exception {
        Account viewer = register();
        Account prolific = register();
        List<Long> theirs = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            theirs.add(popularPost(prolific, 9 * BIG, 1));
        }

        List<Long> feed = feed(viewer);

        assertThat(theirs.stream().filter(feed::contains).count()).isEqualTo(3);
    }

    // --- what is never shown ---

    @Test
    void repliesDeletedPostsAndOldPostsNeverAppear() throws Exception {
        Account viewer = register();
        Account author = register();
        long parent = popularPost(author, BIG, 2);
        String reply = mvc.perform(json(auth(post("/api/posts"), author), "{\"content\":\"a reply\",\"replyToId\":" + parent + "}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long replyId = ((Number) JsonPath.read(reply, "$.id")).longValue();
        jdbc.update("update posts set like_count = ? where id = ?", 9 * BIG, replyId);
        long deleted = popularPost(register(), 9 * BIG, 1);
        jdbc.update("update posts set deleted = true where id = ?", deleted);
        long tooOld = popularPost(register(), 9 * BIG, 24 * 8); // eight days old

        List<Long> feed = feed(viewer);

        assertThat(feed).contains(parent).doesNotContain(replyId, deleted, tooOld);
    }

    @Test
    void aRepostIsNotAnotherCopyOfThePost() throws Exception {
        Account viewer = register();
        long original = popularPost(register(), 6 * BIG, 1);
        mvc.perform(auth(post("/api/posts/" + original + "/repost"), register())).andExpect(status().isNoContent());

        assertThat(feed(viewer).stream().filter(id -> id == original).count()).isEqualTo(1);
    }

    @Test
    void blockedAndMutedAuthorsAreHiddenBothWays() throws Exception {
        Account viewer = register();
        Account blockedByMe = register();
        Account blocksMe = register();
        Account muted = register();
        Account visible = register();
        mvc.perform(auth(post("/api/users/" + blockedByMe.username() + "/block"), viewer)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + viewer.username() + "/block"), blocksMe)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + muted.username() + "/mute"), viewer)).andExpect(status().isNoContent());
        long a = popularPost(blockedByMe, 9 * BIG, 1);
        long b = popularPost(blocksMe, 9 * BIG, 1);
        long c = popularPost(muted, 9 * BIG, 1);
        long ok = popularPost(visible, 9 * BIG, 1);

        List<Long> feed = feed(viewer);

        assertThat(feed).contains(ok).doesNotContain(a, b, c);
    }

    @Test
    void protectedAccountsAppearOnlyForTheirFollowers() throws Exception {
        Account viewer = register();
        Account secret = register();
        mvc.perform(json(auth(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/users/me"), secret), "{\"protectedAccount\":true}"))
                .andExpect(status().isOk());
        long hidden = popularPost(secret, 9 * BIG, 1);

        assertThat(feed(viewer)).doesNotContain(hidden);
        assertThat(feed(secret)).contains(hidden); // their own

        follow(viewer, secret);
        mvc.perform(auth(post("/api/users/me/follow-requests/" + viewer.username() + "/approve"), secret)).andExpect(status().isNoContent());
        assertThat(feed(viewer)).contains(hidden);
    }

    @Test
    void deactivatedAndSuspendedAuthorsDisappear() throws Exception {
        Account viewer = register();
        Account leaving = register();
        Account suspended = register();
        long a = popularPost(leaving, 9 * BIG, 1);
        long b = popularPost(suspended, 9 * BIG, 1);
        assertThat(feed(viewer)).contains(a, b);

        mvc.perform(auth(post("/api/users/me/deactivate"), leaving)).andExpect(status().isNoContent());
        jdbc.update("update users set status = 'SUSPENDED' where id = ?", suspended.id());

        assertThat(feed(viewer)).doesNotContain(a, b);
    }

    // --- the response and paging ---

    @Test
    void itemsCarryTheViewersOwnFlagsAndAuthors() throws Exception {
        Account viewer = register();
        Account author = register();
        long id = popularPost(author, 7 * BIG, 1);
        mvc.perform(auth(post("/api/posts/" + id + "/like"), viewer)).andExpect(status().isNoContent());

        String res = mvc.perform(auth(get("/api/timeline/for-you?limit=50"), viewer)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        List<Object> mine = JsonPath.read(res, "$.items[?(@.id == " + id + ")]");
        assertThat(mine).hasSize(1);
        List<Boolean> liked = JsonPath.read(res, "$.items[?(@.id == " + id + ")].likedByMe");
        List<String> authors = JsonPath.read(res, "$.items[?(@.id == " + id + ")].author.username");
        assertThat(liked).containsExactly(true);
        assertThat(authors).containsExactly(author.username());
    }

    @Test
    void pagingWalksTheRankingWithoutRepeatsOrGapsAndEndsByItself() throws Exception {
        Account viewer = register();
        List<Long> expected = new ArrayList<>();
        for (int i = 0; i < 7; i++) { // seven different authors, strictly decreasing popularity
            expected.add(popularPost(register(), 100 * BIG - i * BIG, 1)); // 1% apart: far more than the milliseconds between the posts' ages
        }

        List<Long> seen = new ArrayList<>();
        Long cursor = null;
        int pages = 0;
        do {
            String url = "/api/timeline/for-you?limit=3" + (cursor == null ? "" : "&cursor=" + cursor);
            String res = mvc.perform(auth(get(url), viewer)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            List<Number> ids = JsonPath.read(res, "$.items[*].id");
            ids.forEach(n -> seen.add(n.longValue()));
            Number next = JsonPath.read(res, "$.nextCursor");
            cursor = next == null ? null : next.longValue();
            pages++;
        } while (cursor != null && pages < 80);

        assertThat(cursor).as("the feed ends").isNull();
        assertThat(seen).doesNotHaveDuplicates();
        assertThat(seen.subList(0, 7)).containsExactlyElementsOf(expected);
    }

    @Test
    void theFeedStopsAtItsDepthLimit() throws Exception {
        Account viewer = register();
        long minute = System.currentTimeMillis() / 1000 / 60;

        mvc.perform(auth(get("/api/timeline/for-you?limit=10&cursor=" + (minute * 1000 + 199)), viewer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(org.hamcrest.Matchers.lessThanOrEqualTo(1))).andExpect(jsonPath("$.nextCursor").doesNotExist());
        mvc.perform(auth(get("/api/timeline/for-you?limit=10&cursor=" + (minute * 1000 + 200)), viewer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0)).andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    void aGarbageOrStaleCursorJustStartsAFreshFeed() throws Exception {
        Account viewer = register();
        long id = popularPost(register(), 50 * BIG, 1);
        long longAgo = (System.currentTimeMillis() / 1000 / 60 - 600) * 1000 + 3;
        long future = (System.currentTimeMillis() / 1000 / 60 + 600) * 1000;

        for (long cursor : new long[] { 5, -3, longAgo, future, Long.MAX_VALUE }) {
            String res = mvc.perform(auth(get("/api/timeline/for-you?limit=50&cursor=" + cursor), viewer)).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            List<Number> ids = JsonPath.read(res, "$.items[*].id");
            assertThat(ids.stream().map(Number::longValue)).as("cursor %d", cursor).contains(id);
        }
    }

    @Test
    void youMustBeSignedIn() throws Exception {
        mvc.perform(get("/api/timeline/for-you")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/timeline/for-you")).andExpect(status().is4xxClientError());
    }
}
