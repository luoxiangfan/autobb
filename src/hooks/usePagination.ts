'use client'

/**
 * usePagination - 统一分页状态管理Hook
 *
 * 用途：
 * - 管理分页状态 (currentPage, pageSize)
 * - 提供便捷的分页操作方法
 * - 计算分页元数据
 *
 * 使用示例：
 * const { currentPage, pageSize, setPage, setPageSize, offset, resetPage } = usePagination()
 */

import { useState, useCallback, useMemo } from 'react'

export interface UsePaginationOptions {
  /** 初始页码，默认 1 */
  initialPage?: number
  /** 初始每页条数，默认 10 */
  initialPageSize?: number
  /** 可选的每页条数选项 */
  pageSizeOptions?: number[]
}

export interface UsePaginationReturn {
  /** 当前页码 (1-based) */
  currentPage: number
  /** 每页条数 */
  pageSize: number
  /** 设置页码 */
  setPage: (page: number) => void
  /** 设置每页条数（会自动重置到第1页） */
  setPageSize: (size: number) => void
  /** 重置到第1页 */
  resetPage: () => void
  /** 计算 offset (用于 API 查询) */
  offset: number
  /** 计算总页数 */
  getTotalPages: (total: number) => number
  /** 是否有下一页 */
  hasNextPage: (total: number) => boolean
  /** 是否有上一页 */
  hasPrevPage: boolean
  /** 下一页 */
  nextPage: () => void
  /** 上一页 */
  prevPage: () => void
  /** 可选的每页条数选项 */
  pageSizeOptions: number[]
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function usePagination(options?: UsePaginationOptions): UsePaginationReturn {
  const {
    initialPage = 1,
    initialPageSize = 10,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  } = options || {}

  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize, setPageSizeState] = useState(initialPageSize)

  // 设置页码
  const setPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, page))
  }, [])

  // 设置每页条数，自动重置到第1页
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setCurrentPage(1)
  }, [])

  // 重置到第1页
  const resetPage = useCallback(() => {
    setCurrentPage(1)
  }, [])

  // 计算 offset
  const offset = useMemo(() => (currentPage - 1) * pageSize, [currentPage, pageSize])

  // 计算总页数
  const getTotalPages = useCallback((total: number) => {
    return Math.ceil(total / pageSize)
  }, [pageSize])

  // 是否有下一页
  const hasNextPage = useCallback((total: number) => {
    return currentPage < getTotalPages(total)
  }, [currentPage, getTotalPages])

  // 是否有上一页
  const hasPrevPage = currentPage > 1

  // 下一页
  const nextPage = useCallback(() => {
    setCurrentPage(prev => prev + 1)
  }, [])

  // 上一页
  const prevPage = useCallback(() => {
    setCurrentPage(prev => Math.max(1, prev - 1))
  }, [])

  return {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    resetPage,
    offset,
    getTotalPages,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    pageSizeOptions,
  }
}
