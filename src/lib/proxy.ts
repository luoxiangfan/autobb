/**
 * 代理配置工具
 * 用于Google搜索建议功能
 */

export interface ProxyConfig {
  host?: string
  port?: number
  auth?: {
    username: string
    password: string
  }
}

/**
 * 获取代理配置
 * 根据国家返回对应的代理配置
 *
 * @param country - 目标国家代码
 * @returns 代理配置对象，如果不需要代理则返回 undefined
 */
export async function getProxyConfig(country: string): Promise<ProxyConfig | undefined> {
  // 从环境变量获取代理配置
  const proxyHost = process.env.PROXY_HOST
  const proxyPort = process.env.PROXY_PORT
  const proxyUsername = process.env.PROXY_USERNAME
  const proxyPassword = process.env.PROXY_PASSWORD

  // 如果没有配置代理，返回 undefined
  if (!proxyHost || !proxyPort) {
    return undefined
  }

  const config: ProxyConfig = {
    host: proxyHost,
    port: parseInt(proxyPort, 10),
  }

  // 如果配置了认证信息
  if (proxyUsername && proxyPassword) {
    config.auth = {
      username: proxyUsername,
      password: proxyPassword,
    }
  }

  return config
}
