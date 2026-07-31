#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "未找到 pnpm，请先安装 Node.js 和 pnpm。"
  read -r "?按回车键关闭窗口…"
  exit 1
fi

pnpm start:local
