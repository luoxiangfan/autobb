/**
 * 优化规则引擎单元测试
 */

import {
  createOptimizationEngine,
  OptimizationRulesEngine,
  type CampaignMetrics,
  type OptimizationRecommendation
} from '../optimization-rules'

describe('OptimizationRulesEngine', () => {
  let engine: OptimizationRulesEngine

  beforeEach(() => {
    engine = createOptimizationEngine()
  })

  // 辅助函数：创建测试Campaign数据
  const createMockCampaign = (overrides?: Partial<CampaignMetrics>): CampaignMetrics => ({
    campaignId: 1,
    campaignName: 'Test Campaign',
    status: 'ENABLED',
    impressions: 1000,
    clicks: 20,
    cost: 30,
    conversions: 1,
    ctr: 0.02,
    cpc: 1.5,
    cpa: 30,
    conversionRate: 0.05,
    roi: 0.67,
    daysRunning: 7,
    ...overrides
  })

  describe('规则1: CTR过低', () => {
    it('应该建议暂停CTR极低的Campaign（< 0.5%）', () => {
      const campaign = createMockCampaign({
        clicks: 100,
        impressions: 50000,
        ctr: 0.002 // 0.2%
      })

      const recommendations = engine.generateRecommendations(campaign)

      expect(recommendations.length).toBeGreaterThan(0)
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeDefined()
      expect(ctrRec?.priority).toBe('high')
      expect(ctrRec?.type).toBe('pause_campaign')
    })

    it('应该建议优化CTR较低的Campaign（0.5%-1%）', () => {
      const campaign = createMockCampaign({
        clicks: 60,
        impressions: 10000,
        ctr: 0.006 // 0.6%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeDefined()
      expect(ctrRec?.priority).toBe('high')
      expect(ctrRec?.type).toBe('optimize_creative')
    })

    it('CTR正常时不应生成建议', () => {
      const campaign = createMockCampaign({
        clicks: 200,
        impressions: 10000,
        ctr: 0.02 // 2%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeUndefined()
    })

    it('点击量不足50时不应生成CTR建议', () => {
      const campaign = createMockCampaign({
        clicks: 30,
        impressions: 10000,
        ctr: 0.003
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeUndefined()
    })
  })

  describe('规则2: 转化率低', () => {
    it('应该建议优化转化率过低的Campaign', () => {
      const campaign = createMockCampaign({
        clicks: 100,
        conversions: 0,
        conversionRate: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const convRec = recommendations.find(r => r.reason.includes('转化率过低'))
      expect(convRec).toBeDefined()
      expect(convRec?.priority).toBe('medium')
      expect(convRec?.type).toBe('improve_landing_page')
    })

    it('转化率正常时不应生成建议', () => {
      const campaign = createMockCampaign({
        clicks: 100,
        conversions: 5,
        conversionRate: 0.05 // 5%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const convRec = recommendations.find(r => r.reason.includes('转化率过低'))
      expect(convRec).toBeUndefined()
    })

    it('点击量不足20时不应生成转化率建议', () => {
      const campaign = createMockCampaign({
        clicks: 15,
        conversions: 0,
        conversionRate: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const convRec = recommendations.find(r => r.reason.includes('转化率过低'))
      expect(convRec).toBeUndefined()
    })
  })

  describe('规则3: CPC过高', () => {
    it('应该建议降低过高的CPC', () => {
      const campaign = createMockCampaign({
        clicks: 50,
        cost: 200,
        cpc: 4.0 // $4
      })

      const recommendations = engine.generateRecommendations(campaign)

      const cpcRec = recommendations.find(r => r.reason.includes('CPC过高'))
      expect(cpcRec).toBeDefined()
      expect(cpcRec?.priority).toBe('medium')
      expect(cpcRec?.type).toBe('lower_cpc')
    })

    it('CPC正常时不应生成建议', () => {
      const campaign = createMockCampaign({
        clicks: 50,
        cost: 75,
        cpc: 1.5
      })

      const recommendations = engine.generateRecommendations(campaign)

      const cpcRec = recommendations.find(r => r.reason.includes('CPC过高'))
      expect(cpcRec).toBeUndefined()
    })

    it('点击量不足10时不应生成CPC建议', () => {
      const campaign = createMockCampaign({
        clicks: 5,
        cost: 25,
        cpc: 5.0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const cpcRec = recommendations.find(r => r.reason.includes('CPC过高'))
      expect(cpcRec).toBeUndefined()
    })
  })

  describe('规则4: 花费高无转化', () => {
    it('应该建议暂停花费过高但无转化的Campaign', () => {
      const campaign = createMockCampaign({
        cost: 150,
        conversions: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const costRec = recommendations.find(r => r.reason.includes('已花费'))
      expect(costRec).toBeDefined()
      expect(costRec?.priority).toBe('high')
      expect(costRec?.type).toBe('pause_campaign')
    })

    it('花费低于阈值时不应生成建议', () => {
      const campaign = createMockCampaign({
        cost: 50,
        conversions: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const costRec = recommendations.find(r => r.reason.includes('已花费'))
      expect(costRec).toBeUndefined()
    })

    it('有转化时不应生成建议', () => {
      const campaign = createMockCampaign({
        cost: 150,
        conversions: 2
      })

      const recommendations = engine.generateRecommendations(campaign)

      const costRec = recommendations.find(r => r.reason.includes('已花费'))
      expect(costRec).toBeUndefined()
    })
  })

  describe('规则5: ROI负值', () => {
    it('应该建议降低预算当ROI为负', () => {
      const campaign = createMockCampaign({
        cost: 100,
        conversions: 1,
        roi: -0.5 // -50%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI为负值'))
      expect(roiRec).toBeDefined()
      expect(roiRec?.priority).toBe('high')
      expect(roiRec?.type).toBe('decrease_budget')
    })

    it('ROI正值时不应生成建议', () => {
      const campaign = createMockCampaign({
        cost: 50,
        conversions: 2,
        roi: 1.0 // 100%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI为负值'))
      expect(roiRec).toBeUndefined()
    })

    it('无转化时不应生成ROI负值建议', () => {
      const campaign = createMockCampaign({
        cost: 100,
        conversions: 0,
        roi: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI为负值'))
      expect(roiRec).toBeUndefined()
    })
  })

  describe('规则6: ROI高', () => {
    it('应该建议增加预算当ROI优异', () => {
      const campaign = createMockCampaign({
        cost: 50,
        conversions: 10,
        roi: 1.5 // 150%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI表现优异'))
      expect(roiRec).toBeDefined()
      expect(roiRec?.priority).toBe('low')
      expect(roiRec?.type).toBe('increase_budget')
    })

    it('ROI正常时不应生成建议', () => {
      const campaign = createMockCampaign({
        cost: 50,
        conversions: 5,
        roi: 0.8 // 80%
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI表现优异'))
      expect(roiRec).toBeUndefined()
    })

    it('转化数不足5时不应生成建议', () => {
      const campaign = createMockCampaign({
        cost: 20,
        conversions: 3,
        roi: 2.0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const roiRec = recommendations.find(r => r.reason.includes('ROI表现优异'))
      expect(roiRec).toBeUndefined()
    })
  })

  describe('规则7: CTR高', () => {
    it('应该建议增加预算当CTR优异', () => {
      const campaign = createMockCampaign({
        clicks: 600,
        impressions: 10000,
        ctr: 0.06, // 6%
        conversions: 10
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR表现优异'))
      expect(ctrRec).toBeDefined()
      expect(ctrRec?.priority).toBe('low')
      expect(ctrRec?.type).toBe('increase_budget')
    })

    it('无转化时不应生成CTR高建议', () => {
      const campaign = createMockCampaign({
        clicks: 600,
        impressions: 10000,
        ctr: 0.06,
        conversions: 0
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR表现优异'))
      expect(ctrRec).toBeUndefined()
    })

    it('CTR未达到阈值时不应生成建议', () => {
      const campaign = createMockCampaign({
        clicks: 200,
        impressions: 10000,
        ctr: 0.02, // 2%
        conversions: 5
      })

      const recommendations = engine.generateRecommendations(campaign)

      const ctrRec = recommendations.find(r => r.reason.includes('CTR表现优异'))
      expect(ctrRec).toBeUndefined()
    })
  })

  describe('规则8: 展示量低', () => {
    it('应该建议扩大定位当展示量过低', () => {
      const campaign = createMockCampaign({
        impressions: 50,
        daysRunning: 5
      })

      const recommendations = engine.generateRecommendations(campaign)

      const impRec = recommendations.find(r => r.reason.includes('展示量过低'))
      expect(impRec).toBeDefined()
      expect(impRec?.priority).toBe('medium')
      expect(impRec?.type).toBe('expand_targeting')
    })

    it('展示量正常时不应生成建议', () => {
      const campaign = createMockCampaign({
        impressions: 5000,
        daysRunning: 5
      })

      const recommendations = engine.generateRecommendations(campaign)

      const impRec = recommendations.find(r => r.reason.includes('展示量过低'))
      expect(impRec).toBeUndefined()
    })

    it('运行天数不足3天时不应生成建议', () => {
      const campaign = createMockCampaign({
        impressions: 50,
        daysRunning: 2
      })

      const recommendations = engine.generateRecommendations(campaign)

      const impRec = recommendations.find(r => r.reason.includes('展示量过低'))
      expect(impRec).toBeUndefined()
    })
  })

  describe('规则9: 新Campaign观察期', () => {
    it('应该提示新Campaign处于观察期', () => {
      const campaign = createMockCampaign({
        daysRunning: 2,
        impressions: 100
      })

      const recommendations = engine.generateRecommendations(campaign)

      const newRec = recommendations.find(r => r.reason.includes('新Campaign处于观察期'))
      expect(newRec).toBeDefined()
      expect(newRec?.priority).toBe('low')
      expect(newRec?.type).toBe('optimize_creative')
    })

    it('运行超过3天时不应生成观察期建议', () => {
      const campaign = createMockCampaign({
        daysRunning: 5,
        impressions: 100
      })

      const recommendations = engine.generateRecommendations(campaign)

      const newRec = recommendations.find(r => r.reason.includes('新Campaign处于观察期'))
      expect(newRec).toBeUndefined()
    })

    it('展示量过低时不应生成观察期建议', () => {
      const campaign = createMockCampaign({
        daysRunning: 2,
        impressions: 5
      })

      const recommendations = engine.generateRecommendations(campaign)

      const newRec = recommendations.find(r => r.reason.includes('新Campaign处于观察期'))
      expect(newRec).toBeUndefined()
    })
  })

  describe('批量处理', () => {
    it('应该为多个Campaigns生成建议', () => {
      const campaigns: CampaignMetrics[] = [
        createMockCampaign({ campaignId: 1, clicks: 100, ctr: 0.005 }),
        createMockCampaign({ campaignId: 2, cost: 150, conversions: 0 }),
        createMockCampaign({ campaignId: 3, roi: 1.5, conversions: 10 })
      ]

      const recommendations = engine.generateBatchRecommendations(campaigns)

      expect(recommendations.length).toBeGreaterThan(0)

      // 验证不同Campaign的建议
      const campaign1Recs = recommendations.filter(r => r.campaignId === 1)
      const campaign2Recs = recommendations.filter(r => r.campaignId === 2)
      const campaign3Recs = recommendations.filter(r => r.campaignId === 3)

      expect(campaign1Recs.length).toBeGreaterThan(0)
      expect(campaign2Recs.length).toBeGreaterThan(0)
      expect(campaign3Recs.length).toBeGreaterThan(0)
    })

    it('应该按优先级排序建议', () => {
      const campaigns: CampaignMetrics[] = [
        createMockCampaign({ campaignId: 1, roi: 1.5, conversions: 10 }), // low priority
        createMockCampaign({ campaignId: 2, cost: 150, conversions: 0 }), // high priority
        createMockCampaign({ campaignId: 3, clicks: 50, cpc: 4.0 }) // medium priority
      ]

      const recommendations = engine.generateBatchRecommendations(campaigns)

      // 验证优先级排序：high -> medium -> low
      const priorities = recommendations.map(r => r.priority)
      const highIndex = priorities.indexOf('high')
      const mediumIndex = priorities.indexOf('medium')
      const lowIndex = priorities.indexOf('low')

      if (highIndex !== -1 && mediumIndex !== -1) {
        expect(highIndex).toBeLessThan(mediumIndex)
      }
      if (mediumIndex !== -1 && lowIndex !== -1) {
        expect(mediumIndex).toBeLessThan(lowIndex)
      }
    })
  })

  describe('配置管理', () => {
    it('应该支持自定义配置', () => {
      const customEngine = createOptimizationEngine({
        ctrLow: {
          enabled: true,
          threshold: 0.015, // 提高到1.5%
          sensitivity: 'strict'
        }
      })

      const campaign = createMockCampaign({
        clicks: 100,
        impressions: 10000,
        ctr: 0.012 // 1.2%
      })

      const recommendations = customEngine.generateRecommendations(campaign)

      // 使用更严格的阈值，1.2%应该触发建议
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeDefined()
    })

    it('应该支持禁用规则', () => {
      const customEngine = createOptimizationEngine({
        ctrLow: {
          enabled: false,
          threshold: 0.01,
          sensitivity: 'normal'
        }
      })

      const campaign = createMockCampaign({
        clicks: 100,
        impressions: 50000,
        ctr: 0.002 // 极低CTR
      })

      const recommendations = customEngine.generateRecommendations(campaign)

      // CTR规则已禁用，不应生成建议
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeUndefined()
    })

    it('应该支持更新配置', () => {
      const config = engine.getConfig()
      expect(config.ctrLow.threshold).toBe(0.01)

      engine.updateConfig({
        ctrLow: {
          enabled: true,
          threshold: 0.02,
          sensitivity: 'relaxed'
        }
      })

      const updatedConfig = engine.getConfig()
      expect(updatedConfig.ctrLow.threshold).toBe(0.02)
      expect(updatedConfig.ctrLow.sensitivity).toBe('relaxed')
    })
  })

  describe('敏感度调整', () => {
    it('strict模式应该更容易触发建议', () => {
      const strictEngine = createOptimizationEngine({
        ctrLow: {
          enabled: true,
          threshold: 0.01,
          sensitivity: 'strict' // 1.2x multiplier
        }
      })

      const campaign = createMockCampaign({
        clicks: 100,
        impressions: 10000,
        ctr: 0.011 // 1.1%，正常模式不会触发，strict会触发
      })

      const recommendations = strictEngine.generateRecommendations(campaign)
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeDefined()
    })

    it('relaxed模式应该更难触发建议', () => {
      const relaxedEngine = createOptimizationEngine({
        ctrLow: {
          enabled: true,
          threshold: 0.01,
          sensitivity: 'relaxed' // 0.8x multiplier
        }
      })

      const campaign = createMockCampaign({
        clicks: 100,
        impressions: 10000,
        ctr: 0.009 // 0.9%，正常模式会触发，relaxed不会
      })

      const recommendations = relaxedEngine.generateRecommendations(campaign)
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))
      expect(ctrRec).toBeUndefined()
    })
  })

  describe('边界条件', () => {
    it('展示量过低时不应生成建议', () => {
      const campaign = createMockCampaign({
        impressions: 5,
        clicks: 0
      })

      const recommendations = engine.generateRecommendations(campaign)
      expect(recommendations.length).toBe(0)
    })

    it('应该处理零值指标', () => {
      const campaign = createMockCampaign({
        impressions: 1000,
        clicks: 0,
        cost: 0,
        conversions: 0,
        ctr: 0,
        cpc: 0,
        conversionRate: 0,
        roi: 0
      })

      const recommendations = engine.generateRecommendations(campaign)
      // 应该不会因为零值而崩溃
      expect(Array.isArray(recommendations)).toBe(true)
    })

    it('应该处理极端值', () => {
      const campaign = createMockCampaign({
        impressions: 1000000,
        clicks: 500000,
        cost: 1000000,
        conversions: 10000,
        ctr: 0.5, // 50% CTR（极端高）
        cpc: 2.0,
        conversionRate: 0.02,
        roi: 5.0 // 500% ROI
      })

      const recommendations = engine.generateRecommendations(campaign)
      expect(Array.isArray(recommendations)).toBe(true)
    })
  })

  describe('建议内容质量', () => {
    it('建议应包含完整信息', () => {
      const campaign = createMockCampaign({
        cost: 150,
        conversions: 0
      })

      const recommendations = engine.generateRecommendations(campaign)
      const rec = recommendations[0]

      expect(rec.campaignId).toBeDefined()
      expect(rec.campaignName).toBeDefined()
      expect(rec.priority).toMatch(/^(high|medium|low)$/)
      expect(rec.type).toBeDefined()
      expect(rec.reason).toBeTruthy()
      expect(rec.action).toBeTruthy()
      expect(rec.expectedImpact).toBeTruthy()
      expect(rec.metrics).toBeDefined()
      expect(rec.metrics.current).toBeDefined()
    })

    it('建议应提供可操作的行动方案', () => {
      const campaign = createMockCampaign({
        clicks: 100,
        ctr: 0.005
      })

      const recommendations = engine.generateRecommendations(campaign)
      const ctrRec = recommendations.find(r => r.reason.includes('CTR过低'))

      expect(ctrRec?.action).toContain('建议')
      expect(ctrRec?.action.length).toBeGreaterThan(10)
    })
  })
})
