#!/usr/bin/env node

const IS_BUILD_TIME = process.env.NEXT_PHASE === 'phase-production-build' && process.env.SKIP_ENV_VALIDATION !== 'false'
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
const SKIP_VALIDATION = IS_BUILD_TIME || IS_TEST_ENV

console.log('构建环境测试:')
console.log('  NEXT_PHASE:', process.env.NEXT_PHASE)
console.log('  NODE_ENV:', process.env.NODE_ENV)
console.log('  SKIP_ENV_VALIDATION:', process.env.SKIP_ENV_VALIDATION)
console.log('  → SKIP_VALIDATION:', SKIP_VALIDATION)
console.log('')
console.log(SKIP_VALIDATION ? '✅ 构建时跳过验证' : '❌ 构建时不跳过验证（错误）')
