/**
 * Domain classification for smart routing
 * Determines which resolver method (HTTP vs Playwright) to use
 */

/**
 * HTTP重定向域名白名单
 * These domains use standard HTTP 3xx redirects that can be resolved quickly
 */
export const HTTP_REDIRECT_DOMAINS = [
  // Amazon Associates
  'amzn.to',
  'amazon.com',
  'a.co',

  // ClickBank
  'hop.clickbank.net',
  'clickbank.net',

  // ShareASale
  'shareasale.com',
  'shareasale-analytics.com',

  // Commission Junction (CJ)
  'anrdoezrs.net',
  'dpbolvw.net',
  'jdoqocy.com',
  'tkqlhce.com',
  'qksrv.net',

  // Rakuten Marketing
  'rakuten.com',
  'linksynergy.com',

  // Impact
  'impact.com',
  'impactradius.com',

  // Awin
  'awin1.com',

  // Traditional URL Shorteners
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  't.co',

  // YeahPromos (需要验证 - to be verified)
  'yeahpromos.com',
];

/**
 * Meta Refresh重定向域名
 * These domains use HTTP meta refresh headers (can be parsed from HTTP response)
 */
export const META_REFRESH_DOMAINS = [
  'yeahpromos.com',
];

/**
 * JavaScript重定向域名黑名单
 * These domains require browser JavaScript execution (Playwright required)
 */
export const JS_REDIRECT_DOMAINS = [
  // LinkBux (JS redirect / anti-bot)
  'linkbux.com',
  // Modern Link Shorteners
  'pboost.me',
  'linktree.com',
  'linktr.ee',
  'beacons.ai',
  'solo.to',
  'tap.bio',
  'bio.link',

  // Social Media Shorteners
  'instagram.com',
  'fb.me',
  'youtube.com',
];

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch (error) {
    console.error('Invalid URL for domain extraction:', url);
    return '';
  }
}

/**
 * Check if domain requires JavaScript rendering
 */
export function requiresJavaScript(url: string): boolean {
  const domain = extractDomain(url);
  return JS_REDIRECT_DOMAINS.some(jsDomain =>
    domain === jsDomain || domain.endsWith(`.${jsDomain}`)
  );
}

/**
 * Check if domain is known to use HTTP redirects
 */
export function usesHttpRedirect(url: string): boolean {
  const domain = extractDomain(url);
  return HTTP_REDIRECT_DOMAINS.some(httpDomain =>
    domain === httpDomain || domain.endsWith(`.${httpDomain}`)
  );
}

/**
 * Check if domain uses meta refresh redirects
 */
export function usesMetaRefresh(url: string): boolean {
  const domain = extractDomain(url);
  return META_REFRESH_DOMAINS.some(metaDomain =>
    domain === metaDomain || domain.endsWith(`.${metaDomain}`)
  );
}

/**
 * Determine optimal resolver method for URL
 * Returns: 'http' | 'playwright' | 'http-with-fallback'
 */
export function getOptimalResolver(url: string): 'http' | 'playwright' | 'http-with-fallback' {
  // JavaScript domains → Direct to Playwright
  if (requiresJavaScript(url)) {
    return 'playwright';
  }

  // Known HTTP redirect domains (including meta refresh) → Direct to HTTP
  if (usesHttpRedirect(url) || usesMetaRefresh(url)) {
    return 'http';
  }

  // Unknown domain → Try HTTP first, fallback to Playwright if needed
  return 'http-with-fallback';
}
