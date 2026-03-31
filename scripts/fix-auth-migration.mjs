#!/usr/bin/env node

/**
 * 批量迁移localStorage认证到HttpOnly Cookie认证
 *
 * 修复模式：
 * 1. 移除 localStorage.getItem('auth_token')
 * 2. 移除 token检查和重定向逻辑
 * 3. 移除 Authorization header
 * 4. 添加 credentials: 'include'
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
  '/Users/jason/Documents/Kiro/autobb/src/app/dashboard/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/google-ads/complete-setup/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/launch-score/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/offers/batch/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/settings/google-ads/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/app/settings/page.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/components/AdjustCpcModal.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/components/ChangePasswordModal.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/components/LaunchAdModal.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/components/admin/UserCreateModal.tsx',
  '/Users/jason/Documents/Kiro/autobb/src/components/admin/UserEditModal.tsx',
]

async function fixFile(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`)

  let content = await fs.readFile(filePath, 'utf-8')
  const original = content

  // 统计修改次数
  let changes = 0

  // Pattern 1: 移除 token 获取和检查（单独的函数内）
  // const token = localStorage.getItem('auth_token')
  // if (!token) {
  //   router.push('/login')
  //   return
  // }
  const pattern1 = /const token = localStorage\.getItem\('auth_token'\)\s+if \(!token\) \{\s+router\.push\('\/login'\)\s+return\s+\}/g
  if (pattern1.test(content)) {
    content = content.replace(pattern1, '// HttpOnly Cookie自动携带，无需手动操作')
    changes++
  }

  // Pattern 2: 在fetch调用中移除 Authorization header
  // Authorization: `Bearer ${token}`,
  const pattern2 = /Authorization:\s*`Bearer \$\{token\}`,?\s*/g
  const matches2 = content.match(pattern2)
  if (matches2) {
    content = content.replace(pattern2, '')
    changes += matches2.length
  }

  // Pattern 3: 在没有credentials的fetch中添加 credentials: 'include'
  // 查找 fetch( 后面的对象，如果没有 credentials，就添加
  const fetchPattern = /fetch\([^,]+,\s*\{([^}]+)\}/g
  content = content.replace(fetchPattern, (match, options) => {
    if (!options.includes('credentials')) {
      // 找到headers的位置，在其后添加credentials
      if (options.includes('headers:')) {
        const updatedOptions = options.replace(
          /(headers:\s*\{[^}]+\}),?/,
          '$1,\n      credentials: \'include\', // 确保发送cookie'
        )
        changes++
        return match.replace(options, updatedOptions)
      } else {
        // 如果没有headers，在method后添加credentials
        const updatedOptions = options.replace(
          /(method:\s*'[^']+'),?/,
          '$1,\n      credentials: \'include\', // 确保发送cookie'
        )
        changes++
        return match.replace(options, updatedOptions)
      }
    }
    return match
  })

  // 如果内容有变化，写回文件
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
  console.log('🚀 Starting localStorage to HttpOnly Cookie migration...\n')

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
