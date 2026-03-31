# Ad Creative Generator Refactoring Plan

## Overview
将 3514 行的 `ad-creative-generator.ts` 拆分为 5 个模块，每个模块 < 500 行，遵循单一职责原则。

## Current Issues
- 单一文件包含：提示构建、AI 调用、解析、缓存、数据库写入、错误处理
- 违反 KISS 原则：难以测试、难以维护、难以理解
- 混合关注点：业务逻辑与基础设施代码耦合

## Target Architecture

### 1. creative-types.ts (100-200 lines)
**职责**: 所有类型定义和接口
- IntentCategory 类型
- KeywordWithVolume 接口
- AIConfig 接口
- GeneratedAdCreativeData 类型
- 创意生成相关选项接口

### 2. creative-prompt-builder.ts (300-400 lines)
**职责**: 构建 AI 提示
- `buildPrompt()`: 主提示构建逻辑
- `formatKeywords()`: 关键词格式化
- `loadPromptTemplate()`: 从数据库加载提示模板
- `injectVariables()`: 变量注入
- 关键词池处理逻辑（来自之前的修复）

### 3. creative-generator.ts (400-500 lines)
**职责**: 与 AI 模型交互
- `callAI()`: 调用 Gemini/Vertex AI
- `parseAIResponse()`: 解析 AI 响应
- `handleAIError()`: AI 错误处理
- `retryLogic()`: 重试逻辑
- Token 使用追踪

### 4. creative-storage.ts (200-300 lines)
**职责**: 缓存和数据库操作
- `saveToDatabase()`: 保存到数据库
- `getFromCache()`: 从缓存获取
- `setCache()`: 设置缓存
- `generateCacheKey()`: 生成缓存键
- 缓存 TTL 管理

### 5. creative-orchestrator.ts (300-400 lines)
**职责**: 协调各模块，主工作流
- `generateAdCreative()`: 主要入口函数
- `validateInputs()`: 输入验证
- `prepareData()`: 数据准备
- `processResult()`: 结果处理
- 错误聚合和日志记录

## Migration Strategy

### Phase 1: 创建模块结构
1. 创建 `src/lib/creative-splitted/` 目录
2. 创建 5 个模块文件
3. 移动类型定义

### Phase 2: 提取功能
1. 提取提示构建逻辑
2. 提取 AI 调用逻辑
3. 提取存储逻辑
4. 提取主协调逻辑

### Phase 3: 更新引用
1. 更新 `ad-creative-generator.ts` 为入口文件，重新导出所有功能
2. 更新所有导入这些功能的其他文件
3. 运行测试确保功能正常

### Phase 4: 清理
1. 删除旧的巨型文件
2. 将新文件移动到 `src/lib/` 目录
3. 更新所有导入路径

## Benefits

1. **可测试性**: 每个模块可以独立测试
2. **可维护性**: 修改一个功能不会影响其他功能
3. **可读性**: 每个文件 < 500 行，易于理解
4. **可重用性**: 提示构建器、AI 生成器等可以在其他地方重用
5. **错误隔离**: 问题可以快速定位到特定模块

## Success Metrics

- 最大文件大小 < 500 行
- 每个模块单一职责
- 测试覆盖率 > 80%
- 开发者可以在 2 小时内理解整个架构
