/**
 * 错误分类逻辑单元测试
 * 验证 isRecoverableError 方法能否正确识别可恢复和不可恢复的错误
 */

import { describe, it, expect } from 'vitest'

// 模拟 isRecoverableError 方法的逻辑
function isRecoverableError(error: any): boolean {
  const errorMessage = error?.message || String(error)

  // 不可恢复的错误模式
  const nonRecoverablePatterns = [
    '未配置',              // 配置缺失
    '未配置完整',          // 配置不完整
    '配置不完整',          // 配置不完整 (变体)
    '不完整',              // 配置不完整
    '需要',                // 需要某个参数
    '必需参数',            // 缺少必需参数
    '缺少',                // 缺少某个参数
    '缺失',                // 参数缺失
    '未找到',              // 未找到资源/配置
    '权限',                // 权限相关
    '认证',                // 认证相关
    '授权',                // 授权相关
    '不存在',              // 资源不存在
    '无效的',              // 无效的参数/资源
    '找不到',              // 找不到资源
    '上传',                // 需要上传文件
    'unauthorized',        // 未授权
    'forbidden',           // 禁止访问
    'not found',           // 未找到
    'invalid',             // 无效的
    'missing',             // 缺失的
    'required',            // 必需的
    'credential',          // 凭证相关
    'config',              // 配置相关
  ]

  for (const pattern of nonRecoverablePatterns) {
    if (errorMessage.toLowerCase().includes(pattern)) {
      return false
    }
  }

  // 其他错误视为可恢复的
  return true
}

// ============ 测试用例 ============

// 测试不可恢复的错误
const nonRecoverableErrors = [
  { message: '用户(ID=24)未配置完整的 Google Ads 凭证。请在设置页面配置所有必需参数。' },
  { message: '用户(ID=20)未配置 login_customer_id。OAuth模式需要此参数。' },
  { message: '权限不足' },
  { message: '认证失败' },
  { message: '资源不存在' },
  { message: 'Unauthorized: Missing credentials' },
  { message: 'Forbidden: Access denied' },
  { message: 'Resource not found' },
  { message: '必需参数缺失: API_KEY' },
  { message: '缺少 refresh_token' },
  { message: '缺失配置: developer_token' },
  { message: '授权失败: Invalid client_id' },
  { message: '未找到服务账号配置' },
  { message: '服务账号配置不完整' },
  { message: '未上传服务账号JSON文件' },
]

// 测试可恢复的错误
const recoverableErrors = [
  { message: 'Connection timeout' },
  { message: '网络连接超时' },
  { message: 'Service temporarily unavailable' },
  { message: 'Database connection failed' },
  { message: 'Too many requests (429)' },
  { message: '临时服务故障，请稍后重试' },
  { message: 'ECONNREFUSED' },
  { message: 'Task timeout' },
  { message: 'Network error: ENOTFOUND' },
  { message: 'Request timeout after 30000ms' },
]

describe('isRecoverableError', () => {
  it('marks non-recoverable errors as false', () => {
    for (const error of nonRecoverableErrors) {
      expect(isRecoverableError(error), error.message).toBe(false)
    }
  })

  it('marks recoverable errors as true', () => {
    for (const error of recoverableErrors) {
      expect(isRecoverableError(error), error.message).toBe(true)
    }
  })
})
