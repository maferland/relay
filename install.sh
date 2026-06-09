#!/usr/bin/env bash
set -euo pipefail

# Installs the `tasks` binary, the using-agent-tasks skill, and the MCP server.
# Builds from source (no published release yet). Run from a checkout, or pipe from curl:
#   curl -fsSL https://raw.githubusercontent.com/maferland/agent-tasks/main/install.sh | bash

REPO="maferland/agent-tasks"
BIN_DIR="${AGENT_TASKS_BIN_DIR:-$HOME/.local/bin}"
SRC_DIR="${AGENT_TASKS_SRC:-$HOME/.local/share/agent-tasks-src}"
SKILLS_DIR="$HOME/.claude/skills"

GREEN='\033[0;32m'; RED='\033[0;31m'; DIM='\033[2m'; RESET='\033[0m'
echo ""
echo -e "  📋 ${GREEN}agent-tasks${RESET} — local-first task tracker for multi-agent coordination"
echo ""

command -v bun >/dev/null 2>&1 || { echo -e "  ${RED}!${RESET} bun is required — install from https://bun.sh" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo -e "  ${RED}!${RESET} git is required" >&2; exit 1; }

# Source: a local checkout if we're in one, else a cached clone we keep up to date.
if [ -f "./package.json" ] && grep -q '"name": "agent-tasks"' ./package.json 2>/dev/null; then
  src="$(pwd)"
  echo -e "  ${DIM}Building from the current checkout...${RESET}"
elif [ -d "$SRC_DIR/.git" ]; then
  echo -e "  ${DIM}Updating ${SRC_DIR}...${RESET}"
  git -C "$SRC_DIR" pull --ff-only
  src="$SRC_DIR"
else
  echo -e "  ${DIM}Cloning ${REPO}...${RESET}"
  git clone "https://github.com/${REPO}.git" "$SRC_DIR"
  src="$SRC_DIR"
fi

cd "$src"
echo -e "  ${DIM}Installing deps and building...${RESET}"
bun install --silent
bun run build >/dev/null

mkdir -p "$BIN_DIR"
cp dist/tasks "$BIN_DIR/tasks"
chmod +x "$BIN_DIR/tasks"
echo -e "  ${GREEN}✓${RESET} Installed tasks → ${BIN_DIR}/tasks"

mkdir -p "$SKILLS_DIR"
rm -rf "$SKILLS_DIR/using-agent-tasks"
cp -r skills/using-agent-tasks "$SKILLS_DIR/using-agent-tasks"
echo -e "  ${GREEN}✓${RESET} Installed using-agent-tasks skill"

# MCP is best-effort and only applies when Claude Code is present.
if command -v claude >/dev/null 2>&1; then
  claude mcp add --scope user agent-tasks -- tasks mcp >/dev/null 2>&1 || true
  echo -e "  ${GREEN}✓${RESET} Registered agent-tasks MCP server (user scope)"
else
  echo -e "  ${DIM}claude CLI not found — skipping skill/MCP registration was partial.${RESET}"
fi

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo -e "  ${RED}!${RESET} ${BIN_DIR} is not on your PATH. Add it:"
  case "${SHELL:-}" in
    */fish) echo -e "    ${DIM}fish_add_path ${BIN_DIR}${RESET}" ;;
    */zsh)  echo -e "    ${DIM}echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.zshrc${RESET}" ;;
    */bash) echo -e "    ${DIM}echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.bashrc${RESET}" ;;
    *)      echo -e "    ${DIM}export PATH=\"${BIN_DIR}:\$PATH\"${RESET}" ;;
  esac
fi

echo ""
echo -e "  ${GREEN}✓${RESET} Done. Try:  ${DIM}tasks add \"my first task\"  ·  tasks ui --me \$USER${RESET}"
echo ""
