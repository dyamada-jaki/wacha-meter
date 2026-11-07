#!/usr/bin/env bash
# dev-team.sh の試験。orca と gh を偽物に差し替え、GitHub と Orca には触らない。
# 起動に失敗したときに二重起動の道を残さないことと、端末の生存確認の扱いを確かめる。
#   bash .claude/skills/dual-implement/scripts/dev-team.test.sh
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/dev-team.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

# 偽の gh: ラベルごとの Issue 番号を $FAKE/labels/<ラベル名> に1行ずつ持つ
mkdir -p "$work/bin"
cat > "$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
dir="$FAKE/labels"; mkdir -p "$dir"
case "$1 $2" in
  "api -X")
    for a in "$@"; do case "$a" in labels=*) label=${a#labels=} ;; esac; done
    sort -n "$dir/$label" 2>/dev/null | sed '/^$/d' ;;
  "issue view")
    for f in "$dir"/*; do [ -f "$f" ] && grep -qx "$3" "$f" && basename "$f"; done; exit 0 ;;
  "issue edit")
    [ -n "${FAKE_GH_EDIT_FAIL:-}" ] && exit 1
    n=$3; shift 3
    while [ $# -gt 0 ]; do
      case "$1" in
        --remove-label) [ -f "$dir/$2" ] && { grep -vx "$n" "$dir/$2" > "$dir/.tmp"; mv "$dir/.tmp" "$dir/$2"; } ;;
        --add-label) echo "$n" >> "$dir/$2" ;;
      esac
      shift 2
    done ;;
  "api user") echo me ;;
  "repo view")
    case "$*" in *squashMergeAllowed*) cat "$FAKE/squash" 2>/dev/null ;; *) cat "$FAKE/repo" ;; esac ;;
  "label list") cat "$FAKE/label_names" 2>/dev/null ;;
  *) echo "偽の gh が知らない呼び出し: $*" >&2; exit 1 ;;
esac
EOF

# 偽の orca: 端末 H の show の返事を $FAKE/show/H に置く。無ければ「端末が無い」を返す
cat > "$work/bin/orca" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "terminal create")
    [ -n "${FAKE_CREATE_FAIL:-}" ] && exit 1
    echo '{"ok":true,"result":{"terminal":{"handle":"term_new"}}}' ;;
  "terminal show")
    f="$FAKE/show/$4"
    if [ -f "$f" ]; then cat "$f"; [ -n "${FAKE_SHOW_RC:-}" ] && exit "$FAKE_SHOW_RC"; exit 0; fi
    echo '{"ok":false,"error":{"code":"terminal_handle_stale"}}'; exit 1 ;;
  "terminal wait") exit "${FAKE_WAIT_RC:-0}" ;;
  "automations list") cat "$FAKE/automations.json" ;;
  "terminal close") echo "$4" >> "$FAKE/closed" ;;
  "terminal send")
    [ -n "${FAKE_SEND_FAIL:-}" ] && exit 1
    for a in "$@"; do prev=${cur:-}; cur=$a; [ "$prev" = --text ] && echo "$a" >> "$FAKE/sent"; done
    exit 0 ;;
  *) echo "偽の orca が知らない呼び出し: $*" >&2; exit 1 ;;
esac
EOF
printf '#!/bin/sh\n' > "$work/bin/claude"; printf '#!/bin/sh\n' > "$work/bin/codex"
chmod +x "$work/bin/gh" "$work/bin/orca" "$work/bin/claude" "$work/bin/codex"

connected='{"ok":true,"result":{"terminal":{"connected":true,"agentIdentity":"claude"}}}'

# 試験ごとに状態を作り直す。引数: 「開発可」の番号 「着手中」の番号
reset() {
  export FAKE="$work/case"
  rm -rf "$FAKE"; mkdir -p "$FAKE/labels" "$FAKE/show" "$FAKE/state"
  [ -n "$1" ] && echo "$1" > "$FAKE/labels/開発可"
  [ -n "$2" ] && echo "$2" > "$FAKE/labels/着手中"
  unset FAKE_CREATE_FAIL FAKE_SEND_FAIL FAKE_GH_EDIT_FAIL FAKE_WAIT_RC FAKE_SHOW_RC
}
run() {
  DEV_TEAM_STATE_DIR="$FAKE/state" ORCA_CLI_BIN_DIR="$work/bin" PATH="$work/bin:$PATH" \
    bash "$script" "$@" > "$FAKE/out" 2>&1
}
lock() { cat "$FAKE/state/dev-team.lock" 2>/dev/null; }
labels() { cat "$FAKE/labels/$1" 2>/dev/null | sed '/^$/d' | tr '\n' ' ' | sed 's/ $//'; }
check() {
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "NG   $name"; sed 's/^/     | /' "$FAKE/out"; fails=$((fails + 1)); fi
}

reset 5 ""
run launch; rc=$?
check "起動できたら: 0 で終わる" test "$rc" -eq 0
check "起動できたら: ラベルが「着手中」に替わる" test "$(labels 開発可)/$(labels 着手中)" = "/5"
check "起動できたら: 端末の handle を登録する" test "$(lock)" = "5 term_new"
check "起動できたら: dual-implement を送る" test "$(cat "$FAKE/sent")" = "/dual-implement 5"

reset 5 ""
FAKE_SEND_FAIL=1 run launch; rc=$?
echo "$connected" > "$FAKE/show/term_new"
check "送信に失敗したら: 0 以外で終わる" test "$rc" -ne 0
check "送信に失敗したら: 「着手中」のまま残す" test "$(labels 開発可)/$(labels 着手中)" = "/5"
check "送信に失敗したら: 登録を残す" test "$(lock)" = "5 term_new"
echo 5 > "$FAKE/labels/開発可"; : > "$FAKE/labels/着手中"   # ラベルの一覧が古い場合を再現する
run precheck; rc=$?
check "送信に失敗したあと: ラベルの一覧が古くても次の起動を止める" test "$rc" -ne 0

reset 5 ""
FAKE_WAIT_RC=1 run launch; rc=$?
check "エージェントの起動を確かめられなければ: 登録とラベルを残す" test "$rc-$(lock)-$(labels 着手中)" = "1-5 term_new-5"

reset 5 ""
FAKE_CREATE_FAIL=1 run launch; rc=$?
check "端末を開けなかったら: 「launching」の登録を残す" test "$rc-$(lock)-$(labels 着手中)" = "1-5 launching-5"
echo 5 > "$FAKE/labels/開発可"; : > "$FAKE/labels/着手中"
run precheck; rc=$?
check "端末を開けなかったあと: 次の起動を止める" test "$rc" -ne 0
run release 5
check "release で「launching」の登録も消える" test -z "$(lock)"

reset 5 ""
FAKE_GH_EDIT_FAIL=1 run launch; rc=$?
check "ラベルを替えられなければ: 何も起動せず、登録も残さない" test "$rc-$(lock)-$(labels 開発可)" = "1--5"

reset 6 ""
echo "5 term_old" > "$FAKE/state/dev-team.lock"
echo '{"ok":false,"error":{"code":"runtime_unavailable"}}' > "$FAKE/show/term_old"
run precheck; rc=$?
check "照会が別の理由で失敗したら: 動いているとみなす" test "$rc" -ne 0
grep -q "動いている開発チーム: 1" "$FAKE/out"; check "照会が別の理由で失敗したら: 1 と出す" test $? -eq 0

reset 6 ""
echo "5 term_old" > "$FAKE/state/dev-team.lock"
echo 'not json' > "$FAKE/show/term_old"
run precheck; rc=$?
check "orca の返事が読めなければ: 動いているとみなす" test "$rc" -ne 0

reset 6 ""
echo "5 term_old" > "$FAKE/state/dev-team.lock"
echo "$connected" > "$FAKE/show/term_old"; FAKE_SHOW_RC=1
run precheck; rc=$?
check "orca が失敗で終わっても、つながっていれば動いているとみなす" test "$rc" -ne 0

reset 6 ""
echo "5 term_old" > "$FAKE/state/dev-team.lock"
echo '{"ok":true,"result":{"terminal":{"connected":false}}}' > "$FAKE/show/term_old"
run precheck; rc=$?
check "端末がつながっていなければ: 閉じたとみなして起動できる" test "$rc" -eq 0

reset 6 ""
echo "5 term_old" > "$FAKE/state/dev-team.lock"   # show の返事が無い = 端末が無い
run precheck; rc=$?
check "端末が無ければ（terminal_handle_stale）: 閉じたとみなして起動できる" test "$rc" -eq 0

reset "" 5
echo "5 term_me" > "$FAKE/state/dev-team.lock"
ORCA_TERMINAL_HANDLE=term_me run close-self; rc=$?
check "release 前の close-self は断る" test "$rc-$(cat "$FAKE/closed" 2>/dev/null)" = "1-"
run release 5
ORCA_TERMINAL_HANDLE=term_me run close-self; rc=$?
check "release 後の close-self は自分の端末を閉じる" test "$rc-$(cat "$FAKE/closed" 2>/dev/null)" = "0-term_me"

reset "" ""
echo "term_po" > "$FAKE/state/po.handle"
ORCA_TERMINAL_HANDLE=term_po run close-self; rc=$?
check "PO の端末では close-self を断る" test "$rc-$(cat "$FAKE/closed" 2>/dev/null)" = "1-"

reset "" ""
run mark 5 開発チーム "1. 事前確認"; run mark 5 PO 待ち
check "mark: 1行ずつ時刻・担当・作業を追記する" test "$(cut -f2,3 "$FAKE/state/work-times/5.tsv" | tr '\t\n' ':;')" = "開発チーム:1. 事前確認;PO:待ち;"
run mark 5 開発チーム; rc=$?
check "mark: 作業が無ければ断る" test "$rc" -ne 0

# doctor: 準備のそろった偽のリポジトリを作り、1か所ずつ崩して × になることを確かめる
doctor_reset() {
  reset "" ""
  repo="$FAKE/repo-dir"
  mkdir -p "$repo/.claude/skills/a" "$repo/.agents/skills" "$repo/.github/workflows"
  git -C "$repo" init -q
  printf '# 例\n| リポジトリ | `me/example` |\n例は `<Issue番号>` のように書く\n' > "$repo/CLAUDE.md"
  cp "$repo/CLAUDE.md" "$repo/AGENTS.md"
  echo x > "$repo/.claude/skills/a/SKILL.md"; ln -s ../../.claude/skills/a "$repo/.agents/skills/a"
  echo x > "$repo/.github/workflows/ci.yml"
  echo me/example > "$FAKE/repo"; echo true > "$FAKE/squash"; printf '開発可\n着手中\n' > "$FAKE/label_names"
  echo term_po > "$FAKE/state/po.handle"; echo "$connected" > "$FAKE/show/term_po"
  automation true "$(cd "$repo" && pwd -P)"
}
automation() {  # 引数: enabled（true / false） 作業場所のパス
  printf '{"ok":true,"result":{"automations":[{"id":"A1","name":"開発チーム起動（example）","enabled":%s,"runContext":{"path":"%s"},"precheck":{"command":"bash .claude/skills/dual-implement/scripts/dev-team.sh precheck"}}]}}' \
    "$1" "$2" > "$FAKE/automations.json"
}
doctor() { (cd "$repo" && run doctor); }
has() { grep -q "$1" "$FAKE/out"; }
ng_with() { [ "$rc" -eq 1 ] && has "$1"; }

doctor_reset; doctor; rc=$?
check "doctor: そろっていれば 0 で終わる（\`…\` の中の <…> は数えない）" test "$rc" -eq 0
doctor_reset; printf '# <プロジェクト名>\n' >> "$repo/CLAUDE.md"; cp "$repo/CLAUDE.md" "$repo/AGENTS.md"; doctor; rc=$?
check "doctor: <…> が残っていれば ×" ng_with "× CLAUDE.md の <…>"
doctor_reset; echo y >> "$repo/AGENTS.md"; doctor; rc=$?
check "doctor: AGENTS.md が違えば ×" ng_with "× AGENTS.md"
doctor_reset; mkdir -p "$repo/.claude/skills/b"; echo x > "$repo/.claude/skills/b/SKILL.md"; doctor; rc=$?
check "doctor: Codex 用のリンクが足りなければ ×" ng_with "足りない: b"
doctor_reset; rm "$repo/.github/workflows/ci.yml"; doctor; rc=$?
check "doctor: CI が無ければ ×" ng_with "× CI"
doctor_reset; echo other/repo > "$FAKE/repo"; doctor; rc=$?
check "doctor: 「開発設定」のリポジトリが違えば ×" ng_with "× 「開発設定」のリポジトリ"
doctor_reset; echo 開発可 > "$FAKE/label_names"; doctor; rc=$?
check "doctor: ラベルが無ければ ×" ng_with "× ラベル「着手中」"
doctor_reset; echo false > "$FAKE/squash"; doctor; rc=$?
check "doctor: squash が許可されていなければ ×" ng_with "× squash"
doctor_reset; rm "$FAKE/state/po.handle"; doctor; rc=$?
check "doctor: PO が登録されていなければ ×" ng_with "× PO が登録されている"
doctor_reset; rm "$FAKE/show/term_po"; doctor; rc=$?
check "doctor: PO の端末が閉じていれば ×" ng_with "× PO が登録されていて"
doctor_reset; automation true /somewhere/else; doctor; rc=$?
check "doctor: 別の作業場所の定期実行しか無ければ ×" ng_with "× 起動係の定期実行がある"
doctor_reset; automation false "$(cd "$repo" && pwd -P)"; doctor; rc=$?
check "doctor: 定期実行が無効なら ×（有効にするコマンドを出す）" ng_with "edit --id A1 --enabled"
doctor_reset; echo 'not json' > "$FAKE/automations.json"; doctor; rc=$?
check "doctor: Orca に照会できなければ △（× にはしない）" eval '[ "$rc" -eq 0 ] && has "△ 起動係"'

echo
[ "$fails" -eq 0 ] && echo "すべて成功" || { echo "失敗: ${fails} 件"; exit 1; }
