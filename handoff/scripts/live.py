#!/usr/bin/env python3
"""handoff live-mode hooks.

Registered from SKILL.md frontmatter, so they exist only in sessions that
invoked /handoff. Each one is a no-op until this session has written a brief
(the `bind` event records which one); after that they keep the brief current:

  bind     PostToolUse Write|Edit   record session -> brief, commit the edit locally,
                                    warn on a second live session
  commit   PostToolUse git commit   remind to update the brief
  stop     Stop                     one nudge per stale stretch when the repo has moved
  compact  SessionStart compact     re-inject the brief after compaction
  end      SessionEnd               push the handoffs repo's unpushed commits

Every edit is committed locally right away, so the handoffs working tree stays
clean even with several live sessions: pulls need no stash, and a later push
carries anything an earlier one failed to send.

Every path exits 0: a hook error on Stop would otherwise keep the turn going.
"""
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(os.environ.get("HANDOFF_ROOT", "~/.claude/handoffs")).expanduser()
STATE = pathlib.Path(os.environ.get("HANDOFF_LIVE_STATE", "~/.claude/handoff-live")).expanduser()
STALE_MIN = float(os.environ.get("HANDOFF_LIVE_STALE_MIN", "20"))
CONCURRENT_H = 6  # another session's binding counts as live for this long
EXPIRE_DAYS = 7  # bindings from sessions that never fired SessionEnd (crash, kill)
COMPACT_MAX_LINES = 150
END_BUDGET_S = 25  # SessionEnd hook timeout is 30


def emit(event: str, context: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": context}}))


def git(cwd, *args, timeout=10):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=timeout)


def state_file(session_id: str) -> pathlib.Path:
    return STATE / f"{session_id}.json"


def load(session_id: str):
    try:
        st = json.loads(state_file(session_id).read_text())
    except (OSError, ValueError):
        return None
    brief = pathlib.Path(st.get("brief", ""))
    return (st, brief) if brief.is_file() else None


