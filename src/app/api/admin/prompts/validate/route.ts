import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/prompts/validate
 * 验证 Prompt 模板变量
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { promptContent } = body

    if (!promptContent) {
      return NextResponse.json(
        { success: false, error: '缺少 promptContent 字段' },
        { status: 400 }
      )
    }

    // 提取所有模板变量
    const variables = extractTemplateVariables(promptContent)
    
    // 分析变量
    const analysis = analyzeVariables(variables, promptContent)

    return NextResponse.json({
      success: true,
      data: {
        variables,
        analysis,
        total: variables.length,
        unique: [...new Set(variables.map(v => v.name))].length
      }
    })
  } catch (error: any) {
    console.error('验证 Prompt 变量失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * 提取 Prompt 中的所有模板变量
 * 支持格式：{{variable_name}}, {{variable.nested.property}}
 */
function extractTemplateVariables(content: string): Array<{
  name: string
  fullMatch: string
  line: number
  position: number
  isOptional: boolean
  hasDefault: boolean
  defaultValue?: string
}> {
  const variables: Array<{
    name: string
    fullMatch: string
    line: number
    position: number
    isOptional: boolean
    hasDefault: boolean
    defaultValue?: string
  }> = []
  
  // 匹配 {{variable}} 或 {{variable.default}} 格式
  // 支持嵌套：{{object.property}}
  const regex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\.([^}]*))?\}\}/g
  
  const lines = content.split('\n')
  
  lines.forEach((line, lineIndex) => {
    let match
    while ((match = regex.exec(line)) !== null) {
      const fullMatch = match[0]
      const varName = match[1]
      const defaultValue = match[2]
      
      // 检查是否是可选变量（有默认值）
      const isOptional = defaultValue !== undefined
      const hasDefault = isOptional
      
      variables.push({
        name: varName,
        fullMatch,
        line: lineIndex + 1,  // 行号从 1 开始
        position: match.index,
        isOptional,
        hasDefault,
        defaultValue: defaultValue || undefined
      })
    }
  })
  
  return variables
}

/**
 * 分析变量使用情况
 */
function analyzeVariables(
  variables: Array<{ name: string; fullMatch: string; line: number; position: number; isOptional: boolean; hasDefault: boolean; defaultValue?: string }>,
  content: string
) {
  // 统计每个变量的使用次数
  const usageCount: Record<string, number> = {}
  variables.forEach(v => {
    usageCount[v.name] = (usageCount[v.name] || 0) + 1
  })
  
  // 分类变量
  const required = variables.filter(v => !v.isOptional).map(v => v.name)
  const optional = variables.filter(v => v.isOptional).map(v => v.name)
  
  // 去重后的变量列表
  const uniqueVars = [...new Set(variables.map(v => v.name))]
  
  // 检测潜在问题
  const issues: Array<{
    type: 'warning' | 'error' | 'info'
    message: string
    variable?: string
    line?: number
  }> = []
  
  // 检查未使用的变量（定义了但没使用）
  // 检查重复定义的变量
  const duplicateVars = uniqueVars.filter(
    (name, index) => uniqueVars.indexOf(name) !== index
  )
  
  if (duplicateVars.length > 0) {
    issues.push({
      type: 'info',
      message: `以下变量被多次使用：${[...new Set(duplicateVars)].join(', ')}`,
    })
  }
  
  // 检查空变量名
  const emptyVars = variables.filter(v => !v.name.trim())
  if (emptyVars.length > 0) {
    issues.push({
      type: 'error',
      message: '发现空变量名，请检查模板语法',
      line: emptyVars[0].line
    })
  }
  
  // 检查变量命名规范
  const invalidNames = variables.filter(v => !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(v.name))
  if (invalidNames.length > 0) {
    issues.push({
      type: 'warning',
      message: '以下变量名不符合命名规范（应使用字母、数字、下划线）：' + 
        [...new Set(invalidNames.map(v => v.name))].join(', '),
    })
  }
  
  // 统计信息
  const stats = {
    total: variables.length,
    unique: uniqueVars.length,
    required: [...new Set(required)].length,
    optional: [...new Set(optional)].length,
    avgUsage: variables.length / uniqueVars.length
  }
  
  return {
    uniqueVars,
    required: [...new Set(required)],
    optional: [...new Set(optional)],
    usageCount,
    issues,
    stats
  }
}
