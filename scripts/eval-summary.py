#!/usr/bin/env python3
"""Keeps eval scores between releases: evals/results/ is git-ignored, eval-history/ is tracked.

  python3 scripts/eval-summary.py [--out-dir DIR] evals/results/<run>/aggregate-result.json...
      Merges the runs of one plugin version into DIR/<version>.json (default: eval-history/ at the
      repository root): plugin version, agent model, judge model and, per case, the with-plugin score,
      the baseline score and their delta. Baseline and delta are null for a run without a baseline arm.
      When a case is in several runs, the run that started last wins. A case whose with-plugin runs all
      ended in an error is skipped and named on stderr: it has no score, only a 0.
  python3 scripts/eval-summary.py --diff OLD.json NEW.json
      Prints each case whose with-plugin score fell by more than 0.1 from OLD to NEW and exits 1;
      exits 0 when there is none.

Exit 2: a usage error, an unreadable file, runs or summaries of different versions or models (a score
from another agent or judge model is not comparable), or no scored case. It reads result files only;
it never runs an eval (D13). Standard library only.
"""
import json
import os
import re
import sys

DROP = 0.1


class Refuse(Exception):
    pass


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise Refuse("%s: %s" % (path, e))
    if not isinstance(data, dict):
        raise Refuse("%s: not a JSON object" % path)
    return data


def number(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def run_key(path, data):
    """(version, agent model, judge model) of one aggregate-result.json."""
    suite = data.get("suite")
    if not isinstance(suite, dict) or not isinstance(data.get("cases"), list):
        raise Refuse("%s: no suite or cases; not an aggregate-result.json" % path)
    plugins = [p for p in suite.get("plugins") or [] if isinstance(p, dict)]
    named = [p for p in plugins if p.get("name") == "developer-os"] or plugins
    version = str(named[0].get("version", "")) if len(named) == 1 else ""
    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,31}", version):
        raise Refuse("%s: no single plugin version in suite.plugins" % path)
    agent, judge = suite.get("modelOverride"), suite.get("judgeModel")
    if not (isinstance(agent, str) and agent and isinstance(judge, str) and judge):
        raise Refuse("%s: suite.modelOverride or suite.judgeModel is missing; run the suite with both pinned" % path)
    return version, agent, judge


def summarize(paths, out_dir):
    runs = []
    for path in paths:
        data = load(path)
        runs.append((str(data.get("startedAt", "")), path, run_key(path, data), data))
    keys = sorted({r[2] for r in runs})
    if len(keys) > 1:
        raise Refuse("runs differ in plugin version, agent model or judge model: "
                     + "; ".join("%s %s %s" % k for k in keys))
    version, agent, judge = keys[0]
    runs.sort(key=lambda r: r[:2])
    cases = {}
    for started, path, _, data in runs:
        if data.get("partial") is True:
            sys.stderr.write("warning: run %s is partial\n" % started)
        for case in data["cases"]:
            if not isinstance(case, dict) or not isinstance(case.get("name"), str):
                continue
            name = case["name"]
            agg = case.get("aggregates") if isinstance(case.get("aggregates"), dict) else {}
            arms = case.get("arms") if isinstance(case.get("arms"), dict) else {}
            with_runs = [a for a in arms.get("with") or [] if isinstance(a, dict)]
            score = number(agg.get("score"))
            if score is None or not with_runs or all(a.get("error") for a in with_runs):
                sys.stderr.write("skipped %s in run %s: no score, or an error in every with-plugin run\n" % (name, started))
                continue
            baseline = number(agg.get("scoreWithout"))
            delta = number(agg.get("delta"))
            if baseline is not None and delta is None:
                delta = round(score - baseline, 6)
            cases[name] = {"with": score, "baseline": baseline, "delta": delta if baseline is not None else None}
    if not cases:
        raise Refuse("no scored case in %d run%s" % (len(runs), "" if len(runs) == 1 else "s"))
    summary = {"version": version, "agentModel": agent, "judgeModel": judge,
               "runs": [r[0] for r in runs], "cases": {k: cases[k] for k in sorted(cases)}}
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, version + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
    print(out)
    return 0


def read_summary(path):
    data = load(path)
    cases = data.get("cases")
    if not isinstance(cases, dict) or not all(isinstance(data.get(k), str) for k in ("version", "agentModel", "judgeModel")):
        raise Refuse("%s: not a summary written by this script" % path)
    return data, {k: number(v.get("with")) for k, v in cases.items() if isinstance(v, dict)}


def diff(old_path, new_path):
    old, old_cases = read_summary(old_path)
    new, new_cases = read_summary(new_path)
    for key, label in (("agentModel", "agent"), ("judgeModel", "judge")):
        if old[key] != new[key]:
            raise Refuse("%s model differs (%s, %s): the scores are not comparable" % (label, old[key], new[key]))
    fell = 0
    for name in sorted(set(old_cases) | set(new_cases)):
        a, b = old_cases.get(name), new_cases.get(name)
        if a is None or b is None:
            print("%s: not in %s" % (name, (old if a is None else new)["version"]))
            # A case that errored or was dropped in the new run must not look like a pass.
            fell += b is None
            continue
        # Rounded first: 0.4 - 0.3 is 0.10000000000000003 in floats, and a fall of exactly 0.1 is allowed.
        drop = round(a - b, 6)
        if drop > DROP:
            fell += 1
            print("%s %g -> %g (-%g)" % (name, a, b, drop))
    print("%s to %s: %d case%s fell by more than %g or left the summary"
          % (old["version"], new["version"], fell, "" if fell == 1 else "s", DROP))
    return 1 if fell else 0


def main(argv):
    if argv[:1] == ["--diff"]:
        if len(argv) != 3:
            raise Refuse("usage: eval-summary.py --diff OLD.json NEW.json")
        return diff(argv[1], argv[2])
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "eval-history")
    if argv[:1] == ["--out-dir"]:
        if len(argv) < 2:
            raise Refuse("usage: eval-summary.py [--out-dir DIR] aggregate-result.json...")
        out_dir, argv = argv[1], argv[2:]
    if not argv or any(a.startswith("--") for a in argv):
        raise Refuse("usage: eval-summary.py [--out-dir DIR] aggregate-result.json... | --diff OLD.json NEW.json")
    return summarize(argv, out_dir)


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
    except Refuse as e:
        sys.stderr.write("eval-summary: %s\n" % e)
        code = 2
    sys.exit(code)
