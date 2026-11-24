# Claude Code Skills

Personal skills for [Claude Code](https://claude.com/claude-code). Each subdirectory is a self-contained skill loaded via its `SKILL.md`.

## Skills

### [plan-review](plan-review/SKILL.md)
Audit a plan against project conventions, current library/framework best practices (via the ref MCP when available), and software-engineering principles before implementation. Catches shortcuts, quick fixes, hardcoded values, ignored conventions, premature abstractions, and missing root-cause analysis, then asks for explicit confirmation.

**Triggers:** manual only — `/plan-review` or by name. Does not auto-invoke.

### [handoff](handoff/SKILL.md)
Write a compact (~80-line) brief to `~/.claude/handoffs/<repo>/<slug>.md` (a private git repo synced across machines) — goal, state, decisions, dead ends, verification, ordered next steps — so the user can `/clear` and continue in a fresh session. `resume` reloads a brief, runs a git/PR staleness check, and starts on the first next step; `list` shows briefs for the current repo.

**Triggers:** manual only — `/handoff`, `/handoff resume [slug]`, `/handoff list`.

### [ship-full](ship-full/SKILL.md)
End-to-end shipping flow: checks, feature branch, the repo's `/pr-review` with fixes, visual verification, PR, then CI and PR review comments through to green — never merges — and a `/handoff` brief.

**Triggers:** manual only — `/ship-full` or by name. Named `ship-full` because Claude Code 2.1.330+ has a built-in `/ship` (commit, PR, review, then watch the PR until it is merged or closed; it never merges).

## Layout

```
skills/
├── plan-review/SKILL.md
├── handoff/SKILL.md
└── ship-full/SKILL.md
```

Each `SKILL.md` begins with frontmatter (`name`, `description`, optional `allowed-tools`) that Claude Code uses to decide when to invoke the skill.
