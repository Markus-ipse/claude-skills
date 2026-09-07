---
name: pre-commit-review
description: Review changes before they are committed. Use when the user asks for a review before committing, signals they are ready to ship, or when Claude is about to run `git commit` — run this first, including for one-line changes.
allowed-tools: Bash, Read, Grep, Glob, Edit, Skill, Agent, AskUserQuestion
---

# pre-commit-review

Every commit gets reviewed. What changes is the depth, not whether it happens — and depth is decided by the routing rule below, not by judging whether a change looks risky enough to bother with. That judgment is the one this skill exists to take away.

## What you are reviewing

The staged diff (`git diff --cached`) when anything is staged, otherwise the working tree. If nothing is staged, say so and ask which the user wants. Everything below calls this the selected diff.

Also look at `git status`. Unstaged changes that clearly belong with the staged work usually mean the user forgot to stage a file — say so.

## Intent

You need to know what the change is *for*, and you cannot get that from the diff — inferring intent from the code and then checking the code against it only detects internal inconsistency.

Take intent from outside the diff, in this order: what you already know if this change came out of the current conversation; the branch name, ticket reference, or recent commit messages; the user, if none of those settle it. State it in one sentence at the top of the report so a wrong reading is visible immediately.

Load `CLAUDE.md` from the repo root and from the directories of changed files. Conventions defined there are reviewable; rules not written down anywhere are not.

## Routing

Mechanical, so it can't be argued with:

- **No source file changed** (only docs, config, lockfiles, comments) → native pass alone.
- **Any source file changed** → native pass, Codex pass, and product pass.
- **The branch is more than one commit ahead of `origin/main` or `origin/master`** → add the PR-level pass. Skip it on the default branch, or when no base ref exists.

## The passes

Run them concurrently — issue the calls in one message rather than waiting on each.

Each pass reports **everything it finds**, with a confidence and a rough severity attached to each finding, and filters nothing. Coverage is the goal here; ranking happens once, at the merge. A pass told to report only what matters will find a bug and then decline to mention it, which costs real recall — so do not add a bar, and if a pass volunteers one, keep the finding anyway.

**Native.** Invoke the `code-review` skill with args `high`. Explicit effort matters: with none given it inherits whichever level was typed last, so runs stop being comparable. It reports through a UI widget and is told not to restate findings as text — that's expected; carry them into the merged report regardless, which is this skill's actual output. Don't pass `--fix` (fixes are applied at the handoff below, under a policy `--fix` can't express) or `--comment` (this is a local gate, not a PR).

**Check what it actually reviewed before you use a word of it.** `code-review` resolves its own scope — a branch range against the upstream, in whatever directory the session is running from — and does not inherit the selected diff. It will not error when that resolves to something else; it returns a confident, well-formed review of the wrong changes. Observed in practice: it reviewed a different repository entirely and returned a dozen plausible findings about files nobody had touched. So compare the files it names against the files in the selected diff, and drop every finding that falls outside. If none of them overlap, treat the pass as failed rather than salvaging it, say so in the report, and do the native pass yourself against the selected diff at the same depth. A silently mis-scoped pass merged into the report is worse than a pass that didn't run, because the report then vouches for changes nobody read.

**Codex.** A different model, which is the entire reason it's here — it fails differently, where a second Claude pass would fail the same way. Run exactly this, unmodified:

```bash
timeout 300 codex exec review --uncommitted -c model_reasoning_effort=medium -o "${TMPDIR:-/tmp}/codex-uncommitted.md"
```

Read that file for the findings. `-o` writes Codex's final review there, so the merge works from one clean artifact instead of scraping it out of the progress output that also goes to stdout.

`codex exec review` rather than the plain `codex review`: both run non-interactively, but only the `exec` form has `-o`, `--json`, and `-m/--model`, and the last of those is the escape hatch if this pass ever needs a stronger model than the session default.

