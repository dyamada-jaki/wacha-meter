#!/usr/bin/env bash
# 開発チームの起動と、PO・開発チームの端末の見つけ方をまとめたスクリプト。
# 値は CLAUDE.md / AGENTS.md の「開発設定」と合わせる。リポジトリのどの worktree で実行してもよい。
#
#   dev-team.sh precheck                    「開発可」の Issue があり、「着手中」も動いている開発チームも無ければ 0 で終わる
#   dev-team.sh launch [--agent claude|codex]
#                                           「開発可」で番号のいちばん小さい Issue を「着手中」に替え、
#                                           main の worktree に開発チームの端末を開いて dual-implement を送る（起動係が使う）
#   dev-team.sh claim <Issue番号>           この端末を Issue の開発チームとして登録する（dual-implement の最初に呼ぶ）
#   dev-team.sh release <Issue番号>         開発チームを終える（「着手中」を外し、登録を消す）
#   dev-team.sh close-self                  この端末を閉じる（finish-issue の最後の操作。release の後でないと断る）
#   dev-team.sh po-register                 この端末を PO として登録する（PO を開いたときに呼ぶ）
#   dev-team.sh po-find                     PO の端末の handle とエージェントの種類を出す。PO がいなければ 1 で終わる
#   dev-team.sh mark <Issue番号> <担当> <作業>
#                                           作業の区切りを記録する（ここから <作業> を始めた）。待つ間は「待ち」、終えたら「終了」。
#                                           集計は work-times.py（finish-issue が Issue レポートに貼る）
#   dev-team.sh doctor                      準備がそろっているかを項目ごとに確かめる。足りない項目があれば 1 で終わる（setup-project が使う）
#
# 端末の題名はエージェントが書き換えるので、端末は Git の管理外に置いた handle のファイルで見つける。
# ファイルに書いた端末が閉じていれば、いないとみなす。
#
# 試験のときだけ、次の環境変数で差し替えられる:
#   DEV_TEAM_LABEL_READY / DEV_TEAM_LABEL_BUSY  ラベル名
#   DEV_TEAM_COMMAND                           端末で起動するコマンド
#   DEV_TEAM_PROMPT                            起動後に送る指示（{N} を Issue 番号に置き換える）
#   DEV_TEAM_STATE_DIR                         登録のファイルを置く場所（既定は .git）
# 試験は dev-team.test.sh（orca と gh を偽物に差し替えて、起動の失敗と生存確認の扱いを確かめる）
set -euo pipefail

die() { echo "エラー: $*" >&2; exit 1; }

label_ready=${DEV_TEAM_LABEL_READY:-開発可}
label_busy=${DEV_TEAM_LABEL_BUSY:-着手中}
# Orca の定期実行の precheck では ORCA_CLI_BIN_DIR が無く、PATH の orca が壊れたリンクのことがあるので、Orca.app の中を優先する
if [ -n "${ORCA_CLI_BIN_DIR:-}" ]; then orca_bin="${ORCA_CLI_BIN_DIR}/orca"
elif [ -x /Applications/Orca.app/Contents/Resources/bin/orca ]; then orca_bin=/Applications/Orca.app/Contents/Resources/bin/orca
else orca_bin=orca; fi
main_worktree=$(git worktree list --porcelain | awk 'NR==1 && $1=="worktree" {print $2}')
state_dir=${DEV_TEAM_STATE_DIR:-$(git rev-parse --path-format=absolute --git-common-dir)}
team_file="${state_dir}/dev-team.lock"   # 中身: <Issue番号> <handle>（端末を開く前は handle の代わりに launching）
po_file="${state_dir}/po.handle"         # 中身: <handle>
times_dir="${state_dir}/work-times"       # <Issue番号>.tsv。1行に <UTC の時刻> <担当> <作業>（タブ区切り）

# ラベルの付いた開いている Issue の番号（小さい順）。gh issue list は検索を使い反映が遅れるので、REST で引く。
# それでも付け替えの直後は古い結果を返すことがあるので、二重起動は team_file でも防ぐ
numbers() {
  gh api -X GET 'repos/{owner}/{repo}/issues' -f labels="$1" -f state=open -f per_page=100 \
    -q '[.[] | select(.pull_request | not) | .number] | sort | .[]'
}
count() { numbers "$1" | wc -l | tr -d ' '; }

