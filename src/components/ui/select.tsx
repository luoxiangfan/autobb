'use client'

import React from 'react'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  padding?: string
}

export interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {}
export interface SelectItemProps extends React.OptionHTMLAttributes<HTMLOptionElement> {}
export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}
export interface SelectValueProps {
  placeholder?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps & { onValueChange?: (value: string) => void }>(
  ({ className = '', padding = 'py-2', children, onValueChange, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 ${padding} text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...props}
      >
        {children}
      </select>
    )
  }
)
Select.displayName = 'Select'

export function SelectContent({ children }: SelectContentProps) {
  return <>{children}</>
}

export function SelectItem({ children, ...props }: SelectItemProps) {
  return <option {...props}>{children}</option>
}

export function SelectTrigger({ children, className = '', ...props }: SelectTriggerProps) {
  return <>{children}</>
}

export function SelectValue({ placeholder }: SelectValueProps) {
  return <option value="" disabled>{placeholder}</option>
}
