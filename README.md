# Claude Code Skills

Personal skills for [Claude Code](https://claude.com/claude-code). Each subdirectory is a self-contained skill loaded via its `SKILL.md`.

## Skills

### [pre-commit-review](pre-commit-review/SKILL.md)
Mandatory systematic review before every commit. Runs Claude and Codex reviewers in parallel across six dimensions (correctness, bugs, security, performance, tests, quality), plus an optional PR-level pass against the base branch to catch cross-commit issues. Mirrors the GitHub PR-review Action so nothing resurfaces there.

**Triggers:** "review before commit", "quick review", "looks good?", "ship it", or any `git commit`.

### [fix-pr-comments](fix-pr-comments/SKILL.md)
Analyze PR review feedback, classify comments by category (action required, bug, security, question, suggestion, style, praise), prioritize P1–P4, apply fixes, commit, push, and reply to reviewers.

**Triggers:** "review PR comments", "fix PR feedback", "address review feedback".

### [plan-review](plan-review/SKILL.md)
Audit a plan against project conventions, current library/framework best practices (via the ref MCP when available), and software-engineering principles before implementation. Catches shortcuts, quick fixes, hardcoded values, ignored conventions, premature abstractions, and missing root-cause analysis, then asks for explicit confirmation.

**Triggers:** manual only — `/plan-review` or by name. Does not auto-invoke.

## Layout

```
skills/
├── pre-commit-review/SKILL.md
├── fix-pr-comments/SKILL.md
└── plan-review/SKILL.md
```

Each `SKILL.md` begins with frontmatter (`name`, `description`, optional `allowed-tools`) that Claude Code uses to decide when to invoke the skill.