# 端末が開いていれば、エージェントの種類（claude / codex。不明なら unknown）を出して 0 で終わる。
# 閉じていると確かめられたとき（端末が無い・つながっていない）だけ 1、
# それ以外のエラー（orca が動かない、別の理由で照会に失敗したなど）は 2 で終わる
alive() {
  local out
  out=$("$orca_bin" terminal show --terminal "$1" --json 2>/dev/null) || true
  printf '%s' "$out" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(2)
if d.get("ok") is False:
    sys.exit(1 if (d.get("error") or {}).get("code") == "terminal_handle_stale" else 2)
t = (d.get("result") or {}).get("terminal")
if not t:
    sys.exit(2)
if not t.get("connected"):
    sys.exit(1)
print(t.get("agentIdentity") or "unknown")'
}
# 閉じていると確かめられたときだけ 0。確かめられないとき・起動の途中で止まったときは、二重起動を避けるため「動いている」とみなす
teams() {
  [ -f "$team_file" ] || { echo 0; return; }
  local handle status=0
  handle=$(awk '{print $2}' "$team_file")
  [ "$handle" = launching ] && { echo 1; return; }
  alive "$handle" >/dev/null || status=$?
  if [ "$status" -eq 1 ]; then echo 0; else echo 1; fi
}
own_handle() { [ -n "${ORCA_TERMINAL_HANDLE:-}" ] || die "Orca の端末の中で実行する（ORCA_TERMINAL_HANDLE が無い）"; echo "$ORCA_TERMINAL_HANDLE"; }

cmd=${1:-}
shift || true

