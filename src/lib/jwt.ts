import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN } from './config'

export interface JWTPayload {
  userId: number
  email: string
  role: string
  packageType: string
  mustChangePassword?: boolean // 用户是否需要强制修改密码
  iat?: number
  exp?: number
}

/**
 * 生成JWT Token
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions)
}

/**
 * 验证JWT Token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload
    return decoded
  } catch (error) {
    console.error('JWT验证失败:', error)
    return null
  }
}
