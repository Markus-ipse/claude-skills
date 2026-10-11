# Claude Code Skills

Personal skills for [Claude Code](https://claude.com/claude-code). Each subdirectory is a self-contained skill loaded via its `SKILL.md`.

## Skills

### [pre-commit-review](pre-commit-review/SKILL.md)
Review before every commit, with depth routed mechanically by what changed. Docs-only changes get the built-in `/code-review` pass alone; touching source adds a Codex pass (a different model, so it fails differently) — with an opt-in Antigravity (`agy`, Gemini) stand-in when Codex fails, which needs a prior interactive `agy` login and costs about half a million tokens per run — and a product-owner pass asking whether the change actually serves the end user. A branch ahead of its base also gets a PR-level pass for issues no single commit shows. Passes report everything they find and rank nothing — filtering at the finding stage costs recall — so severity is assigned once, at the merge. Hands findings to `address-review` rather than fixing in place.

**Triggers:** "review before commit", "quick review", "looks good?", "ship it", or any `git commit`.

### [plan-review](plan-review/SKILL.md)
Audit a plan against project conventions, current library/framework best practices (via the ref MCP when available), and software-engineering principles before implementation. Catches shortcuts, quick fixes, hardcoded values, ignored conventions, premature abstractions, and missing root-cause analysis, then asks for explicit confirmation.

**Triggers:** manual only — `/plan-review` or by name. Does not auto-invoke.

### [address-review](address-review/SKILL.md)
Triage a just-produced review (code or plan): auto-apply clear-win fixes, walk genuine trade-offs one at a time with recommended actions, and only postpone major refactors. Ensures every finding is applied, decided, or explicitly postponed — nothing falls silently through.

**Triggers:** `/address-review`, "address the review", or a handoff from `pre-commit-review`. Does not auto-invoke after other review skills.

### [handoff](handoff/SKILL.md)
Write a compact (~80-line) brief to `~/.claude/handoffs/<repo>/<slug>.md` (a private git repo synced across machines) — goal, state, decisions, dead ends, verification, ordered next steps — so the user can `/clear` and continue in a fresh session. `start` opens the brief at the beginning of the work; once a session has written or resumed a brief it is kept live, edited in place after commits, dead ends and decisions, so the end-of-session `/handoff` is a short finalize pass and a crash or forgotten handoff loses little. Hooks in the skill's frontmatter (`scripts/live.py`, registered once `/handoff` runs) remind after commits, nudge once when the brief is stale, re-inject it after compaction, commit each edit locally and push at session end, and warn when two sessions write the same brief. `resume` reloads a brief, runs a git/PR staleness check, and starts on the first next step; `list` shows briefs for the current repo.

The hooks find the script via `${CLAUDE_SKILL_DIR}`, falling back to `~/.claude/skills/handoff`; install the skill there (or symlink it) for the hooks to run. They need `python3`.

**Triggers:** manual only — `/handoff start [slug]`, `/handoff`, `/handoff resume [slug]`, `/handoff list`.

### [ship](ship/SKILL.md)
End-to-end shipping flow: checks, pre-commit review with fixes, visual verification, feature branch and PR, then CI and PR review comments through to green — never merges — and a `/handoff` brief.

**Triggers:** manual only — `/ship` or by name.

## Layout

```
skills/
├── pre-commit-review/SKILL.md
├── plan-review/SKILL.md
├── address-review/SKILL.md
├── handoff/SKILL.md, scripts/live.py
└── ship/SKILL.md
```

Each `SKILL.md` begins with frontmatter (`name`, `description`, optional `allowed-tools`) that Claude Code uses to decide when to invoke the skill.
