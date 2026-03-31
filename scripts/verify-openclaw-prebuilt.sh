#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREBUILT_DIR="${ROOT_DIR}/openclaw-prebuilt"
OPENCLAW_DIR="${ROOT_DIR}/openclaw"
META_FILE="${PREBUILT_DIR}/.build-meta.json"
SOURCE_COMMIT_PIN_FILE="${OPENCLAW_DIR}/.source-commit"

read_meta_value() {
  local key="$1"
  node -e "const fs=require('fs');const meta=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const value=meta[process.argv[2]];process.stdout.write(value==null?'':String(value));" "${META_FILE}" "${key}" 2>/dev/null || true
}

SOURCE_VERSION="$(node -e "const p=require(process.argv[1]);process.stdout.write(String(p.version||''));" "${OPENCLAW_DIR}/package.json" 2>/dev/null || true)"
SOURCE_COMMIT_GIT=""
if [[ -e "${OPENCLAW_DIR}/.git" ]]; then
  SOURCE_COMMIT_GIT="$(git -C "${OPENCLAW_DIR}" rev-parse HEAD 2>/dev/null || true)"
fi

SOURCE_COMMIT_PIN=""
if [[ -f "${SOURCE_COMMIT_PIN_FILE}" ]]; then
  SOURCE_COMMIT_PIN="$(tr -d '[:space:]' < "${SOURCE_COMMIT_PIN_FILE}")"
fi

