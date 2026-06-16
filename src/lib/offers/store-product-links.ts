/** 店铺模式下单品推广链接数量上限（输入、存储、抓取、创意生成共用） */
export const MAX_STORE_PRODUCT_LINKS = 6 as const

export function storeProductLinksTypeError(): string {
  return `store_product_links 必须为URL数组（最多${MAX_STORE_PRODUCT_LINKS}个）`
}

/** 去重、去空白并截断到 {@link MAX_STORE_PRODUCT_LINKS} */
export function normalizeStoreProductLinkList(
  links: Iterable<string> | null | undefined
): string[] {
  if (!links) return []
  return Array.from(
    new Set(
      Array.from(links)
        .map((link) => (typeof link === 'string' ? link.trim() : ''))
        .filter(Boolean)
    )
  ).slice(0, MAX_STORE_PRODUCT_LINKS)
}
