export function normalizeCsvHeaderCell(value: unknown) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '') // 兼容UTF-8 BOM（常见于Excel导出的CSV首列）
    .trim()
}

export function canonicalizeOfferBatchCsvHeader(value: unknown) {
  const raw = normalizeCsvHeaderCell(value)
  const compact = raw.replace(/\s+/g, '')
  const lower = raw.toLowerCase()
  const lowerCompact = compact.toLowerCase()

  const extracted: string[] = []

  // 兼容：推广链接 (affiliate_link)、推广链接（affiliate_link）、affiliate_link（推广链接）
  for (const match of raw.matchAll(/[（(]([^）)]+)[）)]/g)) {
    extracted.push(match[1].trim())
  }

  // 兼容：推广链接/affiliate_link、推广链接｜affiliate_link
  for (const part of raw.split(/[\/|｜]/g)) {
    extracted.push(part.trim())
  }

  const tokens = new Set<string>()
  for (const token of [raw, compact, lower, lowerCompact, ...extracted]) {
    const normalized = token
      .replace(/\s+/g, '')
      .toLowerCase()
      .replace(/[_-]/g, '')
    if (normalized) tokens.add(normalized)
  }

  const has = (predicate: (t: string) => boolean) => {
    for (const t of tokens) if (predicate(t)) return true
    return false
  }

  if (has(t =>
    t.includes('productlink1') ||
    t.includes('storeproductlink1') ||
    t.includes('单品链接1') ||
    t.includes('单品推广链接1') ||
    t.includes('商品链接1') ||
    t.includes('产品链接1')
  )) {
    return 'product_link_1'
  }
  if (has(t =>
    t.includes('productlink2') ||
    t.includes('storeproductlink2') ||
    t.includes('单品链接2') ||
    t.includes('单品推广链接2') ||
    t.includes('商品链接2') ||
    t.includes('产品链接2')
  )) {
    return 'product_link_2'
  }
  if (has(t =>
    t.includes('productlink3') ||
    t.includes('storeproductlink3') ||
    t.includes('单品链接3') ||
    t.includes('单品推广链接3') ||
    t.includes('商品链接3') ||
    t.includes('产品链接3')
  )) {
    return 'product_link_3'
  }
  if (has(t => t === 'affiliatelink' || t.includes('affiliatelink') || t.includes('推广链接'))) {
    return 'affiliate_link'
  }
  if (has(t => t === 'targetcountry' || t.includes('targetcountry') || t.includes('推广国家'))) {
    return 'target_country'
  }
  if (has(t => t === 'brandname' || t.includes('brandname') || t === 'brand' || t.includes('品牌名') || t.includes('品牌名称') || t === '品牌')) {
    return 'brand_name'
  }
  if (has(t => t === 'pagetype' || t.includes('pagetype') || t.includes('page_type') || t.includes('链接类型') || t.includes('页面类型') || t.includes('linktype'))) {
    return 'page_type'
  }
  if (has(t =>
    t === 'productprice' ||
    t.includes('productprice') ||
    t.includes('产品价格') ||
    t.includes('平均产品价格') ||
    t.includes('avgproductprice') ||
    t.includes('averageproductprice')
  )) {
    return 'product_price'
  }
  if (has(t =>
    t === 'commissionpayout' ||
    t.includes('commissionpayout') ||
    t.includes('佣金比例') ||
    t.includes('平均佣金比例') ||
    t.includes('avgcommissionpayout') ||
    t.includes('averagecommissionpayout')
  )) {
    return 'commission_payout'
  }
  if (has(t =>
    t === 'commissiontype' ||
    t.includes('commissiontype') ||
    t.includes('commissionmode') ||
    t.includes('佣金类型') ||
    t.includes('佣金模式')
  )) {
    return 'commission_type'
  }
  if (has(t =>
    t === 'commissionvalue' ||
    t.includes('commissionvalue') ||
    t.includes('佣金值') ||
    t.includes('佣金数值') ||
    t.includes('佣金金额')
  )) {
    return 'commission_value'
  }
  if (has(t =>
    t === 'commissioncurrency' ||
    t.includes('commissioncurrency') ||
    t.includes('佣金币种') ||
    t.includes('佣金货币')
  )) {
    return 'commission_currency'
  }
  return raw.toLowerCase()
}

function countReplacementChars(text: string) {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) count++
  }
  return count
}

export function decodeCsvTextSmart(bytes: Uint8Array) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // 兼容：Excel在中文系统中导出的CSV可能是GBK/GB18030编码
  let gb18030: string | null = null
  try {
    gb18030 = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
  } catch {
    gb18030 = null
  }

  if (!gb18030) return utf8

  return countReplacementChars(utf8) <= countReplacementChars(gb18030) ? utf8 : gb18030
}
