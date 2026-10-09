package com.project.Xclone_backend.conversation;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.project.Xclone_backend.conversation.ConversationDtos.ConversationResponse;
import com.project.Xclone_backend.conversation.GroupDtos.AddMembersRequest;
import com.project.Xclone_backend.conversation.GroupDtos.CreateGroupRequest;
import com.project.Xclone_backend.conversation.GroupDtos.MemberResponse;
import com.project.Xclone_backend.conversation.GroupDtos.UpdateGroupRequest;
import com.project.Xclone_backend.security.AuthUser;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** Group chats. Messages in a group use the same /api/conversations/{id}/messages routes as direct chats. */
@RestController
@RequestMapping("/api/conversations")
@RequiredArgsConstructor
public class GroupConversationController {

    private final GroupConversationService groupService;

    @PostMapping("/groups")
    @ResponseStatus(HttpStatus.CREATED)
    public ConversationResponse create(@AuthenticationPrincipal AuthUser me, @Valid @RequestBody CreateGroupRequest req) {
        return groupService.create(me.id(), req.title(), req.usernames());
    }

    @PatchMapping("/{id}")
    public ConversationResponse rename(@PathVariable Long id, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody UpdateGroupRequest req) {
        return groupService.rename(me.id(), id, req.title());
    }

    @GetMapping("/{id}/members")
    public List<MemberResponse> members(@PathVariable Long id, @AuthenticationPrincipal AuthUser me) {
        return groupService.members(me.id(), id);
    }

    @PostMapping("/{id}/members")
    public List<MemberResponse> addMembers(@PathVariable Long id, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody AddMembersRequest req) {
        return groupService.addMembers(me.id(), id, req.usernames());
    }

    @DeleteMapping("/{id}/members/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeMember(@PathVariable Long id, @PathVariable Long userId, @AuthenticationPrincipal AuthUser me) {
        groupService.removeMember(me.id(), id, userId);
    }

    @PostMapping("/{id}/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(@PathVariable Long id, @AuthenticationPrincipal AuthUser me) {
        groupService.leave(me.id(), id);
    }
}
