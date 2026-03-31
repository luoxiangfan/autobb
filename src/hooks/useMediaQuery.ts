'use client'

/**
 * useMediaQuery - P2-4移动端优化
 * 响应式媒体查询Hook
 */

import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)

    // 初始化状态
    if (media.matches !== matches) {
      setMatches(media.matches)
    }

    // 监听变化
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)

    // 兼容旧版浏览器
    if (media.addEventListener) {
      media.addEventListener('change', listener)
    } else {
      media.addListener(listener)
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', listener)
      } else {
        media.removeListener(listener)
      }
    }
  }, [matches, query])

  return matches
}

// 常用响应式断点
export const useIsMobile = () => useMediaQuery('(max-width: 768px)')
export const useIsTablet = () => useMediaQuery('(min-width: 769px) and (max-width: 1024px)')
export const useIsDesktop = () => useMediaQuery('(min-width: 1025px)')
