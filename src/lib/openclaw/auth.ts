import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getSetting, updateSettings } from '@/lib/settings'
import { generateRandomKey } from '@/lib/crypto'

const GATEWAY_TOKEN_KEY = 'gateway_token'

function resolveOpenclawConfigPath(): string {
  const configured = (process.env.OPENCLAW_CONFIG_PATH || '').trim()
  if (configured) return configured
  return path.join(process.cwd(), '.openclaw', 'openclaw.json')
}

function readGatewayTokenFromConfigFile(): string | null {
  const configPath = resolveOpenclawConfigPath()

  try {
    if (!fs.existsSync(configPath)) return null

    const raw = fs.readFileSync(configPath, 'utf-8').trim()
    if (!raw) return null

    const parsed = JSON.parse(raw) as Record<string, any>
    const token = String(parsed?.gateway?.auth?.token || '').trim()
    return token || null
  } catch {
    return null
  }
}

export async function getOpenclawGatewayToken(): Promise<string> {
  const existing = await getSetting('openclaw', GATEWAY_TOKEN_KEY)
  const value = (existing?.value || '').trim()
  if (value) {
    return value
  }

  const tokenFromConfig = readGatewayTokenFromConfigFile()
  if (tokenFromConfig) {
    await updateSettings([{ category: 'openclaw', key: GATEWAY_TOKEN_KEY, value: tokenFromConfig }])
    return tokenFromConfig
  }

  const token = generateRandomKey(32)
  await updateSettings([{ category: 'openclaw', key: GATEWAY_TOKEN_KEY, value: token }])
  return token
}

export async function verifyOpenclawGatewayToken(token: string | null): Promise<boolean> {
  if (!token) return false
  const expected = await getOpenclawGatewayToken()
  return timingSafeEqual(expected, token)
}

export function hashOpenclawToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
