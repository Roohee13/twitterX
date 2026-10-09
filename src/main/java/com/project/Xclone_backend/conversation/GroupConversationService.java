package com.project.Xclone_backend.conversation;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.conversation.ConversationDtos.ConversationResponse;
import com.project.Xclone_backend.conversation.ConversationDtos.ConversationUpdate;
import com.project.Xclone_backend.conversation.GroupDtos.MemberResponse;
import com.project.Xclone_backend.message.Message;
import com.project.Xclone_backend.message.MessageRepository;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserService;

import lombok.RequiredArgsConstructor;

/**
 * Group conversations: creating one, its members and its name. Sending and reading messages in a group goes through the same
 * {@code MessageService} as a direct chat. The rules: any member can add people, only the owner renames the group or removes others, anyone can
 * leave (the longest-standing member inherits a group whose owner leaves), and a new member does not see what was said before they joined.
 */
@Service
@RequiredArgsConstructor
public class GroupConversationService {

    public static final int MAX_MEMBERS = 50;

    private final ConversationRepository conversationRepository;
    private final ConversationMemberRepository memberRepository;
    private final ConversationService conversationService;
    private final MessageRepository messageRepository;
    private final UserService userService;
    private final UserMapper userMapper;
    private final ApplicationEventPublisher events;

    @Transactional
    public ConversationResponse create(Long meId, String title, List<String> usernames) {
        User me = userService.requireById(meId);
        Map<Long, User> others = resolve(meId, usernames);
        if (others.isEmpty()) {
            throw ApiException.badRequest("A group needs at least one other person");
        }
        if (others.size() + 1 > MAX_MEMBERS) {
            throw ApiException.badRequest("A group can have at most " + MAX_MEMBERS + " members");
        }
        Conversation group = conversationRepository.save(Conversation.newGroup(cleanTitle(title), me));
        memberRepository.save(new ConversationMember(group, me, MemberRole.OWNER, 0));
        others.values().forEach(u -> memberRepository.save(new ConversationMember(group, u, MemberRole.MEMBER, 0)));
        others.keySet().forEach(id -> announce(group, id));
        return conversationService.toResponse(group, meId);
    }

    @Transactional
    public ConversationResponse rename(Long meId, Long id, String title) {
        Conversation group = requireGroup(meId, id);
        requireOwner(group, meId);
        group.rename(cleanTitle(title));
        conversationRepository.flush();
        memberRepository.findOtherUserIds(id, meId).forEach(other -> announce(group, other));
        return conversationService.toResponse(group, meId);
    }

    @Transactional(readOnly = true)
    public List<MemberResponse> members(Long meId, Long id) {
        requireGroup(meId, id);
        return memberRepository.findAllWithUsers(id).stream().map(this::toResponse).toList();
    }

    /** Adds people who are not in the group yet (those who are already in it are skipped). The new members only see what is said from now on. */
    @Transactional
    public List<MemberResponse> addMembers(Long meId, Long id, List<String> usernames) {
        Conversation group = requireGroup(meId, id);
        Map<Long, User> wanted = resolve(meId, usernames);
        List<User> added = wanted.values().stream()
                .filter(u -> !memberRepository.existsByConversationIdAndUserId(id, u.getId())).toList();
        if (memberRepository.countByConversationId(id) + added.size() > MAX_MEMBERS) {
            throw ApiException.badRequest("A group can have at most " + MAX_MEMBERS + " members");
        }
        long newest = messageRepository.findFirstByConversationIdOrderByIdDesc(id).map(Message::getId).orElse(0L);
        added.forEach(u -> memberRepository.save(new ConversationMember(group, u, MemberRole.MEMBER, newest)));
        memberRepository.flush();
        if (!added.isEmpty()) {
            memberRepository.findOtherUserIds(id, meId).forEach(other -> announce(group, other));
        }
        return members(meId, id);
    }

    /** The owner removes someone else; removing someone who is not a member is a 404. */
    @Transactional
    public void removeMember(Long meId, Long id, Long userId) {
        Conversation group = requireGroup(meId, id);
        requireOwner(group, meId);
        if (userId.equals(meId)) {
            throw ApiException.badRequest("Use leave to leave the group");
        }
        if (memberRepository.remove(id, userId) == 0) {
            throw ApiException.notFound("Member not found");
        }
        announceRemoval(id, userId);
        memberRepository.findOtherUserIds(id, meId).forEach(other -> announce(group, other));
    }

    @Transactional
    public void leave(Long meId, Long id) {
        Conversation group = requireGroup(meId, id);
        ConversationMember me = memberRepository.findByConversationIdAndUserId(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        boolean wasOwner = me.getRole() == MemberRole.OWNER;
        memberRepository.remove(id, meId);
        memberRepository.flush();
        if (wasOwner) {
            memberRepository.findFirstByConversationIdOrderByIdAsc(id).ifPresent(next -> next.setRole(MemberRole.OWNER));
        }
        announceRemoval(id, meId); // the person's other open windows drop the group too
        memberRepository.findOtherUserIds(id, meId).forEach(other -> announce(group, other));
    }

    /** A 404 unless the caller is a member of this group (a direct conversation answers 404 too: these actions do not apply to it). */
    private Conversation requireGroup(Long meId, Long id) {
        Conversation c = conversationRepository.findByIdAndParticipant(id, meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        if (!c.isGroup()) {
            throw ApiException.notFound("Conversation not found");
        }
        return c;
    }

    private void requireOwner(Conversation group, Long meId) {
        ConversationMember me = memberRepository.findByConversationIdAndUserId(group.getId(), meId)
                .orElseThrow(() -> ApiException.notFound("Conversation not found"));
        if (me.getRole() != MemberRole.OWNER) {
            throw ApiException.forbidden("Only the group owner can do that");
        }
    }

    /** The people behind these handles, without duplicates and without the caller. Each must exist, be active and not be blocked either way. */
    private Map<Long, User> resolve(Long meId, List<String> usernames) {
        Map<Long, User> users = new LinkedHashMap<>();
        Set<String> seen = new HashSet<>();
        for (String username : usernames) {
            if (!seen.add(username.toLowerCase(Locale.ROOT))) {
                continue;
            }
            User u = userService.requireByUsername(username);
            if (u.getId().equals(meId)) {
                continue;
            }
            userService.requireNotBlocked(meId, u.getId());
            users.put(u.getId(), u);
        }
        return users;
    }

    private static String cleanTitle(String title) {
        String text = title == null ? "" : title.strip();
        if (text.isEmpty()) {
            throw ApiException.badRequest("A group needs a name");
        }
        return text;
    }

    private MemberResponse toResponse(ConversationMember m) {
        return new MemberResponse(userMapper.toSummary(m.getUser()), m.getRole(), m.getJoinedAt());
    }

    /** Tells one person (after commit) how the group looks to them now; nothing if they are not in it. */
    private void announce(Conversation group, Long userId) {
        if (memberRepository.existsByConversationIdAndUserId(group.getId(), userId)) {
            events.publishEvent(new ConversationUpdatedEvent(userId,
                    new ConversationUpdate(group.getId(), false, conversationService.toResponse(group, userId))));
        }
    }

    private void announceRemoval(Long conversationId, Long userId) {
        events.publishEvent(new ConversationUpdatedEvent(userId, new ConversationUpdate(conversationId, true, null)));
    }
}
