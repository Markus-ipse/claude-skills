---
name: handoff
description: Write a compact handoff brief so a fresh session can continue unfinished work without the bloated context, or resume from one. Writes nothing, and closes the stream's brief, when no work is left to continue. Use on `/handoff`, "write a handoff", "hand this off", or `/handoff resume` / "pick up where we left off". Manual only.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# handoff

A long session accumulates dead ends, resolved errors and file dumps, and every turn pays for all of it. A handoff distils the session into a short brief on disk so the user can `/clear` and continue from the brief instead of the transcript. The brief is state, not history: what we're doing, where we are, what we learned the hard way, what exactly comes next.

Modes from the argument: `/handoff [slug]` writes, `/handoff resume [slug]` resumes, `/handoff list` lists.

Briefs live at `~/.claude/handoffs/<repo>/<slug>.md`, outside the code repo so they never touch its git status or PRs. That directory is itself a private git repo (`Markus-ipse/claude-handoffs`) synced between the user's machines: pull it before reading a brief, commit and push after writing one. `<repo>` is the basename of `git rev-parse --show-toplevel`; `<slug>` is a kebab-case work-stream name, usually from the branch. One file per work stream, updated in place; history goes in `Lineage`. Work spanning several repos gets one brief under the repo the session started in.

## When to write one

A brief exists to carry unfinished work to a later session. Write one only when that session has to continue something no other record holds: uncommitted or unmerged work, a plan that is half carried out, or a dead end the next session would otherwise repeat.

Before writing, give every leftover its proper home:

- Planned work becomes an issue, when the repo tracks work in GitHub issues. So does a decision that waits for the user, as an issue or a comment on one.
- Where the work stands goes on its issue as a dated comment. If work stops without a merge, keep or drop the claim by the repo's own rules.
- A fact that outlives the task becomes a memory.

If nothing is left after that, write no brief. When this work stream already has one, delete the file, then commit and push the handoffs repo; its git history keeps the text. Say in one line that there is nothing to hand off and where the leftovers went, and stop. A brief whose first next step is "nothing is in flight" should not exist.

## Write

Gather state first (branch, `git status --short`, recent log, unpushed commits, `gh pr list --head <branch>`), `git pull` the handoffs repo, and read the existing brief for this slug if there is one so you update rather than restart.

The brief may be resumed on another machine, so uncommitted or unpushed changes in the code repo will not follow it. If there are any, say so and offer to push a WIP commit on the branch; whatever is left behind goes in the brief under State so the other machine knows what it is missing.

Template:

```markdown
# Handoff: <slug>

- **Updated:** <YYYY-MM-DD HH:MM>
- **Repos / branches:** `<repo>` @ `<branch>`
- **Machine:** `$(hostname)`
- **PR(s):** <url or none>
- **Issues / epic:** <`<repo>#<n>` for each issue this session owns, or none>
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
1. <concrete, ordered, with file paths; step 1 must be startable with zero further investigation. Only the thread of this session: work that has an issue is named as `<repo>#<n>`, not described again, and work that is planned but not started is an issue, not a step here>

## Open questions / blockers
<decisions and external waits that block the next steps above; any other open decision belongs in an issue>

## Quick start
<the 2–5 commands to be productive; start with `git fetch && git checkout <branch>` so it works from a clean checkout on another machine>

## Lineage
- <date> — <one line on what that session did> — <session URL>
```

Aim for under 80 lines. The savings come from what you leave out: anything CLAUDE.md or `docs/` already says (link the path instead), code, diffs, error output (name file and line; the next session reads it fresh), and problems already solved. Facts that outlive the task, such as a project gotcha or a user preference, belong in auto-memory, not the brief; write the memory now and reference it.

Commit and push the handoffs repo. Then reply with the file path, a 3–5 line summary so the user can sanity-check without opening it, and the resume line `/handoff resume <slug>` with a reminder to `/clear` first. Don't commit, and don't start more work; the point is to end the session.

## Resume

`git pull` the handoffs repo, then read the named brief, or the most recently modified one for this repo (if several, list them and ask). Read nothing else yet.

The user rebases and merges between sessions, so check for drift before trusting the brief: `git fetch`, current branch and status, commits since the Updated timestamp, whether the remote is ahead, the PR state if one is named, and each named issue (closed, assigned to someone else, or moved to another column). If nothing moved, proceed. If things moved but the plan still holds, say what changed in a few lines, adjust the next steps, and proceed. If the plan is invalidated (branch gone, PR merged when the brief expects it open, an issue closed or taken by someone else, files in the next steps no longer exist), report and stop.

Brief the user in a few lines (goal, state, drift verdict, the step you're starting) and start. Read files as each step needs them, not all up front.

When the resumed session ends, apply "When to write one" again: write the brief under the same slug with a new Lineage line if work is left, or delete it if the stream is finished.

## List

`git pull` the handoffs repo, `ls -lt ~/.claude/handoffs/<repo>/`, and print slug, Updated, Goal, first next step for each.
