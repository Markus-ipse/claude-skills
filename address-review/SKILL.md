---
name: address-review
description: Triage a just-produced review (code or plan) — auto-applies clear-win fixes, then walks the rest one at a time with recommended actions and trade-offs. Use ONLY on explicit `/address-review` or "address the review" — do not auto-trigger after any review skill.
allowed-tools: Bash, Read, Grep, Glob, Edit, AskUserQuestion
---

# address-review

## Purpose

Close the gap between a review's findings and the actual fixes. Do the obvious work automatically; ask the human only on the decisions that genuinely need judgment. After this skill runs, every finding the reviewer surfaced has either been applied, decided on, or explicitly postponed — nothing falls silently through.

## When to run

Manual only. The skill never runs reviews itself — it works on the most recent reviewer output already in the conversation. If none is in scope, ask the user to point at one. If there are multiple plausible candidates, ask which.

## Rules of engagement

These are the constraints — the actual steps are yours to choose.

1. **Auto-fix when there's genuinely one right answer and no real trade-off.** Typos, unused imports, formatting, leftover debug output, applying a rename the reviewer explicitly named, removing dead code the reviewer pointed at, soft-wrap fixes. Just do these and list them in the summary — don't ask permission.

2. **Ask the human when there's a genuine trade-off**, using `AskUserQuestion`, one finding at a time so each answer can inform the next. For each:
   - **Recommended option first**, suffixed with **"(Recommended)"**, with the *why* in its description.
   - Only options genuinely worth considering. **No filler.** If "keep as-is" isn't a serious alternative, don't include it — `AskUserQuestion` always appends "Other", so the user can override.
   - Trade-off stated in plain language in each option's description.

   Reviewer hedging ("consider", "might", "could"), reviewer disagreements (`⚠️ DISAGREEMENT`), naming questions, behavior changes, and fixes touching multiple files all belong here. `[pre-existing]` findings get the same treatment as anything else — boy-scout rule.

3. **Only suggest postponing when the fix is a major refactor.** New module, cross-cutting rename, architectural change, or anything the reviewer themselves framed as a larger refactor. Don't postpone small or medium fixes because they're inconvenient.

4. **Severity order: BLOCKER → WARNING → NOTE → DISAGREEMENT.** Higher severity first. Within a tier, prioritize correctness over polish.

## Out of scope

This skill does not re-run the originating review, `git commit`, `git push`, or open PRs. If the most recent review has no actionable findings (no BLOCKER, WARNING, or NOTE entries) **and** no open questions for the user, exit immediately with "Nothing to address."

## Final summary shape

Terse, no ceremony. Skip empty sections.

```
ADDRESSED REVIEW

Auto-fixed:      <n>   • path/file.ts:42 — <what>  • …
Decided:         <n>   • path/file.ts:17 — <choice>  • …
Postponed:       <n>   • path/file.ts:120 — <major-refactor reason>  • …

Next: re-run the originating review (`/pre-commit-review` or `/plan-review`) to confirm clean state.
```