if [[ -n "${SOURCE_COMMIT_PIN}" && ! "${SOURCE_COMMIT_PIN}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ openclaw/.source-commit 非法: ${SOURCE_COMMIT_PIN}"
  exit 1
fi

if [[ -n "${SOURCE_COMMIT_GIT}" && ! "${SOURCE_COMMIT_GIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ openclaw git commit 非法: ${SOURCE_COMMIT_GIT}"
  exit 1
fi

if [[ -n "${SOURCE_COMMIT_GIT}" && -n "${SOURCE_COMMIT_PIN}" && "${SOURCE_COMMIT_GIT}" != "${SOURCE_COMMIT_PIN}" ]]; then
  echo "❌ openclaw commit pin 与 git HEAD 不一致: pin=${SOURCE_COMMIT_PIN}, git=${SOURCE_COMMIT_GIT}"
  exit 1
fi

SOURCE_COMMIT="${SOURCE_COMMIT_GIT:-${SOURCE_COMMIT_PIN}}"

if [[ ! -f "${META_FILE}" ]]; then
  echo "❌ openclaw-prebuilt/.build-meta.json 不存在"
  exit 1
fi

META_SOURCE_VERSION="$(read_meta_value source_version)"
META_SOURCE_COMMIT="$(read_meta_value source_commit)"
META_BUILT_AT="$(read_meta_value built_at)"

if [[ -z "${META_SOURCE_VERSION}" || -z "${META_SOURCE_COMMIT}" || -z "${META_BUILT_AT}" ]]; then
  echo "❌ openclaw-prebuilt/.build-meta.json 缺少必填字段(source_version/source_commit/built_at)"
  exit 1
fi

if [[ ! "${META_SOURCE_COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ openclaw-prebuilt/.build-meta.json source_commit 非法: ${META_SOURCE_COMMIT}"
  exit 1
fi

if [[ -z "${SOURCE_VERSION}" ]]; then
  echo "❌ 无法读取 openclaw/package.json version"
  exit 1
fi

if [[ "${META_SOURCE_VERSION}" != "${SOURCE_VERSION}" ]]; then
  echo "❌ openclaw-prebuilt 版本不一致: meta=${META_SOURCE_VERSION}, source=${SOURCE_VERSION}"
  exit 1
fi

if [[ -z "${SOURCE_COMMIT}" ]]; then
  echo "❌ 无法确定 openclaw 源码 commit：缺少 openclaw/.git 且未提供 openclaw/.source-commit"
  exit 1
fi

if [[ "${META_SOURCE_COMMIT}" != "${SOURCE_COMMIT}" ]]; then
  echo "❌ openclaw-prebuilt commit不一致: meta=${META_SOURCE_COMMIT}, source=${SOURCE_COMMIT}"
  exit 1
fi

STRICT_MODE="${OPENCLAW_PREBUILT_STRICT:-0}"
RUNTIME_MISSING_PATH=""
for candidate in "dist/entry.js" "node_modules" "extensions" "openclaw.mjs" "package.json"; do
  if [[ ! -e "${PREBUILT_DIR}/${candidate}" ]]; then
    RUNTIME_MISSING_PATH="${candidate}"
    break
  fi
done

if [[ -n "${RUNTIME_MISSING_PATH}" ]]; then
  if [[ "${STRICT_MODE}" == "1" ]]; then
    echo "❌ openclaw-prebuilt/${RUNTIME_MISSING_PATH} 不存在（严格模式）"
    exit 1
  fi

  echo "⚠️ openclaw-prebuilt/${RUNTIME_MISSING_PATH} 不存在，跳过运行产物严格校验（当前为非严格模式）"
  echo "✅ OpenClaw 预编译元数据验证通过（非严格模式）"
  exit 0
fi

if [[ ! -f "${PREBUILT_DIR}/dist/entry.js" ]]; then
  echo "❌ openclaw-prebuilt/dist/entry.js 不存在"
  exit 1
fi

if [[ ! -d "${PREBUILT_DIR}/node_modules" ]]; then
  echo "❌ openclaw-prebuilt/node_modules 不存在"
  exit 1
fi

if [[ ! -d "${PREBUILT_DIR}/extensions" ]]; then
  echo "❌ openclaw-prebuilt/extensions 不存在"
  exit 1
fi

if [[ ! -d "${PREBUILT_DIR}/skills" ]]; then
  echo "❌ openclaw-prebuilt/skills 不存在（Gateway 将无法加载内置技能）"
  exit 1
fi

if [[ -d "${PREBUILT_DIR}/docs/reference/templates" && ! -f "${PREBUILT_DIR}/docs/reference/templates/AGENTS.md" ]]; then
  echo "❌ openclaw-prebuilt/docs/reference/templates 存在但缺少 AGENTS.md（模板兜底不完整）"
  exit 1
fi

if [[ ! -f "${PREBUILT_DIR}/workspace-templates/AGENTS.md" && ! -f "${PREBUILT_DIR}/docs/reference/templates/AGENTS.md" ]]; then
  echo "❌ 缺少可用模板：需提供 workspace-templates/AGENTS.md 或 docs/reference/templates/AGENTS.md"
  exit 1
fi

for plugin in feishu memory-core; do
  if [[ ! -f "${PREBUILT_DIR}/extensions/${plugin}/package.json" ]]; then
    echo "❌ openclaw-prebuilt/extensions/${plugin} 缺失（插件未打包）"
    exit 1
  fi
done

for skill in autoads autoads-report-qa autoads-prd-writer; do
  if [[ ! -f "${PREBUILT_DIR}/skills/${skill}/SKILL.md" ]]; then
    echo "❌ openclaw-prebuilt/skills/${skill}/SKILL.md 缺失（内置技能未打包）"
    exit 1
  fi
done

# 防止把 dev 依赖打进镜像（历史问题：TypeScript native preview 二进制体积巨大）
if compgen -G "${PREBUILT_DIR}/node_modules/.pnpm/@typescript+native-preview*" > /dev/null; then
  echo "❌ 检测到 dev 依赖 @typescript/native-preview 被打包进 openclaw-prebuilt"
  exit 1
fi
if compgen -G "${PREBUILT_DIR}/node_modules/@typescript/native-preview*" > /dev/null; then
  echo "❌ 检测到 dev 依赖 @typescript/native-preview 被打包进 openclaw-prebuilt"
  exit 1
fi

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0
}

run_help() {
  node "${PREBUILT_DIR}/openclaw.mjs" --help >/dev/null
}

MAJOR="$(node_major)"
if [[ "${MAJOR}" -ge 22 ]]; then
  run_help
  echo "✅ OpenClaw 预编译产物验证通过"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "${PREBUILT_DIR}:/out" \
    -w /out \
    node:22-bookworm-slim \
    node openclaw.mjs --help >/dev/null
  echo "✅ OpenClaw 预编译产物验证通过（Docker Node 22）"
  exit 0
fi

echo "❌ 当前 Node 版本 < 22，且未检测到 Docker，无法验证 openclaw 预编译产物"
exit 1
