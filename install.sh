#!/bin/sh
# waiting-on-me installer.
#
#   curl -fsSL https://raw.githubusercontent.com/pyxl-dev/waiting-on-me/main/install.sh | sh
#   curl -fsSL .../install.sh | SECTION="En attente de toi" sh   # custom section name
#   ./install.sh --uninstall
#
# Installs the mod as a Claude Code plugin (user scope), allows the two sidebar
# tools it calls, and adds a short rule to ~/.claude/CLAUDE.md so Claude flags
# the turns that wait on you. Re-run it to update. Only files under ~/.claude
# are touched.
set -eu

REPO="pyxl-dev/waiting-on-me"
PLUGIN="waiting-on-me"
SETTINGS="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
BEGIN="<!-- waiting-on-me:begin -->"
END="<!-- waiting-on-me:end -->"

if [ -t 1 ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); N=$(printf '\033[0m'); else B= G= Y= R= N=; fi
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '%s✗%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

command -v claude >/dev/null || die "claude is missing: install Claude Code first (https://claude.com/claude-code)"
command -v python3 >/dev/null || die "python3 is missing: run  xcode-select --install"
mkdir -p "$HOME/.claude"

# Adds (mode=add) or removes (mode=remove) the two permission rules.
permissions() {
  python3 - "$SETTINGS" "$1" <<'PY'
import json, os, sys
path, mode = sys.argv[1], sys.argv[2]
rules = ["mcp__ccd_sidebar__move_sessions", "mcp__ccd_sidebar__create_section"]
data = json.load(open(path)) if os.path.exists(path) and os.path.getsize(path) else {}
allow = data.setdefault("permissions", {}).setdefault("allow", [])
if mode == "add":
    allow.extend(r for r in rules if r not in allow)
else:
    allow[:] = [r for r in allow if r not in rules]
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
}

# Removes the rule block from CLAUDE.md, if present.
strip_rule() {
  [ -f "$CLAUDE_MD" ] || return 0
  python3 - "$CLAUDE_MD" "$BEGIN" "$END" <<'PY'
import re, sys
path, begin, end = sys.argv[1:4]
text = open(path).read()
text = re.sub(r"\n?" + re.escape(begin) + r".*?" + re.escape(end) + r"\n?", "\n", text, flags=re.S)
open(path, "w").write(text.rstrip("\n") + "\n")
PY
}

if [ "${1:-}" = "--uninstall" ]; then
  claude plugin uninstall "$PLUGIN" >/dev/null 2>&1 && ok "plugin removed" || warn "plugin was not installed"
  permissions remove; ok "permission rules removed from $SETTINGS"
  strip_rule; ok "rule removed from $CLAUDE_MD"
  echo "The sidebar section stays: delete it from the app if you no longer want it."
  exit 0
fi

printf '%swaiting-on-me%s installer\n\n' "$B" "$N"

# 1. The plugin, from this repository's marketplace.
claude plugin marketplace add "$REPO" >/dev/null 2>&1 || true
if [ -n "${SECTION:-}" ]; then
  claude plugin install "$PLUGIN@$PLUGIN" --scope user --config "section=$SECTION" >/dev/null || die "plugin install failed: run  claude plugin install $PLUGIN --marketplace $REPO"
else
  claude plugin install "$PLUGIN@$PLUGIN" --scope user >/dev/null || die "plugin install failed: run  claude plugin install $PLUGIN --marketplace $REPO"
fi
ok "plugin installed (user scope)"

# 2. Permission rules: without them auto mode refuses the sidebar moves.
permissions add
ok "allowed mcp__ccd_sidebar__move_sessions and create_section in $SETTINGS"

# 3. The rule that makes Claude flag the turns that wait on you.
strip_rule
cat >> "$CLAUDE_MD" <<EOF

$BEGIN
- Desktop Code tab: when a turn ends on a question, a choice, or an action the user must do and report back, call \`wrap_up\` with \`blocked: true\` (or an \`ask\`). The \`waiting-on-me\` mod reads it to file the session in the sidebar. A finished task ends with a recap-only \`wrap_up\`.
$END
EOF
ok "rule added to $CLAUDE_MD"

# 4. Optional fallback.
if command -v jev >/dev/null; then ok "jev found: used when Claude gives no signal"
else warn "jev not found: only Claude's wrap_up signal decides (optional, see README)"; fi

printf '\n%sDone.%s New sessions of the Claude desktop app pick it up. Restart the app for open ones.\n' "$B" "$N"