Codex accepts custom review instructions as a trailing `[PROMPT]` argument, even alongside `--uncommitted`. Don't use it. Its built-in review improves with each Codex release, and a prompt pinned in this file would freeze today's version of that thinking and then quietly rot — the same reason the native pass and the handoff below lean on their own built-ins. `--output-schema` is available and is declined for the same reason: constraining the shape of the final response constrains the review that produces it.

Two mechanics, both load-bearing. Claude Code's permission system splits on `&&`, `||`, `;` and `|` and matches each piece against an allow rule separately, so wrapping this in `command -v`, piping it to `tail`, or adding `2>&1` turns an allowed command into a permission prompt — `timeout` and the `-o` redirect-to-file introduce no operator and are safe. And the timeout is not decoration: Codex has a known failure where an internal git command exits non-zero, the error is reported, and the turn never ends, leaving the process alive indefinitely. An external watchdog is the only thing that stops it. Treat a timeout kill as a Codex failure, not a clean review — and check the output file exists before reading it, since a killed run may never have written one.

If Codex isn't installed it fails with a clear error — pass that through verbatim and carry on.

**PR-level.** The same command against the base branch — `--base "$base_branch"` in place of `--uncommitted`, a different `-o` path — using whichever of `origin/main` or `origin/master` exists. Catches what per-commit review structurally cannot: a helper added in one commit and orphaned by a later one, a feature whose tests never landed. Tag these findings `[pr-scope]`, and drop any the Codex pass already caught.

**Product.** A sub-agent (`general-purpose`) wearing the product-owner hat. Give it the intent, the product context you can find (`README.md`, `PRODUCT.md`, the branch name), and the selected diff in a fence long enough not to collide with fences inside the diff. Ask it:

> You are the product owner. The other reviewers cover correctness, security and style — don't duplicate them. Does this solve the user's actual problem or only the ticket's literal wording? Does it change behavior people already rely on — defaults, error messages, empty states? Is it gold-plated, or half-shipped in a way that leaves the feature unusable? Does it move toward goals actually stated in the context you were given, and what's still missing before someone could use this — docs, migration, a way to discover it exists? Cite file and line where a point attaches to code. If this is a pure refactor or a build fix with no user-visible dimension, say that in one line and stop.

If the spawn fails, note the error in the report and continue.

## Coverage

Nobody covers everything. Correctness and code quality come from the native and Codex passes; **security, performance and test coverage have only the Codex pass**. So if Codex didn't run, say which dimensions went unreviewed — a clean verdict without it is a narrower claim than one with it, and should read that way.

Findings on lines the diff didn't touch belong in a backlog, not here. The same legacy issues resurfacing on every commit train the reader to skim. Mention one only when the change makes it newly reachable.

## Merging

Rank once, here, using your own judgment rather than concatenating. Order by what it costs to be wrong: things that will crash, lose data, expose a vulnerability, or ship plainly wrong behavior; then likely bugs and unsafe practice; then everything else.

Two mapping notes. The native pass reports `CONFIRMED` or `PLAUSIBLE` rather than a severity — take severity from the finding's own consequence and let the verdict adjust it, dropping a plausible finding a level unless another pass found it independently. Product findings sit low by default, and rise when the change would ship confusing or half-finished behavior, or regress something users depend on.

Say which pass found what. Where two passes agree independently, say that too — it's the strongest signal in the report. Where they disagree, show both positions and leave it; resolving it silently throws away the disagreement, which is the useful part.

One asymmetry to respect: the Codex passes arrive already filtered by whatever bar Codex applies internally, and this skill deliberately doesn't override it. So Codex finding nothing minor is not evidence there is nothing minor — read its silence on low-severity issues as no information, never as a second vote for clean.

## What happens next

Report the verdict and the findings, then hand the findings to `address-review`, which applies the clear wins and walks the genuine trade-offs one at a time. Don't apply fixes yourself here — that skill already has the policy, and duplicating it here means two policies that will drift.

Once fixes are applied, run the repo's own checks (its lint, typecheck and test commands) and report what they actually printed. A fix that hasn't been run is a guess, and should be labeled one. If tests fail, say so with the output.

Keep the report to what the reader will act on. Name the file and line every time. If a file is clean, say so in a few words and move on.
