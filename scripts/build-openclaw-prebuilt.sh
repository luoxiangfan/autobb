#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_DIR="${ROOT_DIR}/openclaw"
OUT_DIR="${ROOT_DIR}/openclaw-prebuilt"
TMP_DIR="${OPENCLAW_PREBUILT_TMP_DIR:-${ROOT_DIR}/.openclaw-prebuilt-tmp}"
TMP_OUT_DIR="${TMP_DIR}/out"
ROOT_SKILLS_DIR="${ROOT_DIR}/skills"
SOURCE_COMMIT_PIN_FILE="${OPENCLAW_DIR}/.source-commit"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
SOURCE_VERSION="$(node -e "const p=require(process.argv[1]);process.stdout.write(String(p.version||''));" "${OPENCLAW_DIR}/package.json" 2>/dev/null || true)"
PNPM_VERSION="${OPENCLAW_PNPM_VERSION:-10.23.0}"
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

SOURCE_COMMIT="${SOURCE_COMMIT_GIT:-${SOURCE_COMMIT_PIN}}"
BUILT_AT_UTC="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

if [[ -z "${SOURCE_VERSION}" ]]; then
  echo "❌ 无法读取 openclaw/package.json version"
  exit 1
fi

if [[ -z "${SOURCE_COMMIT}" ]]; then
  echo "❌ 无法确定 openclaw 源码 commit：缺少 openclaw/.git 且未提供 openclaw/.source-commit"
  exit 1
fi

if [[ -n "${SOURCE_COMMIT_GIT}" && "${SOURCE_COMMIT_PIN}" != "${SOURCE_COMMIT_GIT}" ]]; then
  printf '%s\n' "${SOURCE_COMMIT_GIT}" > "${SOURCE_COMMIT_PIN_FILE}"
  echo "ℹ️ 已同步 openclaw/.source-commit -> ${SOURCE_COMMIT_GIT}"
  SOURCE_COMMIT="${SOURCE_COMMIT_GIT}"
fi

echo "🚧 构建 OpenClaw 预编译产物（生产依赖）..."

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_OUT_DIR}"

