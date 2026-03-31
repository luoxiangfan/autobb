/* eslint-disable no-console */

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

function getDarwinArchPrefix() {
  if (process.platform !== 'darwin') return null
  if (process.arch === 'arm64') return ['arch', '-arm64']
  if (process.arch === 'x64') return ['arch', '-x86_64']
  return null
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function rmIfExists(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true })
  } catch (err) {
    // macOS 上偶发 ENOTEMPTY（文件系统/索引竞态），fallback 到 rm -rf
    if (process.platform !== 'win32') {
      try {
        childProcess.spawnSync('rm', ['-rf', targetPath], { stdio: 'inherit' })
        return
      } catch {
        // fallthrough to throw original error
      }
    }
    throw err
  }
}

function getBundledNpmCliPath() {
  const nodeBinDir = path.dirname(process.execPath)
  const npmCli = path.resolve(nodeBinDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return fs.existsSync(npmCli) ? npmCli : null
}

function runRuntimeCheck() {
  const checkPath = path.join(__dirname, 'check-runtime.js')
  const darwinArch = getDarwinArchPrefix()
  const command = darwinArch ? darwinArch[0] : process.execPath
  const args = darwinArch ? [...darwinArch.slice(1), process.execPath, checkPath] : [checkPath]
  const result = childProcess.spawnSync(command, args, { stdio: 'inherit' })
  return result.status === 0
}

const nodeMajor = Number(String(process.versions.node).split('.')[0])
if (nodeMajor !== 22) {
  console.error(`\n❌ 当前 Node 版本为 ${process.versions.node}，请切换到 Node 22 后再执行：npm run bootstrap\n`)
  process.exit(1)
}

console.log('\n🧰 Bootstrap')
console.log(`- node: ${process.versions.node}`)
console.log(`- arch: ${process.arch}`)
console.log(`- execPath: ${process.execPath}`)

if (fs.existsSync(path.join(process.cwd(), 'node_modules')) && runRuntimeCheck()) {
  console.log('✅ 依赖与运行时检查均正常，跳过重装\n')
  process.exit(0)
}

console.log('\n🔧 重新安装依赖（同时清理 .next 缓存）...')
rmIfExists(path.join(process.cwd(), 'node_modules'))
rmIfExists(path.join(process.cwd(), '.next'))

const nodeBinDir = path.dirname(process.execPath)
const commonEnv = {
  ...process.env,
  PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH || ''}`,
  npm_config_scripts_prepend_node_path: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
}

const npmCli = getBundledNpmCliPath()
if (npmCli) {
  const darwinArch = getDarwinArchPrefix()
  if (darwinArch) {
    run(darwinArch[0], [...darwinArch.slice(1), process.execPath, npmCli, 'ci'], {
      env: commonEnv,
    })
  } else {
    run(process.execPath, [npmCli, 'ci'], {
      env: commonEnv,
    })
  }
} else {
  run('npm', ['ci'], {
    env: commonEnv,
  })
}

if (!runRuntimeCheck()) {
  process.exit(1)
}

console.log('✅ Bootstrap 完成\n')
