/**
 * One-off: replace x-user-id / x-user-role header auth with verifyAuth in API routes.
 * Run: node scripts/migrate-route-auth-to-verify-auth.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.join(__dirname, '..', 'src', 'app', 'api')

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, files)
    else if (ent.name === 'route.ts') files.push(p)
  }
  return files
}

function ensureVerifyAuthImport(content) {
  if (content.includes('verifyAuth')) {
    if (/import\s*\{[^}]*verifyAuth/.test(content)) return content
    return content.replace(
      /import\s*\{([^}]+)\}\s*from\s*'@\/lib\/auth'/,
      (m, imports) => {
        const trimmed = imports.trim()
        if (trimmed.includes('verifyAuth')) return m
        return `import { ${trimmed}, verifyAuth } from '@/lib/auth'`
      }
    )
  }
  const importLine = "import { verifyAuth } from '@/lib/auth'\n"
  const nextImport = content.match(/^import .+ from .+$/m)
  if (nextImport) {
    const idx = content.indexOf(nextImport[0])
    return content.slice(0, idx) + importLine + content.slice(idx)
  }
  return importLine + content
}

function migrateContent(content) {
  if (!content.includes("headers.get('x-user-id')") && !content.includes('headers.get("x-user-id")')) {
    return null
  }

  // Normalize CRLF for regex
  let out = content.replace(/\r\n/g, '\n')

  // Admin: userId + userRole headers
  out = out.replace(
    /[ \t]*\/\/[^\n]*\n[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*const userRole = \1\.headers\.get\('x-user-role'\)\s*\n\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*\n[ \t]*\}\s*\n\s*\n[ \t]*if \(userRole !== 'admin'\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '需要管理员权限' \}, \{ status: 403 \}\)\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }`
  )

  out = out.replace(
    /[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*;\s*\n[ \t]*const userRole = \1\.headers\.get\('x-user-role'\)\s*;\s*\n\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*;\s*\n[ \t]*\}\s*\n\s*\n[ \t]*if \(userRole !== 'admin'\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '需要管理员权限' \}, \{ status: 403 \}\)\s*;\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }`
  )

  // userIdRaw + Number validation
  out = out.replace(
    /[ \t]*const userIdRaw = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userIdRaw\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*\n[ \t]*\}\s*\n[ \t]*const userId = Number\(userIdRaw\)\s*\n[ \t]*if \(!Number\.isFinite\(userId\) \|\| userId <= 0\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId`
  )

  // userId + userIdNum = parseInt
  out = out.replace(
    /[ \t]*const userId = (req|request)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return (NextResponse\.json|new Response)\([\s\S]*?\{ status: 401[\s\S]*?\)\s*\n[ \t]*\}\s*\n[ \t]*const userIdNum = parseInt\(userId, 10\)/g,
    (m, reqVar, retKind) => {
      const isNext = retKind.includes('NextResponse')
      const block = isNext
        ? `    const authResult = await verifyAuth(${reqVar})
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = authResult.user.userId`
        : `    const authResult = await verifyAuth(${reqVar})
    if (!authResult.authenticated || !authResult.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: '请先登录' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const userIdNum = authResult.user.userId`
      return block
    }
  )

  // Generic: const userId = ...headers... if (!userId) return NextResponse 401
  out = out.replace(
    /[ \t]*(?:\/\/[^\n]*\n)?[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId`
  )

  out = out.replace(
    /[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*;\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*;\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId`
  )

  // Unauthorized / 请先登录 variants
  out = out.replace(
    /[ \t]*const userId = (req|request)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\s*\n[ \t]*\{ error: 'Unauthorized', message: '请先登录' \},\s*\n[ \t]*\{ status: 401 \}\s*\n[ \t]*\)\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: authResult.error || '请先登录' },
        { status: 401 }
      )
    }
    const userId = authResult.user.userId`
  )

  // Stream Response variant
  out = out.replace(
    /[ \t]*const userId = (req|request)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return new Response\(\s*\n[ \t]*JSON\.stringify\(\{ error: 'Unauthorized', message: '请先登录' \}\),\s*\n[ \t]*\{ status: 401, headers: \{ 'Content-Type': 'application\/json' \} \}\s*\n[ \t]*\)\s*\n[ \t]*\}/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: authResult.error || '请先登录' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const userId = authResult.user.userId`
  )

  // Remaining simple header reads (per-handler, may need manual follow-up)
  if (out.includes("headers.get('x-user-id')")) {
    console.warn('  still has x-user-id header reads — needs manual fix')
  }

  // userId was string; fix parseInt(userId) -> userId
  out = out.replace(/parseInt\(userId,\s*10\)/g, 'userId')
  out = out.replace(/Number\(userId\)/g, 'userId')
  out = out.replace(/parseInt\(userIdHeader,\s*10\)/g, 'userId')

  out = ensureVerifyAuthImport(out)
  // Restore CRLF if original used it
  if (content.includes('\r\n')) {
    out = out.replace(/\n/g, '\r\n')
  }
  return out
}

const files = walk(apiRoot)
let changed = 0
let manual = []

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  if (!content.includes("headers.get('x-user-id')") && !content.includes("headers.get('x-user-role')")) {
    continue
  }
  const migrated = migrateContent(content)
  if (!migrated || migrated === content) {
    if (content.includes("headers.get('x-user-id')") || content.includes("headers.get('x-user-role')")) {
      manual.push(path.relative(apiRoot, file))
    }
    continue
  }
  fs.writeFileSync(file, migrated)
  changed++
  if (migrated.includes("headers.get('x-user-id')") || migrated.includes("headers.get('x-user-role')")) {
    manual.push(path.relative(apiRoot, file))
  }
}

console.log(`Updated ${changed} route files.`)
if (manual.length) {
  console.log('Manual follow-up needed:')
  manual.forEach((f) => console.log('  -', f))
}
