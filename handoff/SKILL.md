---
name: handoff
description: Write a compact handoff brief so a fresh session can continue this work without the bloated context, or resume from one. Use on `/handoff`, "write a handoff", "hand this off", or `/handoff resume` / "pick up where we left off". Manual only.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# handoff

A long session accumulates dead ends, resolved errors and file dumps, and every turn pays for all of it. A handoff distils the session into a short brief on disk so the user can `/clear` and continue from the brief instead of the transcript. The brief is state, not history: what we're doing, where we are, what we learned the hard way, what exactly comes next.

Modes from the argument: `/handoff [slug]` writes, `/handoff resume [slug]` resumes, `/handoff list` lists.

Briefs live at `~/.claude/handoffs/<repo>/<slug>.md`, outside the repo so they never touch git status or PRs. `<repo>` is the basename of `git rev-parse --show-toplevel`; `<slug>` is a kebab-case work-stream name, usually from the branch. One file per work stream, updated in place; history goes in `Lineage`. Work spanning several repos gets one brief under the repo the session started in.

## Write

Gather state first (branch, `git status --short`, recent log, unpushed commits, `gh pr list --head <branch>`), and read the existing brief for this slug if there is one so you update rather than restart.

Template:

```markdown
# Handoff: <slug>

- **Updated:** <YYYY-MM-DD HH:MM>
- **Repos / branches:** `<repo>` @ `<branch>`
- **PR(s):** <url or none>
- **Session:** <claude.ai session URL from the attribution reminder>

## Goal
<1–3 lines>

## State
<≤10 bullets: done / in progress / not started, with file paths>

## Decisions
<decision → why; rejected alternatives only where a fresh agent would re-propose them>

## Dead ends
<what was tried, why it failed. The most valuable section: it is the one thing the next session cannot cheaply rediscover.>

## Verification
- Tested: <what actually ran and passed>
- NOT tested: <be explicit>

## Next steps
1. <concrete, ordered, with file paths; step 1 must be startable with zero further investigation>

## Open questions / blockers
<decisions only the user can make; external waits>

## Quick start
<the 2–5 commands to be productive>

## Lineage
- <date> — <one line on what that session did> — <session URL>
```

Aim for under 80 lines. The savings come from what you leave out: anything CLAUDE.md or `docs/` already says (link the path instead), code, diffs, error output (name file and line; the next session reads it fresh), and problems already solved. Facts that outlive the task, such as a project gotcha or a user preference, belong in auto-memory, not the brief; write the memory now and reference it.

Then reply with the file path, a 3–5 line summary so the user can sanity-check without opening it, and the resume line `/handoff resume <slug>` with a reminder to `/clear` first. Don't commit, and don't start more work; the point is to end the session.

## Resume

Read the named brief, or the most recently modified one for this repo (if several, list them and ask). Read nothing else yet.

The user rebases and merges between sessions, so check for drift before trusting the brief: `git fetch`, current branch and status, commits since the Updated timestamp, whether the remote is ahead, and the PR state if one is named. If nothing moved, proceed. If things moved but the plan still holds, say what changed in a few lines, adjust the next steps, and proceed. If the plan is invalidated (branch gone, PR merged when the brief expects it open, files in the next steps no longer exist), report and stop.

Brief the user in a few lines (goal, state, drift verdict, the step you're starting) and start. Read files as each step needs them, not all up front.

When the resumed session ends, write the brief again under the same slug and add a Lineage line.

## List

`ls -lt ~/.claude/handoffs/<repo>/` and print slug, Updated, Goal, first next step for each.