build_with_docker() {
  docker run --rm \
    -v "${OPENCLAW_DIR}:/openclaw" \
    -v "${TMP_OUT_DIR}:/out" \
    -w /openclaw \
    -e OPENCLAW_A2UI_SKIP_MISSING=1 \
    -e SOURCE_COMMIT="${SOURCE_COMMIT}" \
    -e SOURCE_VERSION="${SOURCE_VERSION}" \
    -e PNPM_VERSION="${PNPM_VERSION}" \
    -e CI=true \
    -e HOST_UID="${HOST_UID}" \
    -e HOST_GID="${HOST_GID}" \
    node:22-bookworm-slim \
    sh -lc '
      set -e
      apt-get update && apt-get install -y git python3 make g++ bash >/dev/null
      use_npm_exec_pnpm=0
      run_pnpm() {
        if [ "${use_npm_exec_pnpm}" -eq 1 ]; then
          npm exec --yes --package="pnpm@${PNPM_VERSION}" -- pnpm "$@"
        else
          pnpm "$@"
        fi
      }

      corepack enable
      if ! corepack prepare "pnpm@${PNPM_VERSION}" --activate; then
        echo "⚠️ corepack prepare pnpm@${PNPM_VERSION} 失败，回退到 npm exec pnpm" >&2
        use_npm_exec_pnpm=1
      fi
      run_pnpm --version >/dev/null

      # 构建阶段需要完整依赖
      run_pnpm install --no-frozen-lockfile
      OPENCLAW_A2UI_SKIP_MISSING=1 \
      GIT_COMMIT="${SOURCE_COMMIT}" \
      OPENCLAW_BUNDLED_VERSION="${SOURCE_VERSION}" \
      run_pnpm build

      # 仅保留生产依赖，避免将 devDependencies 带入镜像
      # CI=true + confirmModulesPurge=false，避免无TTY环境交互中断
      run_pnpm prune --prod --config.confirmModulesPurge=false

      # 防御性清理（历史问题：@typescript/native-preview 导致镜像暴涨）
      rm -rf node_modules/.pnpm/@typescript+native-preview* \
             node_modules/@typescript/native-preview* \
             node_modules/.cache

      mkdir -p /out/dist
      cp -r dist/* /out/dist/
      cp -r extensions /out/extensions
      cp -r skills /out/skills
      if [ -d workspace-templates ]; then
        cp -r workspace-templates /out/workspace-templates
      fi
      if [ -d docs/reference/templates ]; then
        mkdir -p /out/docs/reference
        cp -r docs/reference/templates /out/docs/reference/templates
      fi
      cp openclaw.mjs /out/openclaw.mjs
      cp package.json /out/package.json
      cp -a node_modules /out/node_modules
      chown -R "${HOST_UID:-1000}:${HOST_GID:-1000}" /out
    '
}

build_with_local_toolchain() {
  local local_build_dir="${TMP_DIR}/openclaw-local-build"
  echo "⚠️ 未检测到 Docker，使用本地 Node + pnpm 构建预编译产物..."

  if ! command -v rsync >/dev/null 2>&1; then
    echo "❌ 本地构建需要 rsync，但当前环境不存在 rsync"
    exit 1
  fi
  if ! command -v corepack >/dev/null 2>&1; then
    echo "❌ 本地构建需要 corepack，但当前环境不存在 corepack"
    exit 1
  fi

  rm -rf "${local_build_dir}"
  mkdir -p "${local_build_dir}"
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    "${OPENCLAW_DIR}/" "${local_build_dir}/"

  (
    set -e
    cd "${local_build_dir}"
    use_npm_exec_pnpm=0
    run_pnpm() {
      if [[ "${use_npm_exec_pnpm}" -eq 1 ]]; then
        npm exec --yes --package="pnpm@${PNPM_VERSION}" -- pnpm "$@"
      else
        pnpm "$@"
      fi
    }
    if ! corepack prepare "pnpm@${PNPM_VERSION}" --activate; then
      echo "⚠️ corepack prepare pnpm@${PNPM_VERSION} 失败，回退到 npm exec pnpm" >&2
      use_npm_exec_pnpm=1
    fi
    run_pnpm --version >/dev/null
    run_pnpm install --no-frozen-lockfile
    OPENCLAW_A2UI_SKIP_MISSING=1 \
    GIT_COMMIT="${SOURCE_COMMIT}" \
    OPENCLAW_BUNDLED_VERSION="${SOURCE_VERSION}" \
    run_pnpm build
    run_pnpm prune --prod --config.confirmModulesPurge=false

    rm -rf node_modules/.pnpm/@typescript+native-preview* \
           node_modules/@typescript/native-preview* \
           node_modules/.cache

    mkdir -p "${TMP_OUT_DIR}/dist"
    cp -r dist/* "${TMP_OUT_DIR}/dist/"
    cp -r extensions "${TMP_OUT_DIR}/extensions"
    cp -r skills "${TMP_OUT_DIR}/skills"
    if [[ -d workspace-templates ]]; then
      cp -r workspace-templates "${TMP_OUT_DIR}/workspace-templates"
    fi
    if [[ -d docs/reference/templates ]]; then
      mkdir -p "${TMP_OUT_DIR}/docs/reference"
      cp -r docs/reference/templates "${TMP_OUT_DIR}/docs/reference/templates"
    fi
    cp openclaw.mjs "${TMP_OUT_DIR}/openclaw.mjs"
    cp package.json "${TMP_OUT_DIR}/package.json"
    cp -a node_modules "${TMP_OUT_DIR}/node_modules"
  )
}

if command -v docker >/dev/null 2>&1; then
  build_with_docker
else
  build_with_local_toolchain
fi

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
# 保留 pnpm 符号链接结构，避免 cp -r 跟随失效链接导致复制失败
cp -a "${TMP_OUT_DIR}/." "${OUT_DIR}/"

# 合并仓库根目录技能（autoads-report-qa 等）到预编译产物
if [[ -d "${ROOT_SKILLS_DIR}" ]]; then
  mkdir -p "${OUT_DIR}/skills"
  cp -r "${ROOT_SKILLS_DIR}/." "${OUT_DIR}/skills/"
fi

cat > "${OUT_DIR}/.build-meta.json" <<EOF
{
  "source_version": "${SOURCE_VERSION}",
  "source_commit": "${SOURCE_COMMIT}",
  "built_at": "${BUILT_AT_UTC}"
}
EOF

rm -rf "${TMP_DIR}"

echo "✅ OpenClaw 预编译产物已生成 -> ${OUT_DIR}"

if [[ -x "${ROOT_DIR}/scripts/verify-openclaw-prebuilt.sh" ]]; then
  OPENCLAW_PREBUILT_STRICT=1 "${ROOT_DIR}/scripts/verify-openclaw-prebuilt.sh"
fi
