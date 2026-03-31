import { OAuth2Client } from 'google-auth-library'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
)

/**
 * 生成Google OAuth授权URL
 */
export function getGoogleAuthUrl(): string {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ]

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  })

  return authUrl
}

/**
 * 通过授权码获取用户信息
 */
export async function getGoogleUserInfo(code: string): Promise<{
  id: string
  email: string
  name?: string
  picture?: string
}> {
  try {
    // 用授权码换取token
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // 获取用户信息
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    })

    const payload = ticket.getPayload()
    if (!payload) {
      throw new Error('无法获取Google用户信息')
    }

    return {
      id: payload.sub,
      email: payload.email!,
      name: payload.name,
      picture: payload.picture,
    }
  } catch (error) {
    console.error('Google OAuth错误:', error)
    throw new Error('Google登录失败')
  }
}

/**
 * 验证Google ID Token
 */
export async function verifyGoogleIdToken(idToken: string): Promise<{
  id: string
  email: string
  name?: string
  picture?: string
}> {
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    })

    const payload = ticket.getPayload()
    if (!payload) {
      throw new Error('无效的ID Token')
    }

    return {
      id: payload.sub,
      email: payload.email!,
      name: payload.name,
      picture: payload.picture,
    }
  } catch (error) {
    console.error('验证Google ID Token失败:', error)
    throw new Error('Token验证失败')
  }
}
