import Image, { ImageProps } from 'next/image'
import { useState } from 'react'

interface OptimizedImageProps extends Omit<ImageProps, 'onError'> {
  fallbackSrc?: string
  showLoader?: boolean
}

/**
 * OptimizedImage component with loading states and error handling
 *
 * Features:
 * - Automatic loading placeholder
 * - Error fallback support
 * - Blur placeholder for better UX
 * - Optimized sizes based on viewport
 */
export function OptimizedImage({
  src,
  alt,
  fallbackSrc = '/logo.png',
  showLoader = true,
  className = '',
  ...props
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  return (
    <div className="relative">
      {isLoading && showLoader && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse rounded" />
      )}
      <Image
        src={error ? fallbackSrc : src}
        alt={alt}
        className={`${className} ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
        onLoadingComplete={() => setIsLoading(false)}
        onError={() => {
          setError(true)
          setIsLoading(false)
        }}
        {...props}
      />
    </div>
  )
}

/**
 * Avatar component with optimized loading
 */
export function OptimizedAvatar({
  src,
  alt,
  size = 40,
  className = '',
}: {
  src: string
  alt: string
  size?: number
  className?: string
}) {
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      fallbackSrc="/logo.png"
    />
  )
}

/**
 * Logo component with optimized loading
 */
export function OptimizedLogo({
  size = 'medium',
  className = '',
}: {
  size?: 'small' | 'medium' | 'large'
  className?: string
}) {
  const sizes = {
    small: { width: 32, height: 32 },
    medium: { width: 48, height: 48 },
    large: { width: 64, height: 64 },
  }

  const { width, height } = sizes[size]

  return (
    <Image
      src="/logo.png"
      alt="AutoAds Logo"
      width={width}
      height={height}
      className={className}
      priority // Logo should load first
    />
  )
}

/**
 * Brand icon with optimized loading
 */
export function OptimizedBrandIcon({
  brand,
  size = 24,
  className = '',
}: {
  brand: 'google' | 'facebook' | 'microsoft' | 'apple' | 'twitter' | 'github'
  size?: number
  className?: string
}) {
  const brandIcons = {
    google: '/google.webp',
    facebook: '/facebook.webp',
    microsoft: '/microsoft.webp',
    apple: '/apple.webp',
    twitter: '/twitter.webp',
    github: '/github.webp',
  }

  return (
    <OptimizedImage
      src={brandIcons[brand]}
      alt={`${brand} icon`}
      width={size}
      height={size}
      className={className}
    />
  )
}

/**
 * Offer cover image with optimized loading and aspect ratio
 */
export function OfferCoverImage({
  src,
  alt,
  className = '',
}: {
  src: string
  alt: string
  className?: string
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-gray-100">
      <OptimizedImage
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className={`object-cover ${className}`}
        fallbackSrc="/dashboard.webp"
      />
    </div>
  )
}
