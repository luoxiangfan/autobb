'use client'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'

export function InputWithLabel(props: {
  label: string
  value: string
  placeholder?: string
  type?: string
  disabled?: boolean
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      <Input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </div>
  )
}

export function SwitchWithLabel(props: {
  label: string
  checked: boolean
  disabled?: boolean
  required?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  )
}

export function KpiCard(props: { title: string; value: string | number }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full min-h-[96px] flex-col justify-center gap-2 py-4">
        <CardDescription className="leading-none">{props.title}</CardDescription>
        <CardTitle className="text-2xl leading-none tracking-tight tabular-nums">{props.value}</CardTitle>
      </CardContent>
    </Card>
  )
}