def save(session_id: str, st: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = state_file(session_id).with_suffix(".tmp")
    tmp.write_text(json.dumps(st))
    tmp.replace(state_file(session_id))


def commit_brief(brief: pathlib.Path, why: str) -> bool:
    """Commit only this brief, locally. True when nothing is left uncommitted."""
    repo = brief.parent
    if not git(repo, "status", "--porcelain", "--", str(brief)).stdout.strip():
        return True
    name = brief.relative_to(ROOT.resolve()).with_suffix("")
    for attempt in range(3):  # another session may hold index.lock for a moment
        git(repo, "add", "--", str(brief))
        if git(repo, "commit", "-q", "-m", f"handoff: {name} ({why})", "--", str(brief)).returncode == 0:
            return True
        time.sleep(0.3 * (attempt + 1))
    return False


def on_bind(inp: dict) -> None:
    path = (inp.get("tool_input") or {}).get("file_path")
    if not path:
        return
    brief = pathlib.Path(path).expanduser().resolve()
    try:
        rel = brief.relative_to(ROOT.resolve())
    except ValueError:
        return
    if brief.suffix != ".md" or len(rel.parts) != 2:  # only <repo>/<slug>.md
        return
    sid = inp["session_id"]
    prev = load(sid)
    st = prev[0] if prev and str(prev[1]) == str(brief) else {}
    st["brief"] = str(brief)
    warned = set(st.get("warned", []))

    others = []
    now = time.time()
    for f in STATE.glob("*.json") if STATE.is_dir() else []:
        try:
            age = now - f.stat().st_mtime
            if age > EXPIRE_DAYS * 86400:
                f.unlink(missing_ok=True)
                continue
            if f.stem == sid or f.stem in warned or age > CONCURRENT_H * 3600:
                continue
            if json.loads(f.read_text()).get("brief") == str(brief):
                others.append(f.stem)
        except (OSError, ValueError):
            pass
    st["warned"] = sorted(warned | set(others))
    save(sid, st)
    committed = commit_brief(brief, "live")

    notes = []
    if others:
        notes.append(f"Session(s) {', '.join(others)} on this machine also wrote {brief} in the last {CONCURRENT_H}h "
                     "(possibly one that has since crashed). Two live sessions on one brief overwrite each other. "
                     "Ask the user; if both are running, continue in `<slug>-2.md`, created with Write so this "
                     "session's hooks follow it.")
    if not committed:
        notes.append(f"Could not commit {brief} in the handoffs repo; check `git status` there.")
    if notes:
        emit("PostToolUse", "Live handoff: " + " ".join(notes))


def on_commit(inp: dict) -> None:
    if not (cur := load(inp["session_id"])):
        return
    emit("PostToolUse", f"Live handoff: you just committed. If this changes State, Verification or Next steps in "
         f"{cur[1]}, update those lines now with a small Edit (and the Updated line).")


def changed_paths(cwd: str):
    out = git(cwd, "status", "--porcelain", "-z", "-uall").stdout.split("\0")
    i = 0
    while i < len(out):
        entry = out[i]
        if len(entry) > 3:
            yield entry[3:]
            if entry[0] in "RC":
                i += 1  # skip the rename source
        i += 1


def repo_moved_since(cwd: str, since: float) -> bool:
    try:
        if git(cwd, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
            return False
        head = git(cwd, "log", "-1", "--format=%ct").stdout.strip()
        if head and float(head) > since:
            return True
        top = git(cwd, "rev-parse", "--show-toplevel").stdout.strip()
        for rel in changed_paths(cwd):
            p = pathlib.Path(top, rel)
            if p.is_file() and p.stat().st_mtime > since:
                return True
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return False


def on_stop(inp: dict) -> None:
    if inp.get("stop_hook_active"):
        return
    sid = inp["session_id"]
    if not (cur := load(sid)):
        return
    st, brief = cur
    now = time.time()
    mtime = brief.stat().st_mtime
    # One nudge per stale stretch: wait for the brief to change before nudging again.
    if now - mtime < STALE_MIN * 60 or st.get("nudged_mtime") == mtime:
        return
    if not repo_moved_since(inp.get("cwd", "."), mtime):
        return
    st["nudged_mtime"] = mtime
    save(sid, st)
    mins = int((now - mtime) // 60)
    emit("Stop", f"Live handoff: {brief} was last updated {mins} min ago and the repo has moved since. "
         "Bring State, Dead ends, Verification and Next steps up to date with small Edits, then stop. "
         "If nothing in it is out of date, say so in one line and stop.")


def on_compact(inp: dict) -> None:
    if not (cur := load(inp["session_id"])):
        return
    lines = cur[1].read_text().splitlines()
    body = "\n".join(lines[:COMPACT_MAX_LINES]) + ("\n[…truncated]" if len(lines) > COMPACT_MAX_LINES else "")
    emit("SessionStart", f"Live handoff is on for this session. The brief at {cur[1]} is below; where it and the "
         f"compaction summary disagree, trust the brief, and keep it updated as you work.\n\n{body}")


def on_end(inp: dict) -> None:
    sid = inp["session_id"]
    cur = load(sid)
    state_file(sid).unlink(missing_ok=True)
    if not cur:
        return
    brief = cur[1]
    repo = brief.parent
    deadline = time.monotonic() + END_BUDGET_S

    def left() -> float:
        r = deadline - time.monotonic()
        if r < 1:
            raise subprocess.TimeoutExpired("git", END_BUDGET_S)
        return r

    try:
        if not commit_brief(brief, "session end"):
            print(f"handoff: could not commit {brief}; push it by hand", file=sys.stderr)
            return
        gitdir = pathlib.Path(git(repo, "rev-parse", "--absolute-git-dir").stdout.strip())
        if (gitdir / "rebase-merge").exists() or (gitdir / "rebase-apply").exists():
            print(f"handoff: {repo} is mid-rebase; not pushing", file=sys.stderr)
            return
        if git(repo, "status", "--porcelain", "--untracked-files=no").stdout.strip():
            # Another session's edit is uncommitted; a rebase would refuse or need a stash.
            print(f"handoff: {repo} has uncommitted changes; brief committed locally, not pushed", file=sys.stderr)
            return
        if git(repo, "pull", "--rebase", "--no-autostash", timeout=left()).returncode != 0:
            git(repo, "rebase", "--abort", timeout=max(left(), 1))
            print(f"handoff: pull failed in {repo}; brief committed locally, push it by hand", file=sys.stderr)
            return
        if git(repo, "push", timeout=left()).returncode != 0:
            print(f"handoff: push failed in {repo}; brief committed locally, push it by hand", file=sys.stderr)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print(f"handoff: could not sync {brief}: {e}", file=sys.stderr)


HANDLERS = {"bind": on_bind, "commit": on_commit, "stop": on_stop, "compact": on_compact, "end": on_end}

if __name__ == "__main__":
    try:
        HANDLERS[sys.argv[1]](json.load(sys.stdin))
    except Exception as e:  # never let a hook failure block or continue a turn
        print(f"handoff live hook ({sys.argv[1:]}) failed: {e}", file=sys.stderr)
    sys.exit(0)
