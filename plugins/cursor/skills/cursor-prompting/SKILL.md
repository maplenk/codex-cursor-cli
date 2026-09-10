---
name: cursor-prompting
description: Briefs for Cursor print-mode reviews and rescues. Use when drafting cursor_review, cursor_adversarial_review, or cursor_rescue prompts, including base/scope/focus and write vs propose.
---

# Cursor prompting

The companion already injects git context (status, diff, log, changed-file list) for reviews. Put judgment and constraints in `prompt` / `focus`. Do not paste a second copy of the whole diff unless the user asked.

## Review (`cursor_review`)

Read-only (`--mode ask`). Ask Cursor to:

- State findings first, then residual risk
- Cite `path:line` (or hunk headers) for every issue
- Separate blockers from nits
- Skip style-only comments unless they hide a bug
- Honor `base`, `scope` (`auto` / `working-tree` / `branch`), and `focus`

If `base` is set, the brief is a merge-base review against that ref (default `HEAD`).

## Adversarial review (`cursor_adversarial_review`)

Same read-only invoke, hostile brief. Ask Cursor to assume the change is wrong until proven otherwise: missed authz, injection, races, data loss, broken rollback, tests that do not fail.

## Rescue (`cursor_rescue`)

Agent mode. The prompt should name:

- The failing symptom (test name, stack, URL)
- The intended fix, not a tour of the repo
- What not to touch

`write=true` applies edits (`--force`). Without it, Cursor proposes and does not write. Use `resume` to continue a prior `session_id`. Use `fresh=true` when the previous thread went off the rails.

## Ask (`cursor_ask`)

A single question. No repo mutation. Keep the prompt short; the workspace is already `--workspace cwd`.
