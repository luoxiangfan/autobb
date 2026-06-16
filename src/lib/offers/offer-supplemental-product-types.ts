export type SupplementalProductResult = {
  sourceAffiliateLink: string
  finalUrl: string | null
  finalUrlSuffix?: string | null
  pageType?: string | null
  productName?: string | null
  productPrice?: string | null
  productDescription?: string | null
  brandName?: string | null
  productFeatures?: string[] | null
  rating?: string | null
  reviewCount?: string | null
  reviewHighlights?: string[] | null
  topReviews?: string[] | null
  imageUrls?: string[] | null
  category?: string | null
  error?: string | null
}
