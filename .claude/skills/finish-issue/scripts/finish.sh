#!/usr/bin/env bash
# finish-issue の機械的な操作をまとめたスクリプト。
# 判断（何を消すか・人間の確認）は SKILL.md 側で済ませてから呼ぶ。
# リポジトリのルート（main の worktree）で実行する。
#
#   finish.sh merge <PR番号> <確認済みの head SHA>
#   finish.sh close-pr <PR番号> <理由>
#   finish.sh docker-down <Compose のプロジェクト名>
#   finish.sh remove-worktree <worktree の絶対パス>
#   finish.sh delete-branch <ブランチ名> [--remote-required]
#   finish.sh sync-main
set -euo pipefail

die() { echo "エラー: $*" >&2; exit 1; }

repo_root=$(git rev-parse --show-toplevel)
main_worktree=$(git worktree list --porcelain | awk 'NR==1 && $1=="worktree" {print $2}')

cmd=${1:-}
shift || true

case "$cmd" in
  merge)
    pr=${1:?PR番号}; sha=${2:?head SHA}
    gh pr merge "$pr" --squash --delete-branch --match-head-commit "$sha"
    echo "マージしました: PR #${pr} (${sha})"
    ;;

  close-pr)
    pr=${1:?PR番号}; reason=${2:?理由}
    # リモートのブランチは残す（--delete-branch を付けない）
    gh pr close "$pr" --comment "$reason"
    echo "閉じました: PR #$pr"
    ;;

  docker-down)
    project=${1:?プロジェクト名}
    command -v docker >/dev/null || { echo "docker が無いので省略"; exit 0; }
    containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
    if [ -n "$containers" ]; then docker rm -f $containers >/dev/null; fi
    volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$project")
    if [ -n "$volumes" ]; then docker volume rm $volumes >/dev/null; fi
    networks=$(docker network ls -q --filter "label=com.docker.compose.project=$project")
    if [ -n "$networks" ]; then docker network rm $networks >/dev/null; fi
    echo "Docker を片付けました: ${project}（コンテナ $(echo $containers | wc -w | tr -d ' ') / ボリューム $(echo $volumes | wc -w | tr -d ' ')）"
    ;;

  remove-worktree)
    path=${1:?worktree のパス}
    [ "$path" != "$main_worktree" ] && [ "$path" != "$repo_root" ] || die "main の worktree は消さない: $path"
    git worktree list --porcelain | grep -qx "worktree $path" || die "worktree として登録されていない: $path"
    # 未コミットの変更（無視されたファイルは除く）があれば止める
    if [ -n "$(git -C "$path" status --porcelain)" ]; then
      git -C "$path" status -s >&2
      die "未コミットの変更があるので消さない: $path"
    fi
    orca worktree rm --worktree "path:$path" --json >/dev/null
    for _ in $(seq 1 30); do
      git worktree list --porcelain | grep -qx "worktree $path" || { echo "worktree を消しました: $path"; exit 0; }
      sleep 1
    done
    die "30秒待っても worktree が消えない: $path"
    ;;

  delete-branch)
    branch=${1:?ブランチ名}; mode=${2:-}
    git show-ref --verify --quiet "refs/heads/$branch" || { echo "ローカルに無い（消し済み）: $branch"; exit 0; }
    if [ "$mode" = "--remote-required" ]; then
      git ls-remote --exit-code --heads origin "$branch" >/dev/null || die "リモートに無いので消さない: $branch"
    fi
    git branch -D "$branch"
    ;;

  sync-main)
    git -C "$main_worktree" checkout main
    git -C "$main_worktree" pull --ff-only
    ;;

  *)
    sed -n '2,12p' "$0" >&2
    exit 2
    ;;
esac
