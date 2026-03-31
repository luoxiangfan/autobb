#!/usr/bin/env node

/**
 * 批量修复剩余12个页面文件的localStorage认证
 */

import fs from 'fs/promises'
import path from 'path'

const files = [
  '/Users/jason/Documents/Kiro/autobb/src/app/admin/backups/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/admin/users/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/campaigns/[id]/ad-groups/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/campaigns/new/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/campaigns/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/change-password/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/creatives/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/google-ads/complete-setup/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/launch-score/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/offers/batch/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/settings/google-ads/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/settings/page.tsx',
]

async function fixFile(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`)

  let content = await fs.readFile(filePath, 'utf-8')
  const original = content
  let changes = 0

  // Pattern 1: 移除token获取和检查
  const pattern1 = /\s+const token = localStorage\.getItem\('auth_token'\)\s+if \(!token\) \{\s+router\.push\('\/login'\)\s+return\s+\}/g
  const matches1 = content.match(pattern1)
  if (matches1) {
    content = content.replace(pattern1, '\n      // HttpOnly Cookie自动携带，无需手动操作')
    changes += matches1.length
  }

  // Pattern 2: 移除Authorization header
  const pattern2 = /\s+Authorization:\s*`Bearer \$\{token\}`,?\s*/g
  const matches2 = content.match(pattern2)
  if (matches2) {
    content = content.replace(pattern2, '\n')
    changes += matches2.length
  }

  // Pattern 3: 添加credentials: 'include'到fetch调用
  // 查找没有credentials的fetch调用并添加
  const fetchPattern = /fetch\(([^,)]+),\s*\{([^}]+)\}\)/g
  let fetchMatches = []
  let match
  while ((match = fetchPattern.exec(content)) !== null) {
    fetchMatches.push({ full: match[0], url: match[1], options: match[2], index: match.index })
  }

  // 从后往前替换，避免索引问题
  for (let i = fetchMatches.length - 1; i >= 0; i--) {
    const m = fetchMatches[i]
    if (!m.options.includes('credentials')) {
      // 在headers后添加credentials
      const newOptions = m.options.replace(
        /(headers:\s*\{[^}]+\}),?/,
        '$1,\n        credentials: \'include\', // 确保发送cookie'
      )

      // 如果没有headers，在method后添加
      let finalOptions = newOptions
      if (!newOptions.includes('credentials')) {
        finalOptions = m.options.replace(
          /(method:\s*'[^']+'),?/,
          '$1,\n        credentials: \'include\', // 确保发送cookie'
        )
      }

      // 如果既没有headers也没有method，直接添加
      if (!finalOptions.includes('credentials') && m.options.trim()) {
        finalOptions = m.options + ',\n        credentials: \'include\', // 确保发送cookie'
      }

      if (finalOptions !== m.options) {
        const newFetch = `fetch(${m.url}, {${finalOptions}})`
        content = content.substring(0, m.index) + newFetch + content.substring(m.index + m.full.length)
        changes++
      }
    }
  }

  // 写回文件
  if (content !== original) {
    await fs.writeFile(filePath, content, 'utf-8')
    console.log(`  ✅ Fixed ${changes} authentication issues`)
    return { file: filePath, changes }
  } else {
    console.log(`  ⏭️  No changes needed`)
    return { file: filePath, changes: 0 }
  }
}

async function main() {
  console.log('🚀 Starting batch localStorage to HttpOnly Cookie migration...\n')

  const results = []

  for (const file of files) {
    try {
      const result = await fixFile(file)
      results.push(result)
    } catch (error) {
      console.error(`  ❌ Error processing ${file}:`, error.message)
      results.push({ file, changes: 0, error: error.message })
    }
    console.log('')
  }

  // 统计结果
  const totalChanges = results.reduce((sum, r) => sum + r.changes, 0)
  const fixedFiles = results.filter(r => r.changes > 0).length
  const errors = results.filter(r => r.error).length

  console.log('📊 Migration Summary:')
  console.log(`  Total files processed: ${files.length}`)
  console.log(`  Files fixed: ${fixedFiles}`)
  console.log(`  Total changes: ${totalChanges}`)
  console.log(`  Errors: ${errors}`)

  if (fixedFiles > 0) {
    console.log('\n✅ Migration completed successfully!')
  } else {
    console.log('\n⚠️  No files needed fixing')
  }
}

main().catch(console.error)
