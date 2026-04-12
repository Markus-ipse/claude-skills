---
name: fix-pr-comments
description: Analyze PR comments to identify actionable feedback, prioritize issues, fix them, and reply to reviewers. Use when asked to "review PR comments", "analyze PR feedback", "fix PR comments", "address review feedback", or "prioritize PR feedback".
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# PR Comment Analyzer & Fixer

Analyze pull request comments, identify actionable issues, prioritize them, apply fixes, and reply to reviewers.

## Step 1: Find the PR

First, check if a PR exists for the current branch. If $ARGUMENTS contains a PR number, use that instead.

```bash
# If PR number provided as argument
gh pr view $ARGUMENTS --json number,title,url,state,reviewDecision,headRefName,baseRefName 2>/dev/null

# Otherwise, find PR for current branch
gh pr view --json number,title,url,state,reviewDecision,headRefName,baseRefName 2>/dev/null
```

If no PR is found, inform the user:
- Suggest pushing the branch: `git push -u origin $(git branch --show-current)`
- Suggest creating a PR: `gh pr create`
- Or ask them to specify a PR number: `/fix-pr-comments 123`

## Step 2: Collect All Comments

Fetch three types of comments:

### General PR Comments
```bash
gh pr view --json comments --jq '.comments[] | {id: .id, author: .author.login, body: .body, createdAt: .createdAt}'
```

### Inline Code Review Comments (with file/line info)
```bash
PR_NUM=$(gh pr view --json number -q .number)
gh api repos/{owner}/{repo}/pulls/$PR_NUM/comments --jq '.[] | {id: .id, author: .user.login, body: .body, path: .path, line: .line, original_line: .original_line, diff_hunk: .diff_hunk, createdAt: .created_at, in_reply_to_id: .in_reply_to_id}'
```

### Review Summaries
```bash
gh pr view --json reviews --jq '.reviews[] | {id: .id, author: .author.login, state: .state, body: .body, submittedAt: .submittedAt}'
```

### Changed Files (for context)
```bash
gh pr view --json files --jq '.files[] | {path: .path, additions: .additions, deletions: .deletions}'
```

## Step 3: Analyze and Classify Comments

For each comment, determine its category:

| Category | Indicators | Action Required |
|----------|------------|-----------------|
| **ACTION_REQUIRED** | "please change", "fix", "rename", "add", "remove", "update", "must", "should" | Yes |
| **BUG_REPORT** | "will fail", "crashes", "incorrect", "wrong", "broken", "bug", "error" | Yes |
| **SECURITY_CONCERN** | "vulnerability", "security", "injection", "exposed", "unsafe", "XSS", "CSRF" | Yes |
| **QUESTION** | Ends with "?", "curious", "wondering", "why did you" | Maybe - may need response |
| **SUGGESTION** | "consider", "could", "might want to", "optional", "idea" | Optional |
| **STYLE_PREFERENCE** | "I prefer", "I usually", "nit", "minor", "personal preference" | No |
| **PRAISE** | "great", "nice", "good job", "love this", "LGTM", "+1", "awesome" | No |

## Step 4: Assign Priority

| Priority | Criteria |
|----------|----------|
| **P1 - Critical** | Security vulnerabilities, bugs causing crashes/data loss, blocking reviews (CHANGES_REQUESTED with specific issue) |
| **P2 - Important** | Logic errors, missing error handling, unhandled edge cases, API contract violations, missing critical tests |
| **P3 - Moderate** | Code clarity improvements, better naming, documentation gaps, minor refactoring |
| **P4 - Low** | Style preferences (not violating standards), alternative approaches, nice-to-haves |

## Step 5: Present Analysis

Output the analysis in this format:

```
## PR Summary

**PR #[number]**: [title]
**URL**: [url]
**Status**: [state] | **Review Decision**: [reviewDecision]
**Total Comments**: [count] | **Actionable**: [count]

---

## P1 - Critical (Must Fix)

### 1. [Brief description]
- **File**: [path:line]
- **Reviewer**: @[author]
- **Category**: [category]
- **Comment**: "[comment excerpt...]"
- **Suggested Fix**: [what to do]

---

## P2 - Important (Should Fix)
[Same format]

---

## P3 - Moderate (Recommended)
[Same format]

---

## P4 - Low (Optional)
[Same format]

---

## Questions to Address
[List questions that need responses]

## Praise Received
[List positive feedback - nice for morale!]
```

## Step 6: Offer to Fix

After presenting the analysis, use the **AskUserQuestion** tool to ask what to fix:

```
Question: "Which issues would you like me to fix?"
Options:
- "Fix all P1 and P2" - Address all critical and important issues
- "Fix specific items" - Let user choose which items to fix
- "Skip fixes" - Just use the analysis, don't make changes
```

If user selects "Fix specific items", use AskUserQuestion again with multiSelect enabled listing each actionable item.

## Step 7: Apply Fixes

For each issue the user wants to fix:

1. Read the relevant file
2. Understand the context from the diff_hunk
3. Apply the fix based on the reviewer's feedback
4. Show the change to the user for confirmation

Group related fixes by file when possible to minimize commits.

## Step 8: Commit Changes

After fixes are applied:

```bash
git add -A
git commit -m "Address PR review feedback

- [List of addressed items]

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Step 9: Push to Remote

```bash
git push
```

## Step 10: Reply to Comments

For each comment that was addressed or intentionally skipped, post a reply:

### For Fixed Issues (inline review comments)
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="Fixed in [commit_sha]: [brief description of the fix]"
```

### For Fixed Issues (general PR comments)
```bash
gh api repos/{owner}/{repo}/issues/{pr}/comments \
  -f body="@[reviewer] Addressed: [brief description]"
```

### For Skipped Issues
If the user chose not to fix something, use **AskUserQuestion** to get the reason:

```
Question: "Why are you skipping this issue?"
Options:
- "Intentional design choice" - The current code is correct as-is
- "Will address in follow-up PR" - Deferring to separate PR
- "Disagree with feedback" - Provide explanation to reviewer
- "Other" - Custom reason
```

Then reply with the reason:
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="[Reason from user]"
```

### For Questions
Reply with the answer:
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="[Answer to the question]"
```

## Error Handling

### No PR Found
```
No pull request found for the current branch '[branch_name]'.

To analyze PR comments:
1. Push your branch: git push -u origin [branch_name]
2. Create a PR: gh pr create
3. Or specify a PR number: /fix-pr-comments 123
```

### No Comments Found
```
No comments found on PR #[number].

This could mean:
- The PR hasn't been reviewed yet
- All previous comments have been resolved
- Reviewers approved without inline feedback

Consider requesting a review: gh pr edit --add-reviewer [username]
```

### API Rate Limit
```
GitHub API rate limit reached. Please wait a few minutes and try again.
You can check your rate limit status: gh api rate_limit
```

## Notes

- Always preserve the comment IDs when collecting comments - needed for replies
- Filter out your own comments and bot comments from analysis
- Skip comments that are replies (have in_reply_to_id) to avoid duplicate analysis
- When fixing, read enough context around the line to make correct changes
- If a fix is ambiguous, use **AskUserQuestion** to clarify the approach before applying
