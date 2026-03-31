/**
 * A/B测试监控逻辑单元测试
 *
 * 测试覆盖:
 * 1. Z-test统计显著性计算
 * 2. 正态分布CDF计算
 * 3. CPC改进率计算
 * 4. 边界条件处理
 */

// Mock expect函数（如果没有测试框架）
if (typeof expect === 'undefined') {
  (global as any).expect = (value: any) => ({
    toBe: (expected: any) => {
      if (value !== expected) {
        throw new Error(`Expected ${value} to be ${expected}`)
      }
    },
    toBeCloseTo: (expected: number, precision: number = 2) => {
      const factor = Math.pow(10, precision)
      const roundedValue = Math.round(value * factor) / factor
      const roundedExpected = Math.round(expected * factor) / factor
      if (roundedValue !== roundedExpected) {
        throw new Error(`Expected ${value} to be close to ${expected} (precision ${precision})`)
      }
    },
    toBeGreaterThan: (expected: number) => {
      if (value <= expected) {
        throw new Error(`Expected ${value} to be greater than ${expected}`)
      }
    },
    toBeLessThan: (expected: number) => {
      if (value >= expected) {
        throw new Error(`Expected ${value} to be less than ${expected}`)
      }
    },
    toBeGreaterThanOrEqual: (expected: number) => {
      if (value < expected) {
        throw new Error(`Expected ${value} to be greater than or equal to ${expected}`)
      }
    },
    toBeLessThanOrEqual: (expected: number) => {
      if (value > expected) {
        throw new Error(`Expected ${value} to be less than or equal to ${expected}`)
      }
    },
    toBeDefined: () => {
      if (value === undefined) {
        throw new Error('Expected value to be defined')
      }
    }
  })
}

// Mock describe函数
if (typeof describe === 'undefined') {
  (global as any).describe = (name: string, fn: () => void) => {
    console.log(`\n${name}`)
    fn()
  }
}

// Mock it函数
if (typeof it === 'undefined') {
  (global as any).it = (name: string, fn: () => void) => {
    try {
      fn()
      console.log(`  ✓ ${name}`)
    } catch (error: any) {
      console.log(`  ✗ ${name}`)
      console.error(`    ${error.message}`)
    }
  }
}

// 从监控模块导入函数（需要将函数export）
// 暂时在测试文件中重新实现，方便测试

// Z-test计算（判断统计显著性）
function calculateZTest(
  conversions1: number,
  total1: number,
  conversions2: number,
  total2: number,
  confidenceLevel: number = 0.95
): {
  z: number
  pValue: number
  isSignificant: boolean
  confidenceIntervalLower: number
  confidenceIntervalUpper: number
} {
  if (total1 === 0 || total2 === 0) {
    return {
      z: 0,
      pValue: 1,
      isSignificant: false,
      confidenceIntervalLower: 0,
      confidenceIntervalUpper: 0
    }
  }

  const p1 = conversions1 / total1
  const p2 = conversions2 / total2
  const pPool = (conversions1 + conversions2) / (total1 + total2)

  const se = Math.sqrt(pPool * (1 - pPool) * (1 / total1 + 1 / total2))

  if (se === 0) {
    return {
      z: 0,
      pValue: 1,
      isSignificant: false,
      confidenceIntervalLower: p1 - p2,
      confidenceIntervalUpper: p1 - p2
    }
  }

  const z = (p1 - p2) / se
  const pValue = 2 * (1 - normalCDF(Math.abs(z)))

  // 置信区间
  const zScore = 1.96 // 95% confidence
  const ciMargin = zScore * se

  return {
    z,
    pValue,
    isSignificant: pValue < (1 - confidenceLevel),
    confidenceIntervalLower: (p1 - p2) - ciMargin,
    confidenceIntervalUpper: (p1 - p2) + ciMargin
  }
}

// 标准正态分布累积分布函数
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))

  return x > 0 ? 1 - prob : prob
}

