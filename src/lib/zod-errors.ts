/**
 * Zod v4 统一 `{ error: ... }` 校验文案。
 * 所有 API schema 应通过本模块引用，避免散落字符串与 deprecated message 参数。
 */
export const zErr = {
  required: { error: '不能为空' },
  requiredField: (field: string) => ({ error: `${field}不能为空` }),
  minChars: (min: number) => ({ error: `至少需要 ${min} 个字符` }),
  maxChars: (max: number) => ({ error: `不能超过 ${max} 个字符` }),
  minItems: (min: number) => ({ error: `至少需要 ${min} 项` }),
  maxItems: (max: number) => ({ error: `最多 ${max} 项` }),
  minNumber: (min: number) => ({ error: `不能小于 ${min}` }),
  maxNumber: (max: number) => ({ error: `不能大于 ${max}` }),
  int: { error: '必须是整数' },
  positiveInt: { error: '必须是正整数' },
  invalidUrl: { error: '无效的URL格式' },
  invalidAffiliateUrl: { error: '无效的联盟链接格式' },
  countryCode: { error: '国家代码长度应在 2-8 个字符之间' },
  dateYmd: { error: '日期格式必须为 YYYY-MM-DD' },
  invalidExtractionMode: { error: '无效的提取模式，可选：fast、balanced、original' },
  usernameRequired: { error: '用户名不能为空' },
  passwordRequired: { error: '密码不能为空' },
  brandRequired: { error: '品牌名称不能为空' },
  targetCountryMin: { error: '目标国家代码至少2个字符' },
} as const
