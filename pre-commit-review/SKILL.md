---
name: pre-commit-review
description: Use when user asks to review code before committing, when about to create a commit, or when user says "quick review", "looks good?", "ship it", or any variant. REQUIRED for ALL commits regardless of size — especially one-liners that seem obviously safe. If Claude is about to run `git commit`, this skill must run first.
---

# Pre-Commit Review

**MANDATORY systematic review** before every commit. This is a discipline-enforcing skill, not an optional shortcut.

**The Iron Law: Review every commit. No exceptions. No judgment calls about when to skip.**

One-liners crash production. Division by zero, off-by-one, unhandled None, hardcoded secret accidentally left in — "quick reviews" exist because these bugs are real and common. If you're about to commit, run this skill. Period.

---

## Step 1: Get the diff

Run these to see exactly what's going into the commit:

```bash
git diff --cached          # staged changes (what will be committed)
git diff                   # unstaged changes (remind user if anything was forgotten)
git status                 # full picture
```

If nothing is staged, tell the user and ask whether they want to stage files first or review the working tree diff instead.

---

## Step 2: Establish intent and load conventions

Before reviewing, gather two things.

**Intent** — Run:

```bash
git log --oneline -5          # recent commit messages for context
```

Infer the intent from the diff itself, variable/function names, comments, and the git log. State your understanding explicitly at the top of the review — one sentence is enough:

> "Reading this as: adds rate limiting to the login endpoint, capping at 5 attempts per minute per IP."

If intent is genuinely unclear from all available context, ask before reviewing — a review against the wrong goal is worse than no review.

**Conventions** — Load any CLAUDE.md files relevant to the changed code:

```bash
cat CLAUDE.md 2>/dev/null                        # root conventions
git diff --cached --name-only | xargs -I{} dirname {} | sort -u | while read dir; do
  [ -f "$dir/CLAUDE.md" ] && cat "$dir/CLAUDE.md"
done                                             # directory-level conventions
```

Pass the contents of any found CLAUDE.md files to both reviewers. If no CLAUDE.md exists, proceed without.

---

## Step 3: Run both reviewers in parallel

Spawn two subagents simultaneously using the Task tool — don't wait for one to finish before starting the other. Both receive the same diff, the intent statement from Step 2, and the contents of any CLAUDE.md files found.

### Reviewer A — Claude (native)

Read the diff carefully and think about it from two angles.

**Does it do the right thing?** Start with the intent from Step 2 and ask whether the code actually implements it — not just syntactically, but semantically. A condition can be technically valid but logically inverted. A formula can parse correctly but compute the wrong thing. The right field might be read but the wrong one written. Don't just check that the code runs — check that it does what was meant.

**Does it do it safely?** Think about what could go wrong at runtime: inputs that aren't what the code assumes, missing null checks, swallowed errors, hardcoded secrets, debug output left in. Also consider whether anything feels fragile or brittle even if it works today.

**CLAUDE.md compliance** — If CLAUDE.md files were loaded, check whether the changes follow the conventions they define. Only flag violations that are explicitly called out — don't invent rules that aren't there.

Trust your instincts. If something feels off, flag it — even if you can't immediately categorize why. If an issue is pre-existing (on lines not modified in this diff), flag it but mark it as such so the human can triage appropriately.

### Reviewer B — Codex (via CLI)

Run Codex non-interactively, piping the staged diff in as context:

```bash
git diff --cached | codex exec --ephemeral \
  "You are reviewing a code diff before it is committed. Intent: <intent from Step 2>. \
  <include CLAUDE.md contents if present> \
  List every issue you find — correctness, logic, safety, security, edge cases, and CLAUDE.md compliance. \
  For each issue state: severity (BLOCKER/WARNING/NOTE), file and line number, and a concise explanation. \
  If an issue is on a line not modified in this diff, mark it as pre-existing. \
  Do not suggest improvements or refactors. Only flag actual problems."
```

If `codex` is not on PATH or exits with an error, return that information so the orchestrator can note it in the report and proceed without this reviewer.

---

## Step 4: Merge and output

Wait for both subagents to complete, then merge their results. Apply your own judgment when merging — don't just concatenate blindly.

**Tagging:**
- `[both]` — both reviewers flagged the same issue (high confidence)
- `[claude]` — only Claude flagged it
- `[codex]` — only Codex flagged it
- `[pre-existing]` — issue is on lines not changed in this diff; flag it anyway, boy scout rule

**Disagreements:** If one reviewer flags something as a BLOCKER and the other doesn't mention it, call that out explicitly. Don't resolve disagreements yourself — surface them so the human can judge.

**If issues found:**
```
ISSUES FOUND

🔴 BLOCKER [both] — src/api/handler.ts:42
   `user.profile` can be undefined here if auth middleware didn't run.
   Accessing `.name` will throw.

🟡 WARNING [claude] — src/utils/parse.ts:17
   Empty string input returns NaN silently. Caller doesn't check.

🟡 WARNING [codex, pre-existing] — src/auth/token.ts:91
   Token expiry never checked. Predates this change but worth fixing.

⚠️  DISAGREEMENT — src/index.ts:3
   Codex: WARNING — unused import `lodash`.
   Claude: not flagged.

---
VERDICT: ❌ NOT READY — 1 blocker to resolve.
```

**If no issues found:**
```
No issues found across [N] changed files. Both reviewers agree.

VERDICT: ✅ LGTM — safe to commit.
```

**Severity guide:**
- 🔴 BLOCKER — will crash, data loss, security vulnerability, or definitely wrong behavior
- 🟡 WARNING — likely bug, bad practice, or something that should be addressed soon
- 🔵 NOTE — minor issue or observation; doesn't block the commit
- ⚠️  DISAGREEMENT — reviewers reached different conclusions; human judgment required

---

## Notes

- **Don't auto-fix.** Report issues and let the human decide. Your job is to find problems, not silently patch them.
- **Be specific.** Always include file + line number when possible. Vague feedback ("error handling could be better") is not useful.
- **Don't pad.** If a file is clean, say so and move on. The report should contain signal, not noise.
- **Unstaged changes:** If `git diff` shows unstaged changes that seem related to the work being committed, flag them — the developer may have forgotten to stage something.