// Server-side barrel: re-exports client-safe modules plus DB/AI/keyword pipeline integrations.
export * from './index'

export {
  applyKeywordSupplementationOnce,
  generateAdCreative,
  getThemeByBucket,
} from './generator/index'
export type {
  AdCreativePromptKeywordPlan,
  BucketType,
  CreativePriceEvidenceResolution,
  CreativeSalesRankSignal,
  CreativeTargetLanguageResolution,
  IntentCategory,
  KeywordSupplementationReport,
  KeywordWithVolume,
  SearchTermFeedbackHintsInput,
} from './generator/index'
export { evaluateAdStrength } from './strength/evaluate'
export * from './ad-creative'
export * from './ad-creative-quality-loop'
export * from './ad-creative-regenerator'
export * from './ad-creative-rule-gate'
export * from './ad-elements-extractor'
export * from './bucket-creative-generation-pipeline'
export * from './competitor-analyzer'
export * from './creative-learning'
export * from './creative-publish-alerts'
export * from './creative-task-stream'
export * from './dki-localization'
export * from './review-analyzer'
export * from './rsa-quality-gate'
export * from './scenario-extractor'
