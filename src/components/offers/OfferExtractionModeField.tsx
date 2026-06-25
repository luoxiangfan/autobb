'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  OFFER_EXTRACTION_MODE_DESCRIPTIONS,
  OFFER_EXTRACTION_MODE_LABELS,
  type OfferExtractionMode,
} from '@/lib/offers'

type OfferExtractionModeFieldProps = {
  id?: string
  value: OfferExtractionMode
  onChange: (mode: OfferExtractionMode) => void
  /* * shadcn Select（弹窗/创建）或 native select（编辑页表单） */
  variant?: 'shadcn' | 'native'
  label?: string
  className?: string
  descriptionClassName?: string
}

const MODES = Object.keys(OFFER_EXTRACTION_MODE_LABELS) as OfferExtractionMode[]

export function OfferExtractionModeField({
  id = 'extractionMode',
  value,
  onChange,
  variant = 'shadcn',
  label = '提取模式',
  className,
  descriptionClassName = 'text-xs text-gray-500 mt-1',
}: OfferExtractionModeFieldProps) {
  if (variant === 'native') {
    return (
      <div className={className}>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        <select
          id={id}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-xs focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value as OfferExtractionMode)}
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {OFFER_EXTRACTION_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
        <p className={descriptionClassName}>{OFFER_EXTRACTION_MODE_DESCRIPTIONS[value]}</p>
      </div>
    )
  }

  return (
    <div className={className ?? 'space-y-2'}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as OfferExtractionMode)}>
        <SelectTrigger id={id} className="mt-1">
          <SelectValue placeholder="选择提取模式" />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {OFFER_EXTRACTION_MODE_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className={descriptionClassName ?? 'text-xs text-slate-500 mt-1'}>
        {OFFER_EXTRACTION_MODE_DESCRIPTIONS[value]}
      </p>
    </div>
  )
}
