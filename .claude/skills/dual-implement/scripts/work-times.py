#!/usr/bin/env python3
"""1つの Issue の作業ごとの開始・終了・所要を、Markdown の表で出す（finish-issue が Issue レポートに貼る）。

  python3 .claude/skills/dual-implement/scripts/work-times.py <Issue番号> <Run ID>

読むもの（どれも読むだけ）:
  - Orca の Run: ワーカーごとの起動・完了の時刻と、ワーカーが送った「作業: <名前>」の status
  - dev-team.sh mark の記録: 開発チームと PO の作業の区切り（.git/work-times/<Issue番号>.tsv）
  - GitHub: Issue の PR の CI の各ジョブの開始・終了

区切りは「ここから <名前> を始めた」という印だけを残し、次の印（または完了）までをその作業の時間とする。
名前が「待ち」「終了」の区間は作業に数えない（人間・ワーカー・PO を待っている時間）。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
IDLE = {"待ち", "終了"}


def run(cmd):
    return subprocess.check_output(cmd, text=True)


def orca(*args):
    if os.environ.get("ORCA_CLI_BIN_DIR"):
        exe = os.path.join(os.environ["ORCA_CLI_BIN_DIR"], "orca")
    elif os.path.exists("/Applications/Orca.app/Contents/Resources/bin/orca"):
        exe = "/Applications/Orca.app/Contents/Resources/bin/orca"
    else:
        exe = "orca"
    return json.loads(run([exe, *args, "--json"]))["result"]


def ts(s):
    # Orca は「2026-10-23 12:52:47」（UTC、Z なし）と ISO の両方を返す
    s = s.replace(" ", "T")
    if not s.endswith("Z") and "+" not in s[10:]:
        s += "Z"
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fmt(t):
    return t.astimezone(JST).strftime("%m-%d %H:%M") if t else "記録なし"


def dur(a, b):
    if not (a and b):
        return "—"
    m = round((b - a).total_seconds() / 60)
    return f"{m // 60}時間{m % 60}分" if m >= 60 else f"{m}分"


def segments(marks, who, last_end=None):
    """marks: [(時刻, 作業名)] を、次の印までの区間にする"""
    marks = sorted(marks)
    rows = []
    for i, (t, name) in enumerate(marks):
        if name in IDLE:
            continue
        end = marks[i + 1][0] if i + 1 < len(marks) else last_end
        rows.append((t, end, name, who))
    return rows


def main():
    n, run_id = sys.argv[1], sys.argv[2]
    rows = []  # (開始, 終了, 作業, 担当)

    # ワーカー: 起動から完了まで + 中の「作業:」の印
    tasks = {t["id"]: t for t in orca("orchestration", "task-list", "--run", run_id)["tasks"]}
    workers = [w for w in orca("orchestration", "worker-list")["workers"] if w["runId"] == run_id]
    messages = [m for m in orca("orchestration", "inbox", "--limit", "1000")["messages"] if m["run_id"] == run_id]
    for w in workers:
        d = orca("orchestration", "worker-show", "--dispatch", w["dispatchId"])
        start = ts(d["dispatch"]["createdAt"])
        end = ts(d["dispatch"]["completedAt"]) if d["dispatch"].get("completedAt") else None
        task = tasks.get(w["taskId"], {})
        title = task.get("task_title") or task.get("display_name") or w["dispatchId"]
        launch = d["worker"]["startOptions"]["launch"]["effective"]
        who = f"{title}（{launch.get('model') or '既定'}・{launch.get('effort') or '既定'}）"
        rows.append((start, end, "（ワーカー全体）", who))
        marks = [(ts(m["created_at"]), m["subject"].split(":", 1)[1].strip())
                 for m in messages
                 if m["type"] == "status" and m["from_handle"] == w["agentTerminalHandle"]
                 and m["subject"].startswith("作業:")]
        if marks:
            rows += segments([(start, "（印の前）")] + marks, who, end)

    # 開発チームと PO: dev-team.sh mark の記録
    common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).strip()
    path = os.path.join(os.environ.get("DEV_TEAM_STATE_DIR", common), "work-times", f"{n}.tsv")
    if os.path.exists(path):
        by_who = {}
        for line in open(path, encoding="utf-8"):
            t, who, name = line.rstrip("\n").split("\t")
            by_who.setdefault(who, []).append((ts(t), name))
        for who, marks in by_who.items():
            rows += segments(marks, who)

    # CI: この Issue の PR のブランチで動いた各ジョブ
    prs = json.loads(run(["gh", "pr", "list", "--state", "all", "--limit", "100",
                          "--json", "number,headRefName"]))
    for pr in prs:
        if f"issue-{n}-" not in pr["headRefName"]:
            continue
        for r in json.loads(run(["gh", "run", "list", "--branch", pr["headRefName"], "--limit", "20",
                                 "--json", "databaseId,headSha"])):
            for j in json.loads(run(["gh", "run", "view", str(r["databaseId"]), "--json", "jobs"]))["jobs"]:
                if j.get("startedAt") and j.get("completedAt"):
                    rows.append((ts(j["startedAt"]), ts(j["completedAt"]),
                                 f"CI: {j['name']}（{j.get('conclusion')}）",
                                 f"PR #{pr['number']}（{r['headSha'][:7]}）"))

    rows.sort(key=lambda r: (r[0], r[3]))
    print("| 開始 | 終了 | 所要 | 担当 | 作業 |")
    print("|---|---|---|---|---|")
    for a, b, name, who in rows:
        print(f"| {fmt(a)} | {fmt(b)} | {dur(a, b)} | {who} | {name} |")
    if rows:
        first = min(r[0] for r in rows)
        last = max(r[1] for r in rows if r[1])
        print(f"\n最初の開始から最後の終了まで: {dur(first, last)}（JST。待ちを含む）")


if __name__ == "__main__":
    main()
