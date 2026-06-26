#!/bin/sh
# 删除 node_modules 中不参与运行时加载的内容，缩小生产镜像体积。
set -eu

ROOT="${1:-./node_modules}"
if [ ! -d "$ROOT" ]; then
  exit 0
fi

find "$ROOT" -type d \
  \( -name test -o -name tests -o -name '__tests__' -o -name docs -o -name doc \
     -o -name example -o -name examples -o -name bench -o -name benchmark \
     -o -name coverage -o -name .github \) \
  -prune -exec rm -rf '{}' +

find "$ROOT" -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -iname '*.md' -o -iname '*.markdown' \) \
  -delete

# Playwright 浏览器由 PLAYWRIGHT_BROWSERS_PATH 单独安装，包内预置缓存可删。
if [ -d "$ROOT/playwright/.local-browsers" ]; then
  rm -rf "$ROOT/playwright/.local-browsers"
fi
if [ -d "$ROOT/playwright-core/.local-browsers" ]; then
  rm -rf "$ROOT/playwright-core/.local-browsers"
fi
