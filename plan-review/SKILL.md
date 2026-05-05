---
name: plan-review
description: Audits a plan against project conventions, current library/framework best practices (via the ref MCP when available), and software-engineering principles, then asks for explicit confirmation before implementation. Invoke ONLY on explicit `/plan-review` request or when the user asks for it by name — do not auto-trigger; the user has opted out of automatic invocation because of the token cost.
---

# plan-review

## Why this skill exists

Catch shortcuts in the plan, before they get baked into code. Hold the plan to project conventions and current best practices, then force an explicit confirmation. Stability and UX over expedience — recommend the larger refactor when it's the right fix, don't quietly take the smaller path.

## When to run

Manually-invoked only. Run this skill **only** when the user explicitly types `/plan-review` or asks for it by name. Do not auto-invoke based on context, phrases, or proximity to a plan — the user has opted out of auto-triggering because of the token cost of the full workflow below.

The auto-trigger ban is about Claude *deciding on its own* to invoke; it has nothing to do with timing. The canonical path is the user typing `/plan-review` immediately after `ExitPlanMode`, and that's fine — it's not auto-invocation, it's user-invocation that happens to follow plan mode.

When invoked, the plan to review is whichever is most recently in scope: the latest `ExitPlanMode` output, a plan markdown file the user has referenced, or a plan written earlier in the conversation. If multiple candidates exist, ask which one.

## Workflow

### Step 1 — Locate the plan

Find the most recent plan in scope. Check, in order:

1. The most recent `ExitPlanMode` output in this conversation
2. Any markdown file the user has just referenced as "the plan" (FRD, design doc, proposal)
3. A plan written earlier in this conversation (e.g. by a planning sub-agent or as a draft in chat)

If no plan is in scope, stop and ask the user to paste it or point to it — do not invent one. If multiple candidates exist, ask which to review.

### Step 2 — Discover the project's conventions

The skill is project-agnostic, so it has to learn what *this* project considers correct on the fly. Skim whatever exists in the current working directory:

- **Repo root**: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`
- **Docs directories**: `docs/`, `documentation/`, `.github/` (PR templates, contributing guides, ADRs)
- **Tooling config** (signals enforced rules): `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `.editorconfig`, `pyproject.toml`, `ruff.toml`, `Cargo.toml`, etc.

Cache the relevant findings in your working memory — you'll cite them when flagging issues. If the project has no docs at all, fall back to the general principles below and be explicit that you're applying defaults rather than codified rules.

### Step 3 — Pull external best-practice context (ref MCP, when available)

For libraries and frameworks the plan touches, consult current docs through the **ref MCP**. Use `mcp__ref__ref_search_documentation` to locate relevant pages, then `mcp__ref__ref_read_url` to read the most relevant result. Typical questions: deprecated APIs, recommended patterns, breaking changes since the project's pinned version.

APIs and recommended patterns evolve — what was idiomatic two years ago may now be the deprecated path, so don't skip this when a library is involved and the MCP is available.

**Fallback if the ref MCP isn't configured in this session, or if a search returns no useful results for a given library** (proprietary, very new, or otherwise undocumented): apply built-in knowledge instead, and state the limitation explicitly in the review output (e.g. "ref MCP unavailable — library best-practice checks based on built-in knowledge, may be stale", or "no ref docs for `<library>` — checks based on built-in knowledge"). Do not fabricate citations.

### Step 4 — Review

Walk the plan section by section. For every change proposed, ask **"what's the root cause this is responding to, and does this actually fix it, or just paper over it?"**

Review against:

1. The non-negotiable principles below
2. The project's own conventions surfaced in Step 2
3. Current library best practices from Step 3
4. The anti-pattern checklist below
5. General software engineering judgment: is this simple, coherent, testable, reversible?

Be specific. When you flag something, name the file or section of the plan, quote or paraphrase the offending decision, and explain *why* it's a problem.

### Step 5 — Recommend

For each issue, propose the fix you'd actually want. If that fix is significantly larger than what the plan proposes — e.g. a refactor instead of a patch — say so explicitly. Frame the trade-off so the user can make the call:

> "The plan proposes adding a flag to skip validation in this code path. The root issue is that the validator was built around a single caller and now has three. The smaller fix is the flag. The correct fix is to extract a per-caller validation strategy — larger, but it removes the underlying coupling. Recommend the refactor."

The user has stated a preference for the correct fix, even when larger, when stability and UX justify it. Don't quietly default to the smaller path.

### Step 6 — Ask for confirmation

End the review with an explicit confirmation question in plain text, with concrete options the user can pick from. Implementation does not proceed until the user has approved or revised the plan.

Suggested phrasing: *"Want me to revise the plan with these changes, proceed as-is, or discuss a specific item?"*

## Non-negotiable principles

State these as review checks against every plan:

- **Root cause, not symptom.** If the plan patches around the real bug instead of fixing it, flag it. Always.
- **No "good enough for v1."** Any phrase like "for now", "we can fix this later", "v1 doesn't need to handle this", "good enough for the prototype" is a red flag — surface it and propose the real fix.
- **Stability and UX over expedience.** A larger refactor is fine — and often correct — if it leaves the codebase more coherent and the user experience more stable.
- **No backward-compatibility shims** unless the user explicitly asked for them.
- **Project conventions are authoritative.** Whatever the repo's docs, lint config, or established patterns dictate, the plan must follow. If the plan introduces a new pattern, ask why the existing one isn't being used.
- **Don't introduce abstractions ahead of need.** Three similar lines beats a premature abstraction.

## Anti-pattern checklist

**Shortcuts and "we'll fix it later"**
- Deferred TODOs, "temporary" workarounds, feature flags used as escape hatches
- `any` types, unsafe `as` casts, ignored TS / lint errors
- Mocked dependencies in tests where an integration test is what would actually catch the bug
- Missing tests for the change the plan describes
- Error handling deferred or stubbed; missing handling at real system boundaries

**Architecture**
- Premature abstractions — one caller, but a generic interface
- New pattern introduced when an existing one already fits
- Tight coupling across feature / module boundaries
- Bypassing established providers, contexts, or service layers

**Verification**
- Missing or vague verification plan — the plan should specify how it will be checked
- Missing visual verification step for UI changes
- Not running the project's check suite (`lint`, `typecheck`, `test`, etc.) before claiming done

**Workflow**
- Direct commit to `main` / `master` where the project requires PRs
- Branching, review, or merge conventions ignored

## Output format

Free-form, but keep it scannable. A loose shape that works:

- **What's solid** — quick acknowledgement of what looks good (one or two lines, don't pad)
- **Risks and violations** — concrete issues with file paths or plan sections, severity, and *why*
- **Refactor recommendations** — where the plan should go larger, with the trade-off explained
- **Open questions** — anything that needs the user's input before implementation can proceed
- **Confirmation question** at the end

Don't pad the review with ceremony. If the plan is genuinely good, say so briefly and ask for confirmation to proceed. If it's risky, lean into specifics — file paths, exact decisions, the underlying root cause.