case "$cmd" in
  precheck)
    ready=$(count "$label_ready"); busy=$(count "$label_busy"); open_teams=$(teams)
    echo "${label_ready}: ${ready} / ${label_busy}: ${busy} / 動いている開発チーム: ${open_teams}"
    [ "$ready" -ge 1 ] && [ "$busy" -eq 0 ] && [ "$open_teams" -eq 0 ]
    ;;

  launch)
    agent=claude
    [ "${1:-}" = "--agent" ] && agent=${2:?claude か codex}
    case "$agent" in
      claude) default_command="claude --model opus --effort high"; default_prompt='/dual-implement {N}' ;;
      codex)  default_command="codex"; default_prompt='$dual-implement {N}' ;;
      *) die "--agent は claude か codex: $agent" ;;
    esac
    command=${DEV_TEAM_COMMAND:-$default_command}
    prompt_template=${DEV_TEAM_PROMPT:-$default_prompt}

    # 定期実行の間に状況が変わっていることがあるので、もう一度確かめる
    [ "$(teams)" -eq 0 ] || die "開発チームが動いているので起動しない（$(cat "$team_file")）"
    [ "$(count "$label_busy")" -eq 0 ] || die "「${label_busy}」の Issue があるので起動しない"
    n=$(numbers "$label_ready" | head -n 1)
    [ -n "$n" ] || { echo "「${label_ready}」の Issue が無い"; exit 0; }
    gh issue view "$n" --json labels -q '.labels[].name' | grep -qx "$label_ready" \
      || die "Issue #${n} に「${label_ready}」が付いていない（一覧が古い）"

    # 先に登録とラベルを替えて、次の定期実行で二重に起動しないようにする
    echo "$n launching" > "$team_file"
    gh issue edit "$n" --remove-label "$label_ready" --add-label "$label_busy" >/dev/null \
      || { rm -f "$team_file"; die "Issue #${n} のラベルを替えられなかった（起動していない）"; }
    echo "Issue #${n} を「${label_busy}」にしました"

    # ここから先の失敗では、端末が開いて指示が届いている場合があるので、登録とラベルを戻さずに止める
    hold() {
      die "$1。二重に起動しないよう、Issue #${n} は「${label_busy}」のまま、登録（${team_file}）も残した。
人間が端末の様子を確かめ、やり直すなら端末を閉じてから dev-team.sh release ${n} を実行し、「${label_ready}」を付け直す"
    }

    handle=$("$orca_bin" terminal create --worktree "path:${main_worktree}" --title "開発チーム #${n}" \
      --command "$command" --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["terminal"]["handle"])') \
      || hold "端末を開けたか確かめられなかった"
    echo "$n $handle" > "$team_file"

    # エージェントが入力を受け付けるまで待つ（シェルの段階で送ると、指示がシェルに渡ってしまう）
    for _ in $(seq 1 60); do
      [ "$(alive "$handle" || echo closed)" != "unknown" ] && break
      sleep 2
    done
    "$orca_bin" terminal wait --terminal "$handle" --for tui-idle --timeout-ms 120000 --json >/dev/null \
      || hold "エージェントが起動したか確かめられなかった（端末 ${handle}）"

    prompt=${prompt_template//\{N\}/$n}
    "$orca_bin" terminal send --terminal "$handle" --text "$prompt" --enter --wait-submit 15 --json >/dev/null \
      || hold "指示が届いたか確かめられなかった（端末 ${handle}）"
    echo "開発チームを起動しました: Issue #${n} / 端末 ${handle} / 指示「${prompt}」"
    ;;

  claim)
    n=${1:?Issue番号}
    handle=$(own_handle)
    if [ -f "$team_file" ] && [ "$(awk '{print $2}' "$team_file")" != "$handle" ] && [ "$(teams)" -eq 1 ]; then
      die "別の開発チームが動いている（$(cat "$team_file")）"
    fi
    echo "$n $handle" > "$team_file"
    gh issue edit "$n" --remove-label "$label_ready" --add-label "$label_busy" >/dev/null 2>&1 \
      || gh issue edit "$n" --add-label "$label_busy" >/dev/null
    echo "開発チームとして登録しました: Issue #${n} / 端末 ${handle}（「${label_busy}」）"
    ;;

  release)
    n=${1:?Issue番号}
    gh issue edit "$n" --remove-label "$label_busy" >/dev/null 2>&1 || true
    if [ -f "$team_file" ] && [ "$(awk '{print $1}' "$team_file")" = "$n" ]; then rm -f "$team_file"; fi
    echo "開発チームを終えました: Issue #${n}（「${label_busy}」を外し、登録を消しました）"
    ;;

  close-self)
    handle=$(own_handle)
    if [ -f "$team_file" ] && [ "$(awk '{print $2}' "$team_file")" = "$handle" ]; then
      die "この端末はまだ開発チームとして登録されている。先に dev-team.sh release <Issue番号> を実行する"
    fi
    [ -f "$po_file" ] && [ "$(cat "$po_file")" = "$handle" ] && die "この端末は PO として登録されているので閉じない"
    echo "この端末を閉じます: ${handle}"
    # 閉じるとこのスクリプトを動かしているエージェントも止まるので、これが最後の出力になる
    "$orca_bin" terminal close --terminal "$handle" --json >/dev/null
    ;;

  mark)
    n=${1:?Issue番号}; who=${2:?担当}; what=${3:?作業}
    mkdir -p "$times_dir"
    printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$who" "$what" >> "${times_dir}/${n}.tsv"
    ;;

  po-register)
    handle=$(own_handle)
    echo "$handle" > "$po_file"
    echo "PO として登録しました: 端末 ${handle}"
    ;;

  po-find)
    [ -f "$po_file" ] || die "PO が登録されていない"
    handle=$(cat "$po_file")
    agent_kind=$(alive "$handle") || die "登録された PO の端末が閉じている: ${handle}"
    echo "$handle $agent_kind"
    ;;

  doctor)
    # 1項目ずつ ○ / ×（直し方つき）/ △（確かめられない・任意）を出す。× が1つでもあれば 1 で終わる
    bad=0
    ok()   { echo "○ $1"; }
    ng()   { echo "× $1 → $2"; bad=$((bad + 1)); }
    warn() { echo "△ $1 → $2"; }
    root=$main_worktree

    # ガイド: 埋めていない <…> が残っていないか（`…` の中の例は数えない）
    left=$(sed 's/`[^`]*`//g' "$root/CLAUDE.md" 2>/dev/null | grep -noE '<[^<>]+>' | head -n 3 | tr '\n' ' ') || true
    if [ ! -f "$root/CLAUDE.md" ]; then ng "CLAUDE.md がある" "テンプレートの CLAUDE.md を置く"
    elif [ -n "$left" ]; then ng "CLAUDE.md の <…> を埋めた" "残り: ${left}（setup-project の手順2）"
    else ok "CLAUDE.md の <…> を埋めた"; fi
    if cmp -s "$root/CLAUDE.md" "$root/AGENTS.md"; then ok "AGENTS.md が CLAUDE.md と同じ"
    else ng "AGENTS.md が CLAUDE.md と同じ" "cp CLAUDE.md AGENTS.md"; fi

    # Codex 用のスキル: .claude/skills の各フォルダに、.agents/skills のリンクがある
    missing=""
    for d in "$root"/.claude/skills/*/; do
      s=$(basename "$d")
      [ -f "$root/.agents/skills/$s/SKILL.md" ] || missing="$missing $s"
    done
    if [ -z "$missing" ]; then ok "Codex 用のスキルのリンク（.agents/skills）"
    else ng "Codex 用のスキルのリンク（.agents/skills）" "足りない:${missing}。ln -s ../../.claude/skills/<名前> .agents/skills/<名前>"; fi

    if ls "$root"/.github/workflows/*.y*ml >/dev/null 2>&1; then ok "CI（.github/workflows）"
    else ng "CI（.github/workflows）" "確認コマンドを回す CI を置く（Web アプリなら profiles/web-app/ci.yml をコピー）"; fi

    # GitHub
    if ! gh api user -q .login >/dev/null 2>&1; then
      ng "GitHub にログインしている" "人間が gh auth login を実行する"
    else
      ok "GitHub にログインしている"
      repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || repo=""
      if [ -z "$repo" ]; then ng "GitHub のリポジトリが分かる" "git remote に GitHub のリポジトリを設定する"
      elif grep -q "\`${repo}\`" "$root/CLAUDE.md" 2>/dev/null; then ok "「開発設定」のリポジトリが ${repo}"
      else ng "「開発設定」のリポジトリが ${repo}" "CLAUDE.md と AGENTS.md の「リポジトリ」を \`${repo}\` にする"; fi
      names=$(gh label list --limit 200 --json name -q '.[].name' 2>/dev/null) || names=""
      for l in "$label_ready" "$label_busy"; do
        if printf '%s\n' "$names" | grep -qx "$l"; then ok "ラベル「${l}」"
        else ng "ラベル「${l}」" "gh label create ${l}"; fi
      done
      if [ "$(gh repo view --json squashMergeAllowed -q .squashMergeAllowed 2>/dev/null)" = true ]; then ok "squash でマージできる"
      else ng "squash でマージできる" "gh repo edit --enable-squash-merge"; fi
    fi

    # エージェントの CLI
    for c in claude codex; do
      if command -v "$c" >/dev/null 2>&1; then ok "${c} の CLI がある"
      else ng "${c} の CLI がある" "人間が ${c} を入れてログインする"; fi
    done

    # PO: 登録があり、その端末が開いている
    if [ ! -f "$po_file" ]; then
      ng "PO が登録されている" "PO にする端末（main の worktree）で dev-team.sh po-register"
    else
      handle=$(cat "$po_file"); status=0
      alive "$handle" >/dev/null || status=$?
      case "$status" in
        0) ok "PO が登録されていて、端末が開いている（${handle}）" ;;
        1) ng "PO が登録されていて、端末が開いている" "登録された端末 ${handle} は閉じている。PO にする端末で dev-team.sh po-register" ;;
        *) warn "PO の端末が開いているか" "Orca に照会できなかった（Orca の中で実行し直す）" ;;
      esac
    fi

    # 起動係: この main の worktree で dev-team.sh precheck を使う定期実行があり、有効になっている
    autos=$("$orca_bin" automations list --json 2>/dev/null) || autos=""
    launcher=$(printf '%s' "$autos" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("unknown"); sys.exit()
found = [a for a in (d.get("result") or {}).get("automations") or []
         if (a.get("runContext") or {}).get("path") == sys.argv[1]
         and "dev-team.sh precheck" in ((a.get("precheck") or {}).get("command") or "")]
if not found: print("none")
elif any(a.get("enabled") for a in found): print("enabled " + found[0].get("name", ""))
else: print("disabled " + found[0].get("id", ""))' "$root")
    case "$launcher" in
      enabled*) ok "起動係の定期実行が有効（${launcher#enabled }）" ;;
      disabled*) ng "起動係の定期実行が有効" "人間に確かめてから orca automations edit --id ${launcher#disabled } --enabled" ;;
      none) ng "起動係の定期実行がある" "docs/workflow.md「開発チームを開く」の作り方で作る" ;;
      *) warn "起動係の定期実行" "Orca に照会できなかった（Orca の中で実行し直す）" ;;
    esac

    echo
    if [ "$bad" -eq 0 ]; then echo "準備はそろっています"; else echo "足りない項目: ${bad} 件"; exit 1; fi
    ;;

  *)
    sed -n '2,24p' "$0" >&2
    exit 2
    ;;
esac
