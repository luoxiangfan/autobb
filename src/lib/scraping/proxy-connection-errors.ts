/**
 * Playwright / proxy connection error detection (shared by scraping resolvers and stealth scrapers).
 */

export function isProxyConnectionError(error: Error): boolean {
  const msg = error.message || ''

  if (msg.includes('407') || msg.includes('Proxy Authentication Required')) {
    console.warn('⚠️ HTTP 407: 代理认证失败，凭证可能已过期')
    return true
  }

  if (
    msg.includes('Proxy connection ended') ||
    msg.includes('net::ERR_PROXY') ||
    msg.includes('ERR_TUNNEL_CONNECTION_FAILED')
  ) {
    return true
  }

  if (msg.includes('ERR_HTTP2_PROTOCOL_ERROR') || msg.includes('net::ERR_HTTP2_PROTOCOL_ERROR')) {
    return true
  }

  if (msg.includes('ERR_CONNECTION_RESET') || msg.includes('net::ERR_CONNECTION_RESET')) {
    return true
  }

  if (
    (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) &&
    msg.toLowerCase().includes('proxy')
  ) {
    return true
  }

  if (msg.includes('EPROTO') || msg.includes('wrong version number')) {
    return true
  }

  if (msg.includes('ETIMEDOUT') && msg.toLowerCase().includes('proxy')) {
    return true
  }

  if (msg.includes('ERR_EMPTY_RESPONSE')) {
    return true
  }

  if (msg.includes('page.goto: Timeout') && msg.includes('exceeded')) {
    return true
  }

  if (msg.includes('net::ERR_TIMED_OUT') && msg.includes('page.goto:')) {
    return true
  }

  if (
    msg.includes('Timeout') &&
    (msg.includes('proxy') || msg.includes('tunnel') || msg.includes('CONNECT'))
  ) {
    return true
  }

  return false
}
