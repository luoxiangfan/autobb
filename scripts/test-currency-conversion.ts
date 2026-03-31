#!/usr/bin/env tsx
/**
 * 测试货币转换逻辑
 * 验证多货币场景下的总花费计算是否正确
 */

import { convertCurrency, EXCHANGE_RATES } from '@/lib/currency'

console.log('🧪 测试货币转换逻辑\n')

// 测试场景：$978.26 + ¥45.15
const usdAmount = 978.26
const cnyAmount = 45.15

console.log('📊 原始数据:')
console.log(`  USD: $${usdAmount}`)
console.log(`  CNY: ¥${cnyAmount}`)
console.log(`  CNY汇率: ${EXCHANGE_RATES.CNY} (1 USD = ${EXCHANGE_RATES.CNY} CNY)\n`)

// 错误的计算方式（直接相加）
const wrongTotal = usdAmount + cnyAmount
console.log('❌ 错误的计算方式（直接相加）:')
console.log(`  $${usdAmount} + ¥${cnyAmount} = $${wrongTotal.toFixed(2)}\n`)

// 正确的计算方式（先转换为USD再相加）
const cnyInUsd = convertCurrency(cnyAmount, 'CNY', 'USD')
const correctTotal = usdAmount + cnyInUsd

console.log('✅ 正确的计算方式（先转换为USD再相加）:')
console.log(`  ¥${cnyAmount} → $${cnyInUsd.toFixed(2)}`)
console.log(`  $${usdAmount} + $${cnyInUsd.toFixed(2)} = $${correctTotal.toFixed(2)}\n`)

console.log('📈 差异分析:')
console.log(`  错误结果: $${wrongTotal.toFixed(2)}`)
console.log(`  正确结果: $${correctTotal.toFixed(2)}`)
console.log(`  差异: $${Math.abs(wrongTotal - correctTotal).toFixed(2)}`)
console.log(`  错误率: ${((Math.abs(wrongTotal - correctTotal) / correctTotal) * 100).toFixed(2)}%\n`)

console.log('✅ 测试完成！')
