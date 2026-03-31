#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const prebuiltDir = path.join(rootDir, 'openclaw-prebuilt')
const openclawDir = path.join(rootDir, 'openclaw')
const metaFile = path.join(prebuiltDir, '.build-meta.json')
const sourceCommitPinFile = path.join(openclawDir, '.source-commit')
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (error) {
    fail(`无法解析 JSON: ${filePath} (${error.message})`)
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    fail(`无法读取文件: ${filePath} (${error.message})`)
  }
}

if (!fs.existsSync(metaFile)) {
  fail('openclaw-prebuilt/.build-meta.json 不存在')
}

const meta = readJson(metaFile)
const sourceVersion = String(meta.source_version || '').trim()
const sourceCommit = String(meta.source_commit || '').trim()
const builtAt = String(meta.built_at || '').trim()

if (!sourceVersion || !sourceCommit || !builtAt) {
  fail('openclaw-prebuilt/.build-meta.json 缺少必填字段(source_version/source_commit/built_at)')
}
if (!COMMIT_SHA_RE.test(sourceCommit)) {
  fail(`openclaw-prebuilt/.build-meta.json source_commit 非法: ${sourceCommit}`)
}

const openclawPackageJson = path.join(openclawDir, 'package.json')
if (!fs.existsSync(openclawPackageJson)) {
  fail('openclaw/package.json 不存在，无法校验预编译版本来源')
}

const openclawPackage = readJson(openclawPackageJson)
const openclawVersion = String(openclawPackage.version || '').trim()
if (!openclawVersion) {
  fail('openclaw/package.json 缺少 version 字段')
}

if (openclawVersion !== sourceVersion) {
  fail(`openclaw-prebuilt 版本不一致: meta=${sourceVersion}, source=${openclawVersion}`)
}

const sourceCommitFromPin = fs.existsSync(sourceCommitPinFile)
  ? String(readText(sourceCommitPinFile) || '').trim()
  : ''

if (sourceCommitFromPin && !COMMIT_SHA_RE.test(sourceCommitFromPin)) {
  fail(`openclaw/.source-commit 非法: ${sourceCommitFromPin}`)
}

let sourceCommitFromGit = ''
const openclawGitDir = path.join(openclawDir, '.git')
if (fs.existsSync(openclawGitDir)) {
  try {
    sourceCommitFromGit = execSync('git -C openclaw rev-parse HEAD', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim()
  } catch (error) {
    fail(`无法读取 openclaw 源码 commit: ${error.message}`)
  }
}

if (sourceCommitFromGit && !COMMIT_SHA_RE.test(sourceCommitFromGit)) {
  fail(`openclaw git commit 非法: ${sourceCommitFromGit}`)
}

if (sourceCommitFromGit && sourceCommitFromPin && sourceCommitFromGit !== sourceCommitFromPin) {
  fail(`openclaw commit pin 与 git HEAD 不一致: pin=${sourceCommitFromPin}, git=${sourceCommitFromGit}`)
}

const resolvedSourceCommit = sourceCommitFromGit || sourceCommitFromPin
if (!resolvedSourceCommit) {
  fail('无法确定 openclaw 源码 commit：缺少 openclaw/.git 且未提供 openclaw/.source-commit')
}

if (resolvedSourceCommit !== sourceCommit) {
  fail(`openclaw-prebuilt commit 不一致: meta=${sourceCommit}, source=${resolvedSourceCommit}`)
}

console.log('✅ OpenClaw 预编译元数据校验通过')
