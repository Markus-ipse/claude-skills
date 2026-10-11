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
Write a compact (~80-line) brief to `~/.claude/handoffs/<repo>/<slug>.md` (a private git repo synced across machines) — goal, state, decisions, dead ends, verification, ordered next steps — so the user can `/clear` and continue in a fresh session. `start` opens the brief at the beginning of the work; once a session has written or resumed a brief it is kept live, edited in place after commits, dead ends and decisions, so the end-of-session `/handoff` is a short finalize pass and a crash or forgotten handoff loses little. The skill folder is also a mod (`hooks/register.ts`), so it loads as the plugin `handoff@skills-dir` in CLI and Desktop sessions. Once a session has written a brief, the mod commits each edit locally and pushes it shortly after, reminds after commits, asks for an update when the brief goes stale, when the context passes 60% and before the prompt cache expires on an idle session, carries the brief through compaction, shows its age in the status line, and warns when two sessions are live on the same brief. Thresholds are plugin options (`/plugin configure handoff@skills-dir`).

Install the skill at `~/.claude/skills/handoff` (or symlink it there): the mod only loads from a skills directory. `claude plugin test handoff` runs its tests.

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
├── handoff/SKILL.md, hooks/register.ts, tests/
└── ship/SKILL.md
```

Each `SKILL.md` begins with frontmatter (`name`, `description`, optional `allowed-tools`) that Claude Code uses to decide when to invoke the skill.
