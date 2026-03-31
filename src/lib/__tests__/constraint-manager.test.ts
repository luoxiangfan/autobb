/**
 * 约束管理器单元测试
 */

import {
  ConstraintManager,
  getConstraintManager,
  resetConstraintManager,
  type ConstraintPriority
} from '../constraint-manager'

describe('ConstraintManager', () => {
  let manager: ConstraintManager

  beforeEach(() => {
    resetConstraintManager()
    manager = new ConstraintManager()
  })

  describe('getConstraintPriority', () => {
    it('should return P0 for hard limit constraints', () => {
      expect(manager.getConstraintPriority('headline_length')).toBe('P0')
      expect(manager.getConstraintPriority('description_length')).toBe('P0')
      expect(manager.getConstraintPriority('forbidden_symbols')).toBe('P0')
    })

    it('should return P1 for soft limit constraints', () => {
      expect(manager.getConstraintPriority('diversity')).toBe('P1')
      expect(manager.getConstraintPriority('type_coverage')).toBe('P1')
      expect(manager.getConstraintPriority('search_volume')).toBe('P1')
    })

    it('should return P2 for optional constraints', () => {
      expect(manager.getConstraintPriority('length_distribution')).toBe('P2')
      expect(manager.getConstraintPriority('priority_distribution')).toBe('P2')
      expect(manager.getConstraintPriority('social_proof')).toBe('P2')
    })

    it('should return null for unknown constraint', () => {
      expect(manager.getConstraintPriority('unknown_constraint')).toBeNull()
    })
  })

  describe('getActiveConstraints', () => {
    it('should return all constraints', () => {
      const constraints = manager.getActiveConstraints()
      expect(constraints.length).toBeGreaterThan(0)
    })

    it('should include P0, P1, and P2 constraints', () => {
      const constraints = manager.getActiveConstraints()
      const priorities = constraints.map(c => c.priority)
      expect(priorities).toContain('P0')
      expect(priorities).toContain('P1')
      expect(priorities).toContain('P2')
    })

    it('should have correct constraint properties', () => {
      const constraints = manager.getActiveConstraints()
      for (const constraint of constraints) {
        expect(constraint).toHaveProperty('name')
        expect(constraint).toHaveProperty('priority')
        expect(constraint).toHaveProperty('currentValue')
        expect(constraint).toHaveProperty('defaultValue')
      }
    })
  })

  describe('getConstraintsByPriority', () => {
    it('should return only P0 constraints', () => {
      const p0Constraints = manager.getConstraintsByPriority('P0')
      expect(p0Constraints.length).toBeGreaterThan(0)
      expect(p0Constraints.every(c => c.priority === 'P0')).toBe(true)
    })

    it('should return only P1 constraints', () => {
      const p1Constraints = manager.getConstraintsByPriority('P1')
      expect(p1Constraints.length).toBeGreaterThan(0)
      expect(p1Constraints.every(c => c.priority === 'P1')).toBe(true)
    })

    it('should return only P2 constraints', () => {
      const p2Constraints = manager.getConstraintsByPriority('P2')
      expect(p2Constraints.length).toBeGreaterThan(0)
      expect(p2Constraints.every(c => c.priority === 'P2')).toBe(true)
    })
  })

  describe('getConstraintValue', () => {
    it('should return current constraint value', () => {
      const value = manager.getConstraintValue('diversity')
      expect(value).toBe(0.2)
    })

    it('should return null for unknown constraint', () => {
      const value = manager.getConstraintValue('unknown_constraint')
      expect(value).toBeNull()
    })

    it('should return different types of values', () => {
      expect(typeof manager.getConstraintValue('headline_length')).toBe('number')
      expect(typeof manager.getConstraintValue('diversity')).toBe('number')
      expect(Array.isArray(manager.getConstraintValue('keyword_count'))).toBe(true)
    })
  })

  describe('setConstraintValue', () => {
    it('should set constraint value', () => {
      const result = manager.setConstraintValue('diversity', 0.25)
      expect(result).toBe(true)
      expect(manager.getConstraintValue('diversity')).toBe(0.25)
    })

    it('should reject value below minimum', () => {
      const result = manager.setConstraintValue('diversity', 0.1)
      expect(result).toBe(false)
    })

    it('should reject value above maximum', () => {
      const result = manager.setConstraintValue('diversity', 0.5)
      expect(result).toBe(false)
    })

    it('should return false for unknown constraint', () => {
      const result = manager.setConstraintValue('unknown_constraint', 100)
      expect(result).toBe(false)
    })

    it('should accept valid values within range', () => {
      const result = manager.setConstraintValue('diversity', 0.22)
      expect(result).toBe(true)
      expect(manager.getConstraintValue('diversity')).toBe(0.22)
    })
  })

  describe('relaxConstraint', () => {
    it('should relax diversity constraint', () => {
      const relaxation = manager.relaxConstraint('diversity', 'Insufficient creatives')
      expect(relaxation).not.toBeNull()
      expect(relaxation?.constraint).toBe('diversity')
      expect(relaxation?.originalValue).toBe(0.2)
      expect(relaxation?.relaxedValue).toBe(0.25)
    })

    it('should relax type_coverage constraint', () => {
      const relaxation = manager.relaxConstraint('type_coverage', 'Cannot satisfy all types')
      expect(relaxation).not.toBeNull()
      expect(relaxation?.constraint).toBe('type_coverage')
      expect(relaxation?.originalValue).toBe(5)
      expect(relaxation?.relaxedValue).toBe(3)
    })

    it('should relax search_volume constraint', () => {
      const relaxation = manager.relaxConstraint('search_volume', 'Insufficient keywords')
      expect(relaxation).not.toBeNull()
      expect(relaxation?.constraint).toBe('search_volume')
      expect(relaxation?.originalValue).toBe(500)
      expect(relaxation?.relaxedValue).toBe(100)
    })

    it('should not relax P0 constraints', () => {
      const relaxation = manager.relaxConstraint('headline_length', 'Test')
      expect(relaxation).toBeNull()
    })

    it('should record relaxation with reason', () => {
      const reason = 'Custom relaxation reason'
      const relaxation = manager.relaxConstraint('diversity', reason)
      expect(relaxation?.reason).toBe(reason)
    })

    it('should calculate relaxation severity', () => {
      const relaxation = manager.relaxConstraint('diversity', 'Test')
      expect(['minor', 'moderate', 'major']).toContain(relaxation?.severity)
    })

    it('should set isRelaxed flag', () => {
      expect(manager.isAnyConstraintRelaxed()).toBe(false)
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.isAnyConstraintRelaxed()).toBe(true)
    })

    it('should update constraint value', () => {
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.getConstraintValue('diversity')).toBe(0.25)
    })
  })

  describe('resetConstraints', () => {
    it('should reset all constraints to default values', () => {
      manager.setConstraintValue('diversity', 0.22)
      manager.relaxConstraint('type_coverage', 'Test')

      manager.resetConstraints()

      expect(manager.getConstraintValue('diversity')).toBe(0.2)
      expect(manager.getConstraintValue('type_coverage')).toBe(5)
    })

    it('should clear relaxations', () => {
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.getRelaxations().length).toBeGreaterThan(0)

      manager.resetConstraints()

      expect(manager.getRelaxations().length).toBe(0)
    })

    it('should reset isRelaxed flag', () => {
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.isAnyConstraintRelaxed()).toBe(true)

      manager.resetConstraints()

      expect(manager.isAnyConstraintRelaxed()).toBe(false)
    })
  })

  describe('getRelaxations', () => {
    it('should return empty array initially', () => {
      expect(manager.getRelaxations().length).toBe(0)
    })

    it('should return all relaxations', () => {
      manager.relaxConstraint('diversity', 'Reason 1')
      manager.relaxConstraint('type_coverage', 'Reason 2')

      const relaxations = manager.getRelaxations()
      expect(relaxations.length).toBe(2)
    })

    it('should include relaxation details', () => {
      manager.relaxConstraint('diversity', 'Test reason')
      const relaxations = manager.getRelaxations()

      expect(relaxations[0]).toHaveProperty('constraint')
      expect(relaxations[0]).toHaveProperty('originalValue')
      expect(relaxations[0]).toHaveProperty('relaxedValue')
      expect(relaxations[0]).toHaveProperty('reason')
      expect(relaxations[0]).toHaveProperty('severity')
      expect(relaxations[0]).toHaveProperty('timestamp')
    })
  })

  describe('isAnyConstraintRelaxed', () => {
    it('should return false initially', () => {
      expect(manager.isAnyConstraintRelaxed()).toBe(false)
    })

    it('should return true after relaxation', () => {
      manager.relaxConstraint('diversity', 'Test')
      expect(manager.isAnyConstraintRelaxed()).toBe(true)
    })

    it('should return false after reset', () => {
      manager.relaxConstraint('diversity', 'Test')
      manager.resetConstraints()
      expect(manager.isAnyConstraintRelaxed()).toBe(false)
    })
  })

  describe('getConstraintStateSummary', () => {
    it('should generate summary', () => {
      const summary = manager.getConstraintStateSummary()
      expect(summary).toBeDefined()
      expect(summary.length).toBeGreaterThan(0)
    })

    it('should include P0 constraints', () => {
      const summary = manager.getConstraintStateSummary()
      expect(summary).toContain('P0 Constraints')
    })

    it('should include P1 constraints', () => {
      const summary = manager.getConstraintStateSummary()
      expect(summary).toContain('P1 Constraints')
    })

    it('should include P2 constraints', () => {
      const summary = manager.getConstraintStateSummary()
      expect(summary).toContain('P2 Constraints')
    })

    it('should show relaxations when present', () => {
      manager.relaxConstraint('diversity', 'Test reason')
      const summary = manager.getConstraintStateSummary()
      expect(summary).toContain('Relaxations Applied')
      expect(summary).toContain('diversity')
    })
  })

  describe('exportState and importState', () => {
    it('should export state', () => {
      manager.relaxConstraint('diversity', 'Test')
      const state = manager.exportState()

      expect(state).toHaveProperty('constraints')
      expect(state).toHaveProperty('relaxations')
      expect(state).toHaveProperty('isRelaxed')
    })

    it('should import state', () => {
      manager.relaxConstraint('diversity', 'Test')
      const state = manager.exportState()

      const newManager = new ConstraintManager()
      newManager.importState(state)

      expect(newManager.getConstraintValue('diversity')).toBe(0.25)
      expect(newManager.getRelaxations().length).toBe(1)
      expect(newManager.isAnyConstraintRelaxed()).toBe(true)
    })

    it('should preserve all state details', () => {
      manager.relaxConstraint('diversity', 'Reason 1')
      manager.relaxConstraint('type_coverage', 'Reason 2')
      const state = manager.exportState()

      const newManager = new ConstraintManager()
      newManager.importState(state)

      expect(newManager.getRelaxations().length).toBe(2)
      expect(newManager.getRelaxations()[0].reason).toBe('Reason 1')
      expect(newManager.getRelaxations()[1].reason).toBe('Reason 2')
    })
  })

  describe('Global constraint manager', () => {
    it('should return same instance', () => {
      resetConstraintManager()
      const manager1 = getConstraintManager()
      const manager2 = getConstraintManager()
      expect(manager1).toBe(manager2)
    })

    it('should create new instance after reset', () => {
      const manager1 = getConstraintManager()
      manager1.relaxConstraint('diversity', 'Test')

      resetConstraintManager()

      const manager2 = getConstraintManager()
      expect(manager2.isAnyConstraintRelaxed()).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle multiple relaxations of same constraint', () => {
      manager.relaxConstraint('diversity', 'Reason 1')
      manager.relaxConstraint('diversity', 'Reason 2')

      const relaxations = manager.getRelaxations()
      expect(relaxations.length).toBe(2)
    })

    it('should handle relaxation with empty reason', () => {
      const relaxation = manager.relaxConstraint('diversity', '')
      expect(relaxation).not.toBeNull()
      expect(relaxation?.reason).toBe('')
    })

    it('should handle very long reason string', () => {
      const longReason = 'A'.repeat(1000)
      const relaxation = manager.relaxConstraint('diversity', longReason)
      expect(relaxation?.reason).toBe(longReason)
    })
  })

  describe('Performance', () => {
    it('should get constraint value quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        manager.getConstraintValue('diversity')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should set constraint value quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        manager.setConstraintValue('diversity', 0.22)
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    it('should relax constraint quickly', () => {
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        const newManager = new ConstraintManager()
        newManager.relaxConstraint('diversity', 'Test')
      }
      const duration = performance.now() - start
      expect(duration).toBeLessThan(200)
    })
  })
})
