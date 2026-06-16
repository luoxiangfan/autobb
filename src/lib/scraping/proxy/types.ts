/**
 * Proxy-related TypeScript type definitions
 */

export interface ProxyIP {
  host: string
  port: number
  username: string
  password: string
  country: string
  health?: {
    healthy: boolean
    lastCheck: Date
    responseTime?: number
  }
}

export interface ProxyCredentials {
  host: string
  port: number
  username: string
  password: string
  fullAddress: string
}
