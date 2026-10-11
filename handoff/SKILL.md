---
name: handoff
description: Write a compact handoff brief so a fresh session can continue this work without the bloated context, keep it updated live as work progresses, or resume from one. Use on `/handoff`, `/handoff start`, "write a handoff", "hand this off", or `/handoff resume` / "pick up where we left off". Manual only.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# handoff

A long session accumulates dead ends, resolved errors and file dumps, and every turn pays for all of it. A handoff distils the session into a short brief on disk so the user can `/clear` and continue from the brief instead of the transcript. The brief is state, not history: what we're doing, where we are, what we learned the hard way, what exactly comes next.

Modes from the argument: `/handoff start [slug]` opens a live brief at the start of the work, `/handoff [slug]` writes or finalizes, `/handoff resume [slug]` resumes, `/handoff list` lists.

A brief written only at the end is written from the most bloated, often already compacted context, and not at all if the session crashes or the user forgets. So the brief is live: once this session has written or resumed one, keep it current as the work moves (see Live updates), and the end-of-session `/handoff` becomes a short review.

Briefs live at `~/.claude/handoffs/<repo>/<slug>.md`, outside the code repo so they never touch its git status or PRs. That directory is itself a private git repo (`Markus-ipse/claude-handoffs`) synced between the user's machines: pull it (`git pull --rebase`) before reading a brief, and push after Start and Write; the skill's mod commits each live edit locally (see Live updates). `<repo>` is the basename of `git rev-parse --show-toplevel`; `<slug>` is a kebab-case work-stream name, usually from the branch. One file per work stream, updated in place; history goes in `Lineage`. Work spanning several repos gets one brief under the repo the session started in.

## Start

For work that will run long, unattended, or across a pause. Gather state as for Write (skip the WIP-push offer), then write the brief with what is known now: Goal, State, Next steps, Quick start, and a Lineage line `<date> — in progress — <session URL>`; leave the other sections as `None yet`. Commit (the mod normally already has) and push the handoffs repo once so the slug is claimed on the other machine. Reply with the path in one line and carry on with the work: unlike Write, this does not end the session.

## Live updates

These apply once this session has written or resumed a brief.

Update the brief when something it says stops being true, at these points:
- after a commit, or a test or check that passes or fails: State, Verification, Next steps;
- when an approach is abandoned: add it to Dead ends right away, before trying the next one;
- when a decision is made or the user rules something out: Decisions;
- before a long-running or unattended step, or when the user says they are stepping away.

Use small `Edit`s on the lines that changed and bump `Updated`; never rewrite the whole file, and keep it under 80 lines. The skill's mod (below) commits each edit to the handoffs repo locally and pushes a minute after the last one; don't commit or push it yourself on these updates.

The skill folder is also a mod (`hooks/register.ts`, loaded as `handoff@skills-dir` in CLI and Desktop sessions) that keeps this honest. It does nothing until this session has written a brief; then:
- each edit to the brief is committed locally and pushed a minute after the last one; edits from a session's last minute go out with the next sync from any session, or with `/handoff`;
- after a `git commit` in the code repo, a reminder to update the brief;
- when a turn ends with the brief older than 20 minutes and the repo changed since, one request to bring it up to date, not repeated until the brief changes;
- when the context window passes 60%, and every 15 points after, a request to update the brief while the context is still cached;
- after 50 minutes idle, before the prompt cache expires, one request to update the brief so the next session never has to wake this one. This assumes the 1-hour cache; on the 5-minute cache set `idleMinutes` to 4;
- on compaction, the summarizer is told about the brief, and the brief is handed back afterwards: where it and the summary disagree, trust the brief;
- if another session on this machine was live on the same brief in the last 6 hours, a warning. It may be a session that has since crashed, so ask the user; if both are running, continue in `<slug>-2.md`, created with `Write` so the mod follows it;
- the status line shows the brief's age.

Requests arrive as messages from the handoff plugin. Answer them with small `Edit`s; if nothing in the brief is out of date, say so in one line. The thresholds are the plugin's options (`/plugin configure handoff@skills-dir`).

## Write

If this session has kept the brief live, this is a finalize pass: re-read it, check it against the git state below, prune what no longer matters, fill in this session's Lineage line, and push. Otherwise write it from scratch.

Gather state first (branch, `git status --short`, recent log, unpushed commits, `gh pr list --head <branch>`), `git pull --rebase` the handoffs repo, and read the existing brief for this slug if there is one so you update rather than restart.

The brief may be resumed on another machine, so uncommitted or unpushed changes in the code repo will not follow it. If there are any, say so and offer to push a WIP commit on the branch; whatever is left behind goes in the brief under State so the other machine knows what it is missing.

Template:

```markdown
# Handoff: <slug>

- **Updated:** <YYYY-MM-DD HH:MM>
- **Repos / branches:** `<repo>` @ `<branch>`
- **Machine:** `$(hostname)`
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
<the 2–5 commands to be productive; start with `git fetch && git checkout <branch>` so it works from a clean checkout on another machine>

## Lineage
- <date> — <one line on what that session did> — <session URL>
```

Aim for under 80 lines. The savings come from what you leave out: anything CLAUDE.md or `docs/` already says (link the path instead), code, diffs, error output (name file and line; the next session reads it fresh), and problems already solved. Facts that outlive the task, such as a project gotcha or a user preference, belong in auto-memory, not the brief; write the memory now and reference it.

Commit and push the handoffs repo. Then reply with the file path, a 3–5 line summary so the user can sanity-check without opening it, and the resume line `/handoff resume <slug>` with a reminder to `/clear` first. Don't commit the code repo, and don't start more work; the point is to end the session.

## Resume

`git pull --rebase` the handoffs repo, then read the named brief, or the most recently modified one for this repo (if several, list them and ask). Read nothing else yet.

The user rebases and merges between sessions, so check for drift before trusting the brief: `git fetch`, current branch and status, commits since the Updated timestamp, whether the remote is ahead, and the PR state if one is named. If nothing moved, proceed. If things moved but the plan still holds, say what changed in a few lines, adjust the next steps, and proceed. If the plan is invalidated (branch gone, PR merged when the brief expects it open, files in the next steps no longer exist), report and stop.

Brief the user in a few lines (goal, state, drift verdict, the step you're starting) and start. Read files as each step needs them, not all up front.

Once started, update the brief's `Session` line and add a Lineage line `<date> — in progress — <session URL>`. That makes the brief live for this session (see Live updates); `/handoff` at the end finalizes it.

## List

`git pull --rebase` the handoffs repo, `ls -lt ~/.claude/handoffs/<repo>/`, and print slug, Updated, Goal, first next step for each.
