import {
  PERFORMANCE_RELEASE_FLAGS,
  getPerformanceReleaseSnapshot,
  type PerformanceReleaseFlagName,
  validatePerformanceReleaseDependencies,
} from '../src/lib/feature-flags'

type GovernanceCommand = 'check' | 'rollback-template' | 'drill'

const CORE_ROLLBACK_FLAGS: PerformanceReleaseFlagName[] = [
  'navLink',
  'dashboardDefer',
  'campaignsParallel',
  'offersIncrementalPoll',
  'offersServerPaging',
  'campaignsReqDedup',
  'campaignsServerPaging',
  'kpiShortTtl',
]

function parseCommand(raw?: string): GovernanceCommand {
  if (raw === 'rollback-template') return raw
  if (raw === 'drill') return raw
  return 'check'
}

function parseArgs(argv: string[]): {
  command: GovernanceCommand
  includeMonitoring: boolean
} {
  const command = parseCommand(argv[2])
  const includeMonitoring = argv.includes('--all')
  return { command, includeMonitoring }
}

function printSnapshot(): void {
  const snapshot = getPerformanceReleaseSnapshot()
  const flagNames = Object.keys(PERFORMANCE_RELEASE_FLAGS) as PerformanceReleaseFlagName[]

  console.log('[performance-release] flag snapshot')
  flagNames.forEach((name) => {
    const config = PERFORMANCE_RELEASE_FLAGS[name]
    const current = snapshot[name]
    const deps = config.dependsOn.length > 0 ? config.dependsOn.join(',') : '-'
    console.log(
      `- ${name}: enabled=${current.enabled ? 'true' : 'false'} source=${current.source} env=${config.envKey} owner=${config.owner} removeAfter=${config.removeAfter} deps=${deps}`
    )
  })
}

function runDependencyCheck(strict: boolean): boolean {
  const result = validatePerformanceReleaseDependencies()
  if (!result.valid) {
    console.error('[performance-release] dependency validation failed:')
    result.issues.forEach((issue) => {
      console.error(`  - ${issue}`)
    })
    if (strict) {
      process.exitCode = 1
      return false
    }
  } else {
    console.log('[performance-release] dependency validation passed')
  }
  return result.valid
}

function printRollbackTemplate(includeMonitoring: boolean): void {
  const flagNames = includeMonitoring
    ? (Object.keys(PERFORMANCE_RELEASE_FLAGS) as PerformanceReleaseFlagName[])
    : CORE_ROLLBACK_FLAGS

  const exports = flagNames.map((name) => {
    const envKey = PERFORMANCE_RELEASE_FLAGS[name].envKey
    return `${envKey}=0`
  })

  console.log('[performance-release] rollback env template')
  console.log(exports.join(' '))
  console.log('')
  console.log('[performance-release] example (temporary process-level rollback):')
  console.log(`${exports.join(' ')} npm run start`)
}

function runDrill(includeMonitoring: boolean): void {
  printSnapshot()
  const valid = runDependencyCheck(false)
  printRollbackTemplate(includeMonitoring)
  console.log('')
  console.log('[performance-release] drill checklist')
  console.log('1. Run: npm run perf:flags:check')
  console.log('2. Save current runtime env snapshot')
  console.log('3. Prepare rollback env from template above')
  console.log('4. Execute smoke tests on dashboard/offers/campaigns/products')
  console.log('5. If KPI error or API p95 exceeds threshold, apply rollback env immediately')
  console.log('6. Record incident timeline using runbooks template')
  if (!valid) {
    process.exitCode = 1
  }
}

function main() {
  const { command, includeMonitoring } = parseArgs(process.argv)

  if (command === 'check') {
    printSnapshot()
    runDependencyCheck(true)
    return
  }

  if (command === 'rollback-template') {
    printRollbackTemplate(includeMonitoring)
    return
  }

  runDrill(includeMonitoring)
}

main()
