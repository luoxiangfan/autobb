/**
 * 🔥 创意生成器模块统一导出
 *
 * 从 ad-creative-generator.ts 拆分出来的 5 个模块：
 * 1. creative-types.ts - 类型定义
 * 2. creative-orchestrator.ts - 协调器
 * 3. creative-generator.ts - AI 调用
 * 4. creative-prompt-builder.ts - 提示构建
 * 5. creative-storage.ts - 存储管理
 *
 * 使用方式：
 * import { generateAdCreative } from './creative-splitted/creative-orchestrator'
 */

export * from './creative-types'
export * from './creative-orchestrator'
export * from './creative-generator'
export * from './creative-prompt-builder'
export * from './creative-storage'
