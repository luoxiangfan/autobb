import { syncOpenclawConfig } from './lib/openclaw/config'

async function main() {
  await syncOpenclawConfig({ reason: 'startup-sync' })
}

main().catch((error) => {
  console.error('❌ OpenClaw 配置同步失败:', error)
  process.exit(1)
})

