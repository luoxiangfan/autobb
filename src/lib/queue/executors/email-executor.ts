/**
 * Email 任务执行器
 *
 * 负责执行邮件发送任务，包括：
 * - 同步成功/失败通知
 * - 系统通知
 * - 营销邮件
 * - 警报邮件
 *
 * 🔄 迁移自 sync-scheduler.ts 中的 sendNotification()
 * 优势：支持邮件队列批量发送、失败重试、异步发送
 */

import type { Task, TaskExecutor } from '../types'

/**
 * Email 任务数据接口
 */
export interface EmailTaskData {
  to: string
  subject: string
  body: string
  type: 'notification' | 'marketing' | 'alert'
  from?: string
  attachments?: Array<{
    filename: string
    content: string
  }>
}

/**
 * Email 任务结果接口
 */
export interface EmailTaskResult {
  success: boolean
  email: string
  type: string
  messageId?: string
  errorMessage?: string
  duration: number  // 发送耗时（毫秒）
}

/**
 * 发送邮件到SMTP服务器
 * 这是一个占位符实现，未来可以集成真实的邮件服务
 */
async function sendEmailViaSMTP(data: EmailTaskData): Promise<{ messageId?: string }> {
  // TODO: 集成真实的邮件服务，如：
  // - nodemailer + SMTP服务器
  // - SendGrid API
  // - AWS SES
  // - Resend API
  // - Mailgun API

  console.log('📧 [Email Service] 发送邮件 (占位符实现)')
  console.log(`   收件人: ${data.to}`)
  console.log(`   主题: ${data.subject}`)
  console.log(`   类型: ${data.type}`)

  // 占位符实现：模拟发送
  await new Promise(resolve => setTimeout(resolve, 100))

  return {
    messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * 生成邮件模板
 */
function generateEmailTemplate(
  type: EmailTaskData['type'],
  subject: string,
  body: string
): string {
  const baseStyles = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  `

  const headerStyles = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px;
    text-align: center;
    border-radius: 8px 8px 0 0;
  `

  const contentStyles = `
    background: #fff;
    padding: 30px;
    border-radius: 0 0 8px 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  `

  const footerStyles = `
    text-align: center;
    padding: 20px;
    color: #666;
    font-size: 12px;
  `

  let icon = ''
  switch (type) {
    case 'notification':
      icon = '📢'
      break
    case 'marketing':
      icon = '📧'
      break
    case 'alert':
      icon = '⚠️'
      break
  }

  return `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin: 0; font-size: 24px;">${icon} ${subject}</h1>
      </div>
      <div style="${contentStyles}">
        <div style="margin-bottom: 20px;">
          ${body}
        </div>
      </div>
      <div style="${footerStyles}">
        <p>此邮件由 AutoAds 系统自动发送，请勿直接回复。</p>
        <p>© 2025 AutoAds. All rights reserved.</p>
      </div>
    </div>
  `
}

/**
 * 创建 Email 任务执行器
 */
export function createEmailExecutor(): TaskExecutor<EmailTaskData, EmailTaskResult> {
  return async (task: Task<EmailTaskData>) => {
    const { to, subject, body, type, from = 'noreply@autoads.com', attachments = [] } = task.data

    console.log(`📧 [EmailExecutor] 开始发送邮件: 收件人=${to}, 类型=${type}`)

    const startTime = Date.now()

    try {
      // 生成邮件模板
      const htmlBody = generateEmailTemplate(type, subject, body)

      // 发送邮件
      const result = await sendEmailViaSMTP({
        to,
        subject,
        body: htmlBody,
        type,
        from,
        attachments
      })

      const duration = Date.now() - startTime

      console.log(`✅ [EmailExecutor] 邮件发送成功: ${to}, 消息ID=${result.messageId}, 耗时=${duration}ms`)

      return {
        success: true,
        email: to,
        type,
        messageId: result.messageId,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [EmailExecutor] 邮件发送失败: ${to}, 错误=${error.message}, 耗时=${duration}ms`)

      return {
        success: false,
        email: to,
        type,
        errorMessage: error.message,
        duration
      }
    }
  }
}
