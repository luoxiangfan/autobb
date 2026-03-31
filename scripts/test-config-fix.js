#!/usr/bin/env node

// 测试修复后的配置逻辑

const IS_BUILD_TIME = process.env.NEXT_PHASE === 'phase-production-build' && process.env.NODE_ENV !== 'production';
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const SKIP_VALIDATION = IS_BUILD_TIME || IS_TEST_ENV;

console.log('环境变量:');
console.log('  NEXT_PHASE:', process.env.NEXT_PHASE);
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('');
console.log('检测结果:');
console.log('  IS_BUILD_TIME:', IS_BUILD_TIME);
console.log('  IS_TEST_ENV:', IS_TEST_ENV);
console.log('  SKIP_VALIDATION:', SKIP_VALIDATION);
console.log('');

function getRequiredEnvVar(name, minLength) {
  const value = process.env[name];

  if (SKIP_VALIDATION) {
    console.log('⚠️  SKIP_VALIDATION=true, 返回占位符');
    return 'placeholder-for-build-or-test'.padEnd(minLength || 32, '0');
  }

  if (!value) {
    throw new Error('Missing: ' + name);
  }

  return value;
}

const key = getRequiredEnvVar('ENCRYPTION_KEY', 64);
console.log('结果:');
console.log('  返回的 ENCRYPTION_KEY:', key.substring(0, 20) + '...');
console.log('  长度:', key.length);

if (key.startsWith('placeholder')) {
  console.log('  ❌ 使用占位符密钥（BUG）');
} else {
  console.log('  ✅ 使用真实密钥');
}
