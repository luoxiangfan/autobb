import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'api')

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, files)
    else if (ent.name === 'route.ts') files.push(p)
  }
  return files
}

function ensureImport(content) {
  if (!content.includes('verifyAuth')) return content
  if (/from ['"]@\/lib\/auth['"]/.test(content)) return content
  const importLine = "import { verifyAuth } from '@/lib/auth'\n"
  const nextImport = content.match(/^import .+ from .+$/m)
  if (nextImport) {
    const idx = content.indexOf(nextImport[0])
    return content.slice(0, idx) + importLine + content.slice(idx)
  }
  return importLine + content
}

function migrate(content) {
  let out = content.replace(/\r\n/g, '\n')

  // Admin: role-only check (no userId guard)
  out = out.replace(
    /[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*const userRole = \1\.headers\.get\('x-user-role'\)\s*\n\s*\n[ \t]*\/\/[^\n]*\n[ \t]*if \(userRole !== 'admin'\)/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    if (authResult.user.role !== 'admin')`
  )

  // Semicolon style + userIdNum = parseInt(userId)
  out = out.replace(
    /[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\);\s*\n[ \t]*if \(!userId\) \{\s*\n[ \t]*return NextResponse\.json\(\s*\n[ \t]*\{ error: 'unauthorized', message: '未登录' \},\s*\n[ \t]*\{ status: 401 \}\s*\n[ \t]*\);\s*\n[ \t]*\}\s*\n\s*\n[ \t]*const userIdNum = parseInt\(userId\);/g,
    `    const authResult = await verifyAuth($1);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'unauthorized', message: authResult.error || '未登录' },
        { status: 401 }
      );
    }
    const userIdNum = authResult.user.userId;`
  )

  // One-liner unauthorized
  out = out.replace(
    /[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*if \(!userId\) return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)\s*\n\s*\n[ \t]*const numericUserId = userId\s*\n[ \t]*if \(!Number\.isFinite\(numericUserId\)\) return NextResponse\.json\(\{ error: '未授权' \}, \{ status: 401 \}\)/g,
    `    const authResult = await verifyAuth($1)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const numericUserId = authResult.user.userId`
  )

  // Optional userId header (settings GET)
  out = out.replace(
    /[ \t]*\/\/[^\n]*\n[ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*\n[ \t]*const userIdNum = userId \? userId : undefined/g,
    `    const authResult = await verifyAuth($1)
    const userIdNum = authResult.authenticated && authResult.user ? authResult.user.userId : undefined`
  )

  // Remaining: const userId = header only line (used later) -> need verifyAuth at start of try
  out = out.replace(
    /([ \t]*const userId = (request|req)\.headers\.get\('x-user-id'\)\s*;?\s*\n)/g,
    (match, _full, reqVar) => {
      if (match.includes('verifyAuth')) return match
      return `    const authResult = await verifyAuth(${reqVar});
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 });
    }
    const userId = authResult.user.userId;
`
    }
  )

  out = out.replace(/[ \t]*const userRole = (request|req)\.headers\.get\('x-user-role'\)\s*;?\s*\n/g, '')

  out = out.replace(/parseInt\(userId\)/g, 'userId')
  out = out.replace(/parseInt\(userId,\s*10\)/g, 'userId')

  if (content.includes('\r\n')) out = out.replace(/\n/g, '\r\n')
  return ensureImport(out)
}

let changed = 0
const remaining = []
for (const file of walk(apiRoot)) {
  const raw = fs.readFileSync(file, 'utf8')
  if (!raw.includes("headers.get('x-user-id')") && !raw.includes("headers.get('x-user-role')")) continue
  const next = migrate(raw)
  if (next !== raw) {
    fs.writeFileSync(file, next)
    changed++
  }
  const check = fs.readFileSync(file, 'utf8')
  if (check.includes("headers.get('x-user-id')") || check.includes("headers.get('x-user-role')")) {
    remaining.push(path.relative(apiRoot, file))
  }
}
console.log(`Pass2 updated ${changed} files.`)
if (remaining.length) {
  console.log('Still remaining:', remaining.length)
  remaining.forEach((f) => console.log(' ', f))
}
