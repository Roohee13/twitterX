package com.project.Xclone_backend.mutedword;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.project.Xclone_backend.mutedword.MutedWordService.MutedWordResponse;
import com.project.Xclone_backend.security.AuthUser;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/muted-words")
@RequiredArgsConstructor
public class MutedWordController {

    public record AddMutedWordRequest(@NotBlank String word) {
    }

    private final MutedWordService service;

    @GetMapping
    public List<MutedWordResponse> list(@AuthenticationPrincipal AuthUser me) {
        return service.list(me.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MutedWordResponse add(@AuthenticationPrincipal AuthUser me, @Valid @RequestBody AddMutedWordRequest req) {
        return service.add(me.id(), req.word());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal AuthUser me, @PathVariable Long id) {
        service.remove(me.id(), id);
    }
}
