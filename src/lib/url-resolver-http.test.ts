import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { extractEmbeddedTargetUrl, resolveAffiliateLinkWithHttp } from './url-resolver-http'

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to listen'))
        return
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

describe('resolveAffiliateLinkWithHttp', () => {
  it('resolves redirect chain via HEAD (no GET body download)', async () => {
    let getCount = 0

    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.method === 'GET') getCount++

      if (req.url === '/start' && req.method === 'HEAD') {
        res.statusCode = 302
        res.setHeader('Location', '/next')
        res.end()
        return
      }

      if (req.url === '/next' && req.method === 'HEAD') {
        res.statusCode = 301
        res.setHeader('Location', '/final?x=1')
        res.end()
        return
      }

      if (req.url.startsWith('/final') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 500
      res.end()
    })

    const { port, close } = await listen(server)
    try {
      const startUrl = `http://127.0.0.1:${port}/start`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/final`)
      expect(result.finalUrlSuffix).toBe('x=1')
      expect(result.redirectCount).toBe(2)
      expect(getCount).toBe(0)
    } finally {
      await close()
    }
  })

  it('can follow a JS/meta-style redirect without downloading full body', async () => {
    let openStreams = 0

    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.url === '/click' && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      if (req.url === '/click' && req.method === 'GET') {
        openStreams++
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')

        const interval = setInterval(() => {
          res.write(' ')
        }, 50)

        req.on('close', () => {
          clearInterval(interval)
          openStreams--
        })

        res.write('<html><head>')
        res.write("<script>window.location.href='/final?y=2'</script>")
        // keep connection open; resolver should read a snippet then abort
        return
      }

      if (req.url.startsWith('/final') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 404
      res.end()
    })

    const { port, close } = await listen(server)
    try {
      const startUrl = `http://127.0.0.1:${port}/click`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/final`)
      expect(result.finalUrlSuffix).toBe('y=2')
    } finally {
      await close()
    }

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(openStreams).toBe(0)
  })

  it('handles JS redirect via变量赋值再跳转', async () => {
    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.url === '/track' && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      if (req.url === '/track' && req.method === 'GET') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(`
          <html><head>
            <script>
              function dm() {
                var u = "/final?z=3";
                location.replace(u);
              }
              setTimeout(dm, 10);
            </script>
          </head></html>
        `)
        return
      }

      if (req.url.startsWith('/final') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 404
      res.end()
    })

    const { port, close } = await listen(server)
    try {
      const startUrl = `http://127.0.0.1:${port}/track`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/final`)
      expect(result.finalUrlSuffix).toBe('z=3')
    } finally {
      await close()
    }
  })

  it('extracts embedded target URL from linkbux tracking page', () => {
    const trackingUrl = 'https://www.linkbux.com/403?url=https%3A%2F%2Fswansonvitamins.com'
    const extracted = extractEmbeddedTargetUrl(trackingUrl)
    expect(extracted).toBe('https://swansonvitamins.com')
  })

  it('extracts embedded target URL from linkhaitao new parameter', () => {
    const trackingUrl = 'https://www.linkhaitao.com/index.php?mod=lhdeal&track=abc&new=https%3A%2F%2Fwww.mgmresorts.com%2Fen.html'
    const extracted = extractEmbeddedTargetUrl(trackingUrl)
    expect(extracted).toBe('https://www.mgmresorts.com/en.html')
  })

  it('falls back to wrapper query params when only target URL param matches final host', async () => {
    let boundPort = 0
    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.url.startsWith('/start') && req.method === 'HEAD') {
        const targetUrl = `http://127.0.0.1:${boundPort}/landing`
        res.statusCode = 302
        res.setHeader('Location', targetUrl)
        res.end()
        return
      }

      if (req.url.startsWith('/landing') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 404
      res.end()
    })

    const { port, close } = await listen(server)
    boundPort = port
    try {
      const landingUrl = `http://127.0.0.1:${port}/landing`
      const startUrl = `http://localhost:${port}/start?mod=lhdeal&track=abc123&new=${encodeURIComponent(landingUrl)}`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(landingUrl)
      expect(result.finalUrlSuffix).toBe('mod=lhdeal&track=abc123')
    } finally {
      await close()
    }
  })

  it('probes html redirect when tracking url carries new parameter and captures final clickref suffix', async () => {
    let boundPort = 0
    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.url.startsWith('/start') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      if (req.url.startsWith('/start') && req.method === 'GET') {
        const next = `http://127.0.0.1:${boundPort}/landing?clickref=abc123`
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(`<html><head><script>location.replace('${next}')</script></head></html>`)
        return
      }

      if (req.url.startsWith('/landing') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 404
      res.end()
    })

    const { port, close } = await listen(server)
    boundPort = port

    try {
      const target = `http://127.0.0.1:${port}/landing`
      const startUrl = `http://localhost:${port}/start?mod=lhdeal&track=abc123&new=${encodeURIComponent(target)}`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(target)
      expect(result.finalUrlSuffix).toBe('clickref=abc123')
      expect(result.redirectChain.some((url) => url.includes('/landing?clickref=abc123'))).toBe(true)
    } finally {
      await close()
    }
  })
})