// CPC改进率计算
function calculateCPCImprovement(cpcControl: number, cpcVariant: number): number {
  if (cpcControl === 0) return 0
  return ((cpcControl - cpcVariant) / cpcControl) * 100
}

// CTR改进率计算
function calculateCTRImprovement(ctrControl: number, ctrVariant: number): number {
  if (ctrControl === 0) return 0
  return ((ctrVariant - ctrControl) / ctrControl) * 100
}

describe('A/B测试监控逻辑单元测试', () => {

  describe('normalCDF - 正态分布累积分布函数', () => {

    it('应该正确计算标准正态分布的值', () => {
      // 标准正态分布的已知值
      const result0 = normalCDF(0)
      expect(result0).toBeCloseTo(0.5, 2) // P(Z <= 0) = 0.5

      const result1 = normalCDF(1)
      expect(result1).toBeCloseTo(0.8413, 3) // P(Z <= 1) ≈ 0.8413

      const result_minus1 = normalCDF(-1)
      expect(result_minus1).toBeCloseTo(0.1587, 3) // P(Z <= -1) ≈ 0.1587

      const result2 = normalCDF(2)
      expect(result2).toBeCloseTo(0.9772, 3) // P(Z <= 2) ≈ 0.9772
    })

    it('应该处理极端值', () => {
      const resultLarge = normalCDF(10)
      expect(resultLarge).toBeCloseTo(1, 2) // 接近1

      const resultSmall = normalCDF(-10)
      expect(resultSmall).toBeCloseTo(0, 2) // 接近0
    })

    it('应该对称分布', () => {
      const value = 1.5
      const resultPos = normalCDF(value)
      const resultNeg = normalCDF(-value)

      expect(resultPos + resultNeg).toBeCloseTo(1, 5) // 对称性
    })
  })

  describe('calculateZTest - Z检验统计显著性', () => {

    it('应该正确识别显著差异（95%置信度）', () => {
      // Variant A: 140/5000 = 2.8% CTR
      // Control: 100/5000 = 2.0% CTR
      // 差异显著（40%提升）

      const result = calculateZTest(140, 5000, 100, 5000, 0.95)

      expect(result.z).toBeGreaterThan(0) // Z值为正（variant更好）
      expect(result.pValue).toBeLessThan(0.05) // p < 0.05，显著
      expect(result.isSignificant).toBe(true) // 结果显著
      expect(result.confidenceIntervalLower).toBeGreaterThan(0) // 置信区间下界 > 0
    })

    it('应该正确识别无显著差异', () => {
      // 差异很小的情况
      // Variant: 101/5000 = 2.02% CTR
      // Control: 100/5000 = 2.00% CTR

      const result = calculateZTest(101, 5000, 100, 5000, 0.95)

      expect(result.pValue).toBeGreaterThan(0.05) // p > 0.05，不显著
      expect(result.isSignificant).toBe(false) // 结果不显著
    })

    it('应该处理零样本情况', () => {
      const result = calculateZTest(10, 0, 20, 100, 0.95)

      expect(result.z).toBe(0)
      expect(result.pValue).toBe(1)
      expect(result.isSignificant).toBe(false)
    })

    it('应该处理相同转化率情况', () => {
      // 转化率完全相同
      const result = calculateZTest(50, 1000, 50, 1000, 0.95)

      expect(result.z).toBeCloseTo(0, 2)
      expect(result.pValue).toBeCloseTo(1, 1)
      expect(result.isSignificant).toBe(false)
    })

    it('应该计算正确的置信区间', () => {
      const result = calculateZTest(150, 1000, 100, 1000, 0.95)

      // 置信区间应该包含真实差异
      const trueDiff = (150/1000) - (100/1000) // 0.05
      expect(result.confidenceIntervalLower).toBeLessThan(trueDiff)
      expect(result.confidenceIntervalUpper).toBeGreaterThan(trueDiff)

      // 置信区间宽度应该合理
      const width = result.confidenceIntervalUpper - result.confidenceIntervalLower
      expect(width).toBeGreaterThan(0)
      expect(width).toBeLessThan(0.1) // 不超过10%
    })

    it('应该支持不同置信水平', () => {
      const result90 = calculateZTest(140, 5000, 100, 5000, 0.90)
      const result95 = calculateZTest(140, 5000, 100, 5000, 0.95)
      const result99 = calculateZTest(140, 5000, 100, 5000, 0.99)

      // 更高置信度要求更低的p值才显著
      // 在这个例子中，差异足够大，所有水平都应该显著
      expect(result90.isSignificant).toBe(true)
      expect(result95.isSignificant).toBe(true)
      expect(result99.isSignificant).toBe(true)
    })

    it('应该处理极端差异情况', () => {
      // 极大差异
      const result = calculateZTest(500, 1000, 100, 1000, 0.95)

      expect(result.z).toBeGreaterThan(10) // 非常大的Z值
      expect(result.pValue).toBeCloseTo(0, 5) // 接近0的p值
      expect(result.isSignificant).toBe(true)
    })
  })

  describe('calculateCPCImprovement - CPC改进率计算', () => {

    it('应该正确计算CPC降低幅度', () => {
      // Control: ¥10.00 CPC
      // Variant: ¥7.50 CPC
      // 降低25%

      const improvement = calculateCPCImprovement(10.0, 7.5)
      expect(improvement).toBeCloseTo(25, 1)
    })

    it('应该处理CPC升高的情况（负改进）', () => {
      // Control: ¥10.00 CPC
      // Variant: ¥12.00 CPC
      // 升高20%（负改进）

      const improvement = calculateCPCImprovement(10.0, 12.0)
      expect(improvement).toBeCloseTo(-20, 1)
    })

    it('应该处理零CPC情况', () => {
      const improvement = calculateCPCImprovement(0, 5.0)
      expect(improvement).toBe(0)
    })

    it('应该处理相同CPC情况', () => {
      const improvement = calculateCPCImprovement(10.0, 10.0)
      expect(improvement).toBeCloseTo(0, 1)
    })

    it('应该处理小数精度', () => {
      const improvement = calculateCPCImprovement(10.5678, 7.8901)
      expect(improvement).toBeCloseTo(25.34, 1) // (10.5678 - 7.8901) / 10.5678 * 100 ≈ 25.34%
    })

    it('应该处理极小CPC值', () => {
      const improvement = calculateCPCImprovement(0.01, 0.005)
      expect(improvement).toBeCloseTo(50, 1)
    })
  })

  describe('calculateCTRImprovement - CTR改进率计算', () => {

    it('应该正确计算CTR提升幅度', () => {
      // Control: 2.0% CTR
      // Variant: 2.8% CTR
      // 提升40%

      const improvement = calculateCTRImprovement(2.0, 2.8)
      expect(improvement).toBeCloseTo(40, 1)
    })

    it('应该处理CTR下降的情况（负改进）', () => {
      // Control: 2.0% CTR
      // Variant: 1.8% CTR
      // 下降10%

      const improvement = calculateCTRImprovement(2.0, 1.8)
      expect(improvement).toBeCloseTo(-10, 1)
    })

    it('应该处理零CTR情况', () => {
      const improvement = calculateCTRImprovement(0, 2.5)
      expect(improvement).toBe(0)
    })

    it('应该处理相同CTR情况', () => {
      const improvement = calculateCTRImprovement(3.5, 3.5)
      expect(improvement).toBeCloseTo(0, 1)
    })

    it('应该处理小CTR值', () => {
      const improvement = calculateCTRImprovement(0.5, 0.75)
      expect(improvement).toBeCloseTo(50, 1)
    })
  })

  describe('边界条件和错误处理', () => {

    it('Z-test应该处理负转化数（不合法数据）', () => {
      // 虽然不应该出现，但要优雅处理
      const result = calculateZTest(-10, 100, 20, 100, 0.95)

      // 期望返回有效结果或安全默认值
      expect(result).toBeDefined()
      expect(result.z).toBeDefined()
      expect(result.pValue).toBeDefined()
    })

    it('Z-test应该处理转化数超过总数（不合法数据）', () => {
      const result = calculateZTest(150, 100, 80, 100, 0.95)

      expect(result).toBeDefined()
      // 转化率会大于1，但计算应该完成
      expect(result.z).toBeDefined()
    })

    it('改进率计算应该处理负数', () => {
      const improvement = calculateCPCImprovement(-10, 5)
      expect(improvement).toBeDefined()
      expect(typeof improvement).toBe('number')
    })

    it('normalCDF应该处理NaN输入', () => {
      const result = normalCDF(NaN)
      expect(result).toBeDefined()
      // 可能返回NaN或默认值，但不应该抛出错误
    })

    it('normalCDF应该处理Infinity', () => {
      const resultPos = normalCDF(Infinity)
      expect(resultPos).toBeDefined()
      expect(resultPos).toBeGreaterThanOrEqual(0.99) // 接近1

      const resultNeg = normalCDF(-Infinity)
      expect(resultNeg).toBeDefined()
      expect(resultNeg).toBeLessThanOrEqual(0.01) // 接近0
    })
  })

  describe('真实场景模拟', () => {

    it('创意测试场景：CTR优化', () => {
      // Phase 1 创意测试数据（来自E2E测试脚本）
      // Control: 5000展示, 100点击 → CTR 2.0%
      // Variant A: 5000展示, 140点击 → CTR 2.8% (40%提升)
      // Variant B: 5000展示, 90点击 → CTR 1.8%

      const resultA = calculateZTest(140, 5000, 100, 5000, 0.95)
      const resultB = calculateZTest(90, 5000, 100, 5000, 0.95)

      // Variant A应该显著优于Control
      expect(resultA.isSignificant).toBe(true)
      expect(resultA.z).toBeGreaterThan(0)

      // Variant B应该不显著或显著劣于Control
      expect(resultB.z).toBeLessThan(0)

      // CTR改进率
      const ctrImprovementA = calculateCTRImprovement(2.0, 2.8)
      const ctrImprovementB = calculateCTRImprovement(2.0, 1.8)

      expect(ctrImprovementA).toBeCloseTo(40, 1)
      expect(ctrImprovementB).toBeCloseTo(-10, 1)
    })

    it('策略测试场景：CPC优化', () => {
      // Phase 2 策略测试数据（来自E2E测试脚本）
      // Control: 200点击, ¥2000成本 → CPC ¥10.00
      // Variant A: 200点击, ¥1500成本 → CPC ¥7.50 (25%降低)
      // Variant B: 200点击, ¥1700成本 → CPC ¥8.50 (15%降低)

      const cpcControl = 10.0
      const cpcVariantA = 7.5
      const cpcVariantB = 8.5

      const improvementA = calculateCPCImprovement(cpcControl, cpcVariantA)
      const improvementB = calculateCPCImprovement(cpcControl, cpcVariantB)

      expect(improvementA).toBeCloseTo(25, 1)
      expect(improvementB).toBeCloseTo(15, 1)

      // Variant A应该是最优
      expect(improvementA).toBeGreaterThan(improvementB)
    })

    it('最小样本量检查场景', () => {
      // 样本量不足时，即使差异大也可能不显著

      // 小样本：10点击 vs 5点击（100%差异）
      const smallSample = calculateZTest(10, 50, 5, 50, 0.95)

      // 大样本：1000点击 vs 500点击（100%差异）
      const largeSample = calculateZTest(1000, 5000, 500, 5000, 0.95)

      // 大样本更容易达到显著性
      expect(largeSample.pValue).toBeLessThan(smallSample.pValue)
      expect(largeSample.isSignificant).toBe(true)
    })
  })
})
