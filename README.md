# Claude Code Skills

Personal skills for [Claude Code](https://claude.com/claude-code). Each subdirectory is a self-contained skill loaded via its `SKILL.md`.

## Skills

### [plan-review](plan-review/SKILL.md)
Audit a plan against project conventions, current library/framework best practices (via the ref MCP when available), and software-engineering principles before implementation. Catches shortcuts, quick fixes, hardcoded values, ignored conventions, premature abstractions, and missing root-cause analysis, then asks for explicit confirmation.

**Triggers:** manual only — `/plan-review` or by name. Does not auto-invoke.

### [address-review](address-review/SKILL.md)
Triage a just-produced review (code or plan): auto-apply clear-win fixes, walk genuine trade-offs one at a time with recommended actions, and only postpone major refactors. Ensures every finding is applied, decided, or explicitly postponed — nothing falls silently through.

**Triggers:** `/address-review`, "address the review". Does not auto-invoke after review skills.

### [handoff](handoff/SKILL.md)
Write a compact (~80-line) brief to `~/.claude/handoffs/<repo>/<slug>.md` (a private git repo synced across machines) — goal, state, decisions, dead ends, verification, ordered next steps — so the user can `/clear` and continue in a fresh session. `resume` reloads a brief, runs a git/PR staleness check, and starts on the first next step; `list` shows briefs for the current repo.

**Triggers:** manual only — `/handoff`, `/handoff resume [slug]`, `/handoff list`.

### [ship](ship/SKILL.md)
End-to-end shipping flow: checks, feature branch, the repo's `/pr-review` with fixes, visual verification, PR, then CI and PR review comments through to green — never merges — and a `/handoff` brief.

**Triggers:** manual only — `/ship` or by name.

## Layout

```
skills/
├── plan-review/SKILL.md
├── address-review/SKILL.md
├── handoff/SKILL.md
└── ship/SKILL.md
```

Each `SKILL.md` begins with frontmatter (`name`, `description`, optional `allowed-tools`) that Claude Code uses to decide when to invoke the skill.
