/**
 * 调度器和数据库初始化脚本打包
 * 使用esbuild将TypeScript文件打包为单个JS文件
 */

const esbuild = require('esbuild')
const path = require('path')

async function buildScheduler() {
  console.log('📦 开始打包调度器...')

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'scheduler.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(__dirname, 'dist', 'scheduler.js'),
      external: [
        // 排除需要原生模块的依赖
        'better-sqlite3',
        'bcrypt',
        // 排除Playwright相关依赖（避免打包问题）
        'playwright',
        'playwright-core',
        'chromium-bidi',
      ],
      minify: false, // 保持可读性，便于调试
      sourcemap: false,
      logLevel: 'info',
    })

    console.log('✅ 调度器打包完成: dist/scheduler.js')
  } catch (error) {
    console.error('❌ 调度器打包失败:', error)
    process.exit(1)
  }
}

async function buildBackgroundWorker() {
  console.log('📦 开始打包后台队列Worker...')

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'background-worker.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(__dirname, 'dist', 'background-worker.js'),
      external: [
        // 排除需要原生模块的依赖
        'better-sqlite3',
        'bcrypt',
        // 排除Playwright相关依赖（避免打包问题）
        'playwright',
        'playwright-core',
        'chromium-bidi',
      ],
      minify: false, // 保持可读性，便于调试
      sourcemap: false,
      logLevel: 'info',
    })

    console.log('✅ 后台队列Worker打包完成: dist/background-worker.js')
  } catch (error) {
    console.error('❌ 后台队列Worker打包失败:', error)
    process.exit(1)
  }
}

async function buildDbInit() {
  console.log('📦 开始打包数据库初始化脚本...')

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'scripts', 'db-init.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(__dirname, 'dist', 'db-init.js'),
      external: [
        // 排除需要原生模块的依赖
        'better-sqlite3',
        'bcrypt',
      ],
      minify: false,
      sourcemap: false,
      logLevel: 'info',
    })

    console.log('✅ 数据库初始化脚本打包完成: dist/db-init.js')
  } catch (error) {
    console.error('❌ 数据库初始化脚本打包失败:', error)
    process.exit(1)
  }
}

async function buildOpenclawSync() {
  console.log('📦 开始打包 OpenClaw 配置同步脚本...')

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'openclaw-sync.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(__dirname, 'dist', 'openclaw-sync.js'),
      external: [
        // 排除需要原生模块的依赖
        'better-sqlite3',
        'bcrypt',
        // 排除Playwright相关依赖（避免打包问题）
        'playwright',
        'playwright-core',
        'chromium-bidi',
      ],
      minify: false,
      sourcemap: false,
      logLevel: 'info',
    })

    console.log('✅ OpenClaw 配置同步脚本打包完成: dist/openclaw-sync.js')
  } catch (error) {
    console.error('❌ OpenClaw 配置同步脚本打包失败:', error)
    process.exit(1)
  }
}

async function main() {
  await buildScheduler()
  await buildBackgroundWorker()
  await buildDbInit()
  await buildOpenclawSync()
  console.log('')
  console.log('🎉 所有脚本打包完成！')
}

main()
