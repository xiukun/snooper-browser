# Maintainer Workflow

This document defines how `xiukun/snooper-browser` is maintained. It is the
operating agreement for triaging issues, reviewing pull requests, and
monitoring community feedback channels.

## Branch model

- `main` is protected: **all changes arrive via pull request**.
- Linear history is required — PRs are squash-merged.
- Force pushes and branch deletions are disabled.
- A new push invalidates stale reviews (`dismiss_stale_reviews`), so every
  review targets the latest code.

## Issue triage

Every new issue gets the `triage` label on arrival, then one of:

| Situation | Action |
| --- | --- |
| Reproducible bug | `bug` + priority, then fix via PR |
| Feature request | `feature-request`; implement only if it fits the product's no-backend/no-telemetry boundaries |
| Question | `question`; answer directly |
| Duplicate | `duplicate` + link to the original |
| Third-party relay / advertisement | `advertisement` + the partnership template reply below |
| Cannot reproduce / missing info | `awaiting-feedback` + concrete reproduction questions |

Nothing is closed silently: every closing action includes a comment explaining
why.

## Pull request review

An AI-generated or human PR is accepted only after all of these pass:

1. **Fetch and run locally** — `gh pr checkout <n>`, then:
   - `npm run build:ext`
   - `npm run test:guards`
   - `npm run test:chat-state`
   - `npm run test:image-material`
   - `npm run type-check`
   - `npm run build:app`
   - `git diff --check`
2. **Line-by-line review** of the diff. Look for:
   - untested edge cases and error paths
   - security issues: secrets, injection, permission scope creep, requests to
     third-party endpoints
   - violations of the repo's invariants (see `AGENTS.md` §2)
   - AI-slop patterns: plausible-looking code that was never executed
3. **Manual behavior check** when the PR touches the extension UI or the audio
   pipeline — load the built extension and verify the changed behavior.
4. **Verdict**:
   - all green → squash merge, then reply on the PR with what was verified
   - fixable problems → comment with file/line specifics and request changes
   - wrong direction or unmaintainable → explain and close

A PR with no response after 7 days of awaiting changes gets a follow-up
comment; after 14 more days of silence it is closed with an explanation.

## Community reply templates

### Third-party relay advertisement

> 感谢关注，日后会出相关合作方案，敬请期待。

(No third-party relays are integrated into the product.)

### Bug fix shipped

> 已在 vX.Y 修复并上线（<PR 链接>），感谢反馈。如果更新后仍有问题，欢迎继续补充信息。

### PR accepted

> 已合并（<commit 链接>）。验证过程：<逐项列出实际运行的检查与结果>。

### PR rejected

> 暂不合并。具体原因：<逐条列出 file/line 级问题>。欢迎按上述意见修改后再次提交。

## Monitoring cadence

| Channel | Cadence | Notes |
| --- | --- | --- |
| GitHub issues + PRs | every check-in | `gh api 'repos/xiukun/snooper-browser/issues?state=open'` |
| CI / build failures | every check-in | must be investigated, never blindly re-run |
| Stale items | weekly | 7-day PR follow-up, 14+14-day issue close policy |
| Community channels (Discord, X) | as configured | relevance-filter first to save tokens |

## Release flow

1. All checks green on `main`.
2. `npm run package:ext` produces the store ZIP + sha256.
3. `gh release create vX.Y.Z --generate-notes`.
4. Fixed community issues get the "shipped" reply template.
