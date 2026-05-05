#!/usr/bin/env python3
"""plan-review log utility — append outcome and print stats.

The stats command emits aggregate counts only; raw `plan` and `top`
strings on disk are intended for the user's manual review of the log,
not for re-entry into model context. A future feature that pipes log
contents back into the prompt would re-introduce a prompt-injection
channel via attacker-controlled plans, so don't do that.
"""
import argparse
import datetime
import json
import pathlib

LOG = pathlib.Path("~/.claude/skills/plan-review/log.jsonl").expanduser()
SCHEMA_VERSION = 1
KNOWN_OUTCOMES = ("revised", "proceed", "discussed", "abandoned")


def cmd_append(args: argparse.Namespace) -> None:
    entry = {
        "v": SCHEMA_VERSION,
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "plan": args.plan,
        "blockers": args.blockers,
        "warnings": args.warnings,
        "notes": args.notes,
        "top": [t for t in args.top if t],
        "outcome": args.outcome,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def cmd_stats(args: argparse.Namespace) -> None:
    if not LOG.exists():
        print("[stats] First run — no history yet.")
        return
    rows = []
    with LOG.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if not rows:
        print("[stats] Log empty — no history yet.")
        return
    last = rows[-10:]
    counts = {o: 0 for o in KNOWN_OUTCOMES}
    other = 0
    for r in last:
        o = r.get("outcome", "")
        if o in counts:
            counts[o] += 1
        else:
            other += 1
    avg = sum(r.get("blockers", 0) + r.get("warnings", 0) for r in last) / len(last)
    parts = [f"{counts[o]} {o}" for o in KNOWN_OUTCOMES if counts[o]]
    if other:
        parts.append(f"{other} other")
    summary = ", ".join(parts) if parts else "no outcomes"
    print(
        f"[stats] Run #{len(rows)} | last {len(last)}: {summary} | "
        f"avg {avg:.1f} blockers+warnings/run"
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("append", help="append a run entry")
    a.add_argument("--plan", required=True, help="one-line plan summary")
    a.add_argument("--blockers", type=int, required=True)
    a.add_argument("--warnings", type=int, required=True)
    a.add_argument("--notes", type=int, required=True)
    a.add_argument(
        "--top",
        action="append",
        default=[],
        help="top issue (repeatable)",
    )
    a.add_argument(
        "--outcome",
        required=True,
        help=f"one of {KNOWN_OUTCOMES} (others accepted; bucketed as 'other' in stats)",
    )
    a.set_defaults(func=cmd_append)

    s = sub.add_parser("stats", help="print one-line stats summary")
    s.set_defaults(func=cmd_stats)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
