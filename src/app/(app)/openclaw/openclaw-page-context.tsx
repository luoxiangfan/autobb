'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useOpenClawPage, type OpenClawPageViewModel } from './use-openclaw-page'

const OpenClawPageContext = createContext<OpenClawPageViewModel | null>(null)

export function OpenClawPageProvider({ children }: { children: ReactNode }) {
  const value = useOpenClawPage()
  return <OpenClawPageContext.Provider value={value}>{children}</OpenClawPageContext.Provider>
}

export function useOpenClawPageContext(): OpenClawPageViewModel {
  const value = useContext(OpenClawPageContext)
  if (!value) {
    throw new Error('useOpenClawPageContext must be used within OpenClawPageProvider')
  }
  return value
}
