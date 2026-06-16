#!/usr/bin/env node
/**
 * Migrate @/lib/{keywords,creatives,ai} barrel imports to /server variants
 * in server-side code (API routes, lib, non-client app files).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const src = path.join(root, 'src')

const BARRELS = ['keywords', 'creatives', 'ai']

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist'])

function isClientFile(content) {
  return /^['"]use client['"]\s*;?\s*$/m.test(content.slice(0, 300))
}

function shouldSkipFile(relPath) {
  if (/\/keywords\/(index|server)\.ts$/.test(relPath)) return true
  if (/\/creatives\/(index|server)\.ts$/.test(relPath)) return true
  if (/\/ai\/(index|server)\.ts$/.test(relPath)) return true
  if (relPath.startsWith('components/')) return true
  return false
}

function migrateContent(content) {
  let next = content
  let changed = false

  for (const barrel of BARRELS) {
    const aliasFrom = `from '@/lib/${barrel}'`
    const aliasTo = `from '@/lib/${barrel}/server'`
    if (next.includes(aliasFrom)) {
      next = next.split(aliasFrom).join(aliasTo)
      changed = true
    }

    for (const depth of ['../', '../../', '../../../']) {
      const relFrom = `from '${depth}${barrel}'`
      const relTo = `from '${depth}${barrel}/server'`
      if (next.includes(relFrom)) {
        next = next.split(relFrom).join(relTo)
        changed = true
      }
    }
  }

  return { content: next, changed }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

let updated = 0
for (const file of walk(src)) {
  const relPath = path.relative(src, file).replace(/\\/g, '/')
  if (shouldSkipFile(relPath)) continue

  const content = fs.readFileSync(file, 'utf8')
  if (isClientFile(content)) continue

  const { content: next, changed } = migrateContent(content)
  if (changed && next !== content) {
    fs.writeFileSync(file, next, 'utf8')
    updated++
    console.log(`updated ${relPath}`)
  }
}

console.log(`migrate-keywords-creatives-ai-server-imports: ${updated} file(s) updated`)
