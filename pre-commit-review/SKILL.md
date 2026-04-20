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

## Step 1b: Detect PR-level scope

A per-commit review can't see issues that emerge from the *combination* of several commits — dead code added in one commit and never used, a helper added early but the call site reshuffled later, missing tests for a feature spread across commits. The GH PR-review Action sees those because it diffs against the base branch. Mirror that.

```bash
current=$(git rev-parse --abbrev-ref HEAD)                                  # current branch
base_branch=""                                                              # resolve base ref
git rev-parse --verify --quiet origin/main  >/dev/null && base_branch=origin/main
[ -z "$base_branch" ] && git rev-parse --verify --quiet origin/master >/dev/null && base_branch=origin/master
[ -n "$base_branch" ] && git diff "$base_branch"...HEAD --stat              # PR-level diff size
```

Skip the PR-level pass entirely when:
- current branch is `main` or `master`, OR
- `$base_branch` is empty (no `origin/main` or `origin/master` exists), OR
- the PR-level diff is the same size as the staged diff (nothing extra to review).

Otherwise pass `$base_branch` to Reviewer C in Step 3.

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

## Step 3: Run reviewers in parallel

Spawn the reviewers simultaneously using the Task tool — don't wait for one to finish before starting the next. Reviewers A and B always run. Reviewer C runs only if Step 1b said the PR-level diff is larger than the staged diff. All reviewers receive the intent statement from Step 2 and the contents of any CLAUDE.md files found.

Reviewers A and B must explicitly cover all six dimensions below — in this order. The GH PR-review Action checks the same list, so anything missed here will resurface there. (Reviewer C has a narrower brief — see its section.)

1. **Correctness** — does the code actually implement the intent from Step 2? A condition can be technically valid but logically inverted; a formula can parse correctly but compute the wrong thing; the right field might be read but the wrong one written. Check semantics, not just syntax.
2. **Bugs & edge cases** — what inputs, states, or conditions could the code encounter that it doesn't handle? Think adversarially about boundaries, concurrency, error paths, and assumptions the code is silently making.
3. **Security** — what could an attacker (or a malformed input from a trusted source) do here? Consider trust boundaries, data flowing in from outside the system, anything sensitive flowing out, and any operation that grants privilege or accesses resources.
4. **Performance** — under realistic load and data sizes, will this scale? Look for work that grows with input, repeated work, blocking operations, and resource use that isn't obvious from the local code.
5. **Test coverage** — for every new or non-trivially changed function, is there a test? If tests changed, do they actually exercise the new behavior or only the happy path? Are error paths and edge cases tested?
6. **Code quality** — naming, dead code, duplicated logic, unused imports, debug output left in, violations of any loaded CLAUDE.md conventions. Only flag concrete problems, not stylistic preferences.

For pre-existing issues (on lines not modified in this diff), flag them anyway and mark them `pre-existing` so the human can triage.

### Reviewer A — Claude (native)

Read the diff carefully and walk through the six dimensions above. Trust your instincts — if something feels off, flag it even if you can't immediately categorize why.

If CLAUDE.md files were loaded, check the changes against the conventions they define. Only flag violations that are explicitly called out — don't invent rules that aren't there.

### Reviewer B — Codex (via CLI)

Run Codex non-interactively using its built-in review subcommand:

```bash
codex review --uncommitted \
  -c model_reasoning_effort=low \
  "Intent: <intent from Step 2>. \
  <include CLAUDE.md contents if present> \
  Review across all six dimensions: (1) correctness vs intent, (2) bugs & edge cases, \
  (3) security, (4) performance, (5) test coverage, (6) code quality. \
  For each issue state: severity (BLOCKER/WARNING/NOTE), file and line number, dimension, \
  and a concise explanation. If an issue is on a line not modified in this diff, mark it pre-existing. \
  Focus on real problems, not stylistic preferences. Suggest improvements only when the current code \
  has a concrete drawback (bug risk, perf cost, security weakness, missing test, or CLAUDE.md violation)."
```

If `codex` is not on PATH or exits with an error, return that information so the orchestrator can note it in the report and proceed without this reviewer.

### Reviewer C — Codex PR-level pass (only if Step 1b found a larger diff)

Skip if Step 1b said to skip. Otherwise run **one** additional Codex review against the base branch to catch issues invisible at single-commit scope. Use `codex review --base` (purpose-built for this) — do not pipe diffs into `codex exec`:

```bash
codex review --base "$base_branch" \
  -c model_reasoning_effort=low \
  "This review covers the full diff this PR will introduce vs the base branch. \
  Look ONLY for issues that emerge from the combination of multiple commits: \
  unused additions, contradictions between commits, dead code added then never wired up, \
  missing tests for the feature as a whole, broken invariants spanning files, \
  partially-applied refactors. Skip anything a single-commit review would already see. \
  For each issue state: severity (BLOCKER/WARNING/NOTE), file and line, and explanation."
```

Tag any issues from this pass `[pr-scope]` in the merged report.

---

## Step 4: Merge and output

Wait for all reviewers to complete, then merge their results. Apply your own judgment when merging — don't just concatenate blindly. Group issues by **severity** (BLOCKER → WARNING → NOTE → DISAGREEMENT) so the most important issues are read first. Within each severity group, order by impact.

**Tagging:**
- `[both]` — both Reviewer A (Claude) and Reviewer B (Codex) flagged the same issue (high confidence)
- `[claude]` — only Reviewer A flagged it
- `[codex]` — only Reviewer B flagged it
- `[pr-scope]` — flagged by Reviewer C, only visible across the cumulative PR diff
- `[pre-existing]` — issue is on lines not changed in this diff; flag it anyway, boy scout rule

**Disagreements:** If one reviewer flags something as a BLOCKER and the other doesn't mention it, call that out explicitly. Don't resolve disagreements yourself — surface them so the human can judge.

**If issues found:** Group by severity. Show each section header only if it has entries.

```
ISSUES FOUND

🔴 BLOCKERS
  #1 [both] — src/api/handler.ts:42
     `user.profile` can be undefined here if auth middleware didn't run.
     Accessing `.name` will throw.

🟡 WARNINGS
  #2 [claude] — src/utils/parse.ts:17
     Empty string input returns NaN silently. Caller doesn't check.
  #3 [codex, pre-existing] — src/auth/token.ts:91
     Token expiry never checked. Predates this change but worth fixing.

⚠️  DISAGREEMENTS
  #4 — src/index.ts:3
     Codex: WARNING — unused import `lodash`.
     Claude: not flagged.

---
VERDICT: ❌ NOT READY — #1 is a blocker.
```

**If no issues found:**
```
No issues found across [N] changed files. All reviewers agree.

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