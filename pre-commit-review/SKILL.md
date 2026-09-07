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

The **selected diff** for this review is the staged diff (`git diff --cached`) when anything is staged, or the working-tree diff (`git diff`) when the user opted to review unstaged changes. Later steps refer to "the selected diff" without re-stating the rule.

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

## Step 2: Establish intent and load context

Before reviewing, gather three things.

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

**Product context** — Reviewer D reviews for product fit, so it needs to know what the product is trying to be. Load whatever exists:

```bash
head -60 README.md 2>/dev/null                   # what the product is and who it's for
head -60 PRODUCT.md 2>/dev/null                  # explicit product goals, if the repo has them
git rev-parse --abbrev-ref HEAD                  # branch name often carries the ticket/intent
```

Pass intent + CLAUDE.md + product context to Reviewer D. Reviewers B and C use Codex's built-in review logic — Codex's `review` subcommand doesn't accept a custom prompt alongside its scope flags (`--uncommitted`, `--base`), so they receive none of this. Reviewer A (`/code-review`) takes only an effort level.

---

## Step 3: Run reviewers in parallel

Spawn the reviewers simultaneously — don't wait for one to finish before starting the next. Reviewers A, B, and D always run. Reviewer C runs only if Step 1b said the PR-level diff is larger than the staged diff.

### Coverage map

Each reviewer owns different ground. Nobody covers everything, so the merged report is only as complete as the reviewers that actually ran.

| Dimension | Owner |
|---|---|
| Correctness — does it implement the stated intent? | A (`/code-review`), B |
| Bugs & edge cases | A, B |
| Security | **B only** |
| Performance | **B only** |
| Test coverage | **B only** |
| Code quality, dead code, duplication, simplification | A, B |
| CLAUDE.md convention conformance | D |
| Product fit — does this serve the end user and our goals? | D |

**If Reviewer B (Codex) fails to run, say so prominently in the merged report and name what went unreviewed: security, performance, and test coverage have no other owner.** A verdict of ✅ LGTM without Codex is a weaker claim than one with it — state that rather than implying full coverage.

For pre-existing issues (on lines not modified in this diff), flag them anyway and mark them `pre-existing` so the human can triage.

### Reviewer A — Native `/code-review`

Invoke the built-in code-review skill via the Skill tool with `skill: "code-review"` and `args: "high"`.

- **Always pass an explicit effort level.** With no level given, `/code-review` reuses whichever level was typed last, which makes results non-deterministic across runs. `high` is right for a pre-commit gate — broader coverage, and it may surface uncertain findings, which the DISAGREEMENT section in Step 4 is built to hold.
- **Never pass `--fix`.** It applies findings straight to the working tree, which violates the no-auto-fix rule at the bottom of this skill. **Never pass `--comment`** either — this is a local pre-commit gate, not a PR.

`/code-review` renders its findings into a host UI widget via `ReportFindings` and is instructed not to also print them as text. That is expected. Carry those findings into the merged report anyway — **the merged report in Step 4 is the authoritative output of this skill**, and the widget is a duplicate view of one reviewer's slice, not a substitute for it.

Tag any issues from this pass `[native]` in the merged report.

### Reviewer B — Codex (via CLI)

Run Codex non-interactively using its built-in review subcommand. `--uncommitted` cannot be combined with a custom `[PROMPT]`, so rely on Codex's built-in review logic:

```bash
codex review --uncommitted -c model_reasoning_effort=low
```

**Run the command exactly as written above.** Do NOT wrap with `command -v codex && …`, do NOT pipe through `tail`, do NOT add `2>&1` redirects. Claude Code's permission system splits on `&&`, `||`, `;`, and `|` and requires each subcommand to match an allow rule independently — wrapping with `command -v` or piping to `tail` triggers a permission prompt even though `Bash(codex review:*)` is allowed. Run `codex review` directly; if it isn't on PATH it fails with a clear error, which you should return verbatim so the orchestrator can note it and flag the coverage gap per the coverage map above.

### Reviewer C — Codex PR-level pass (only if Step 1b found a larger diff)

Skip if Step 1b said to skip. Otherwise run **one** additional Codex review against the base branch to catch issues invisible at single-commit scope. Use `codex review --base` (purpose-built for this) — do not pipe diffs into `codex exec`. `--base` cannot be combined with a custom `[PROMPT]`, so rely on Codex's built-in PR-level logic:

```bash
codex review --base "$base_branch" -c model_reasoning_effort=low
```

Tag any issues from this pass `[pr-scope]` in the merged report.

### Reviewer D — Product Owner pass (Claude sub-agent)

Spawn a Claude sub-agent via the Agent tool with `subagent_type: "general-purpose"`. This reviewer wears the PO hat: the other reviewers ask whether the code is correct, D asks whether shipping it makes the product better for the people who use it.

Build the prompt from, in order: the framing below, the intent statement from Step 2, the product context from Step 2, any CLAUDE.md contents, and then the selected diff from Step 1.

Framing to give the sub-agent:

> You are the product owner for this codebase. Review this change for product fit, not for code correctness — other reviewers handle bugs, security and style, so do not duplicate them. Answer:
>
> 1. **Does this solve the actual user problem**, or only the literal wording of the ticket? Name the gap if there is one.
> 2. **User-facing impact** — does it change behavior people already rely on? Watch defaults, error messages, empty states, and anything that silently alters what a user sees or gets.
> 3. **Scope** — is it doing more than the goal needs (gold-plating, speculative abstraction), or less (half-shipped, feature unreachable or unusable as merged)?
> 4. **Goal alignment** — does it move toward the product's stated goals and conventions, or sideways? Only judge against goals actually stated in the context given; don't invent product strategy.
> 5. **What's missing before a user could really use this** — docs, migration, feature flag, telemetry, error states, a way to discover the feature exists.
>
> Be concrete and cite file + line where a point attaches to code. If the change is a pure refactor, a build fix, or otherwise has no user-visible dimension, say exactly that in one line and stop — do not manufacture product concerns.

Wrap the diff in a fence delimiter that cannot appear inside the diff itself. Scan the diff for fence runs as follows: for each line, strip the leading diff prefix (`+`, `-`, or space) before checking, then find the longest run of consecutive backticks at the start of the stripped line and the longest run of consecutive tildes. Pick a fence family (backticks or tildes) and use a fence at least one character longer than the longest run found in that family. If the diff has no fences at all, three backticks or three tildes suffice.

If the sub-agent spawn fails (e.g. the `general-purpose` subagent_type isn't registered, or the Agent tool returns an error), include the verbatim error message as a NOTE in the merged report explaining why D didn't run, and continue with the remaining reviewers.

Tag any issues this pass produces `[product]` in the merged report.

---

## Step 4: Merge and output

Wait for all reviewers to complete, then merge their results. Apply your own judgment when merging — don't just concatenate blindly. Group issues by **severity** (BLOCKER → WARNING → NOTE → DISAGREEMENT) so the most important issues are read first. Within each severity group, order by impact. Severity assignment is the merger's responsibility for all reviewers.

**Mapping `/code-review` findings (A):** it reports a `verdict` of CONFIRMED or PLAUSIBLE rather than a severity. Set severity from the finding's own consequence — crash, data loss, or exploitable vulnerability is a BLOCKER; a likely bug or unsafe practice is a WARNING; a simplification or cleanup suggestion is a NOTE. Then use the verdict as a modifier: a PLAUSIBLE finding drops one level (it may be wrong), and a PLAUSIBLE finding that another reviewer independently flagged goes back up.

**Mapping Product Owner findings (D):** default to NOTE. Upgrade to WARNING when the change would ship confusing or half-finished user-facing behavior. Upgrade to BLOCKER when it would regress behavior existing users depend on, or ship a feature in a state where a user cannot actually use it.

**Tagging:**
- `[multiple: …]` — flagged by 2+ reviewers (high confidence). Always enumerate which ones inline in alphabetical order, e.g. `[multiple: codex, native]`, `[multiple: native, product]`, `[multiple: codex, native, product]`. (Predictable order keeps downstream parsing/grep deterministic.)
- `[native]` — only Reviewer A (`/code-review`) flagged it
- `[codex]` — only Reviewer B flagged it
- `[pr-scope]` — flagged by Reviewer C, only visible across the cumulative PR diff. If Reviewer B already caught the same issue at single-commit scope, prefer `[codex]` alone (de-dupe — `[pr-scope]` is reserved for findings that wouldn't surface without the PR-level pass).
- `[product]` — only Reviewer D flagged it (product-owner pass)
- `[pre-existing]` — issue is on lines not changed in this diff; flag it anyway, boy scout rule. This is a co-tag — render it as a separate bracket alongside the source tag (e.g. `[codex] [pre-existing]`), not comma-joined inside the same bracket.

**Disagreements:** If one reviewer flags something as a BLOCKER and the other doesn't mention it, call that out explicitly. Don't resolve disagreements yourself — surface them so the human can judge.

**If issues found:** Group by severity. Show each section header only if it has entries.

```
ISSUES FOUND

🔴 BLOCKERS
  #1 [multiple: codex, native] — src/api/handler.ts:42
     `user.profile` can be undefined here if auth middleware didn't run.
     Accessing `.name` will throw.

🟡 WARNINGS
  #2 [native] — src/utils/parse.ts:17
     Empty string input returns NaN silently. Caller doesn't check.
  #3 [product] — src/api/handler.ts:42
     Rate limit returns a bare 429 with no body — the user has no way to
     know how long to wait. Ships as a dead end.
  #4 [codex] [pre-existing] — src/auth/token.ts:91
     Token expiry never checked. Predates this change but worth fixing.

⚠️  DISAGREEMENTS
  #5 — src/index.ts:3
     Codex: WARNING — unused import `lodash`.
     /code-review: not flagged.

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

- **Don't auto-fix.** Report issues and let the human decide. Your job is to find problems, not silently patch them. This is why Reviewer A never gets `--fix`.
- **Be specific.** Always include file + line number when possible. Vague feedback ("error handling could be better") is not useful.
- **Don't pad.** If a file is clean, say so and move on. The report should contain signal, not noise.
- **Name missing coverage.** If a reviewer didn't run, the verdict covers less ground — say which dimensions went unreviewed rather than implying a clean sweep.
- **Unstaged changes:** If `git diff` shows unstaged changes that seem related to the work being committed, flag them — the developer may have forgotten to stage something.
