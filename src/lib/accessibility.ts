/**
 * Accessibility utilities - P2-5优化新增
 * ARIA labels, 键盘导航, 焦点管理
 */

/**
 * 键盘事件处理器
 */
export const createKeyboardHandler = (handlers: {
  onEnter?: () => void
  onEscape?: () => void
  onSpace?: () => void
  onArrowUp?: () => void
  onArrowDown?: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onTab?: () => void
}) => {
  return (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
        handlers.onEnter?.()
        break
      case 'Escape':
        handlers.onEscape?.()
        break
      case ' ':
      case 'Spacebar':
        event.preventDefault() // 防止页面滚动
        handlers.onSpace?.()
        break
      case 'ArrowUp':
        event.preventDefault()
        handlers.onArrowUp?.()
        break
      case 'ArrowDown':
        event.preventDefault()
        handlers.onArrowDown?.()
        break
      case 'ArrowLeft':
        handlers.onArrowLeft?.()
        break
      case 'ArrowRight':
        handlers.onArrowRight?.()
        break
      case 'Tab':
        handlers.onTab?.()
        break
    }
  }
}

/**
 * 焦点陷阱管理（用于模态框）
 */
export const createFocusTrap = (containerRef: HTMLElement) => {
  const focusableElements = containerRef.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )

  const firstElement = focusableElements[0] as HTMLElement
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return

    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        event.preventDefault()
        lastElement?.focus()
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        event.preventDefault()
        firstElement?.focus()
      }
    }
  }

  containerRef.addEventListener('keydown', handleKeyDown)

  // 返回清理函数
  return () => {
    containerRef.removeEventListener('keydown', handleKeyDown)
  }
}

/**
 * 屏幕阅读器公告
 */
export const announceToScreenReader = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
  const announcement = document.createElement('div')
  announcement.setAttribute('role', 'status')
  announcement.setAttribute('aria-live', priority)
  announcement.setAttribute('aria-atomic', 'true')
  announcement.style.position = 'absolute'
  announcement.style.left = '-10000px'
  announcement.style.width = '1px'
  announcement.style.height = '1px'
  announcement.style.overflow = 'hidden'
  announcement.textContent = message

  document.body.appendChild(announcement)

  setTimeout(() => {
    document.body.removeChild(announcement)
  }, 1000)
}

/**
 * ARIA labels辅助函数
 */
export const createAriaLabel = (action: string, target: string, context?: string) => {
  const parts = [action, target]
  if (context) parts.push(context)
  return parts.join(' ')
}

/**
 * 可访问性验证
 */
export const checkAccessibility = {
  /**
   * 检查元素是否有适当的ARIA标签
   */
  hasProperLabel: (element: HTMLElement): boolean => {
    return !!(
      element.getAttribute('aria-label') ||
      element.getAttribute('aria-labelledby') ||
      element.textContent?.trim()
    )
  },

  /**
   * 检查交互元素是否可键盘访问
   */
  isKeyboardAccessible: (element: HTMLElement): boolean => {
    const tagName = element.tagName.toLowerCase()
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea']
    return (
      interactiveTags.includes(tagName) ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('role')
    )
  },

  /**
   * 检查颜色对比度是否足够（简化版）
   */
  hasProperContrast: (foreground: string, background: string): boolean => {
    // 这是一个简化实现，实际应该使用WCAG对比度算法
    return foreground !== background
  },
}

/**
 * 键盘导航辅助
 */
export const createListNavigation = (items: HTMLElement[], options?: {
  loop?: boolean
  orientation?: 'vertical' | 'horizontal'
}) => {
  const { loop = true, orientation = 'vertical' } = options || {}
  let currentIndex = 0

  const focusItem = (index: number) => {
    if (items[index]) {
      items[index].focus()
      currentIndex = index
    }
  }

  const next = () => {
    const nextIndex = currentIndex + 1
    if (nextIndex < items.length) {
      focusItem(nextIndex)
    } else if (loop) {
      focusItem(0)
    }
  }

  const previous = () => {
    const prevIndex = currentIndex - 1
    if (prevIndex >= 0) {
      focusItem(prevIndex)
    } else if (loop) {
      focusItem(items.length - 1)
    }
  }

  return {
    next,
    previous,
    focusCurrent: () => focusItem(currentIndex),
    focusFirst: () => focusItem(0),
    focusLast: () => focusItem(items.length - 1),
    getCurrentIndex: () => currentIndex,
  }
}
