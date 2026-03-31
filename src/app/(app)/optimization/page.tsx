'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 优化迭代主入口页面
 * 自动重定向到优化概览页面
 */
export default function OptimizationPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/optimization/overview')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
    </div>
  )
}
