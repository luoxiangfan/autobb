/* eslint-disable no-console */

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

function fail(message) {
  console.error(`\n❌ ${message}\n`)
  process.exit(1)
}

function info(label, value) {
  console.log(`- ${label}: ${value}`)
}

const nodeVersion = process.versions.node
const nodeMajor = Number(nodeVersion.split('.')[0])
const nodeAbi = process.versions.modules
const nodeArch = process.arch
const platform = process.platform

function readCommand(bin, args) {
  try {
    const shouldForceArch =
      platform === 'darwin' && (nodeArch === 'arm64' || nodeArch === 'x64')
    const command = shouldForceArch ? 'arch' : bin
    const commandArgs = shouldForceArch
      ? [`-${nodeArch === 'arm64' ? 'arm64' : 'x86_64'}`, bin, ...args]
      : args
    const result = childProcess.spawnSync(command, commandArgs, { encoding: 'utf8' })
    if (result.status !== 0) return null
    return String(result.stdout || '').trim() || null
  } catch {
    return null
  }
}

let machineArch = null
let hardwareArm64 = null
let procTranslated = null
machineArch = readCommand('uname', ['-m'])
hardwareArm64 = readCommand('sysctl', ['-n', 'hw.optional.arm64'])
procTranslated = readCommand('sysctl', ['-n', 'sysctl.proc_translated'])

console.log('\n🔎 Runtime check')
info('node', nodeVersion)
info('arch', nodeArch)
if (machineArch) info('machine_arch', machineArch)
if (hardwareArm64) info('hw.optional.arm64', hardwareArm64)
if (procTranslated) info('sysctl.proc_translated', procTranslated)
info('node_abi', nodeAbi)
info('execPath', process.execPath)

if (nodeMajor !== 22) {
  fail(
    `Node.js 版本不匹配（当前 ${nodeVersion}）。请统一使用 Node 22（Homebrew: \`brew link --overwrite --force node@22\`），然后重开终端并执行 \`rm -rf node_modules .next && npm ci\`。`
  )
}

if (platform === 'darwin' && hardwareArm64 === '1' && nodeArch === 'x64') {
  console.warn(
    '\n⚠️ 检测到 Apple Silicon + x86_64（Rosetta）Node。\n' +
    '   这在“依赖由 x86_64 Node 安装、运行也用 x86_64 Node”时是可用的；\n' +
    '   但非常容易出现 better-sqlite3 架构不匹配（依赖是 x86_64，而你用 arm64 Node 运行，或反之）。\n' +
    '   推荐：使用 arm64 Node 22，并执行 `npm run bootstrap` 统一重装依赖。\n'
  )
}

try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec('SELECT 1;')
  db.close()
  info('better-sqlite3', 'ok')
} catch (err) {
  const message = err && typeof err === 'object' ? String(err.message || err) : String(err)
  console.error(err)

  if (platform === 'darwin' && /incompatible architecture/i.test(message)) {
    const nodeBinDir = path.dirname(process.execPath)
    fail(
      `better-sqlite3 架构不匹配（常见：之前用 x86_64 Node/npm 安装过依赖，现在切到 arm64 Node）。\n` +
      `建议用当前 Node 一键修复：\n` +
      `  npm run bootstrap\n` +
      `\n` +
      `或手动修复（确保 npm 用的是同一个 Node）：\n` +
      `  1) export PATH="${nodeBinDir}:$PATH"\n` +
      `  2) rm -rf node_modules .next && npm ci`
    )
  }

  fail('better-sqlite3 原生模块加载失败。请在 Node 22 下执行：`rm -rf node_modules .next && npm ci`。')
}

try {
  const reactIsPath = require.resolve('react-is')
  const exists = fs.existsSync(reactIsPath)
  if (!exists) {
    fail(`依赖解析异常：\`${reactIsPath}\` 不存在。请执行 \`rm -rf node_modules .next && npm ci\`。`)
  }
  info('react-is', path.relative(process.cwd(), reactIsPath))
} catch (err) {
  console.error(err)
  fail('依赖解析异常：react-is 无法解析。请执行 `rm -rf node_modules .next && npm ci`。')
}

console.log('✅ Runtime check passed\n')
