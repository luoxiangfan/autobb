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
  AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS,
  AD_CREATIVE_GENERATION_MODE_LABELS,
  type AdCreativeGenerationMode,
} from '@/lib/ad-creative-generation-mode'

type AdCreativeGenerationModeFieldProps = {
  id?: string
  value: AdCreativeGenerationMode
  onChange: (mode: AdCreativeGenerationMode) => void
  disabled?: boolean
  className?: string
  descriptionClassName?: string
}

const MODES = Object.keys(AD_CREATIVE_GENERATION_MODE_LABELS) as AdCreativeGenerationMode[]

export function AdCreativeGenerationModeField({
  id = 'generationMode',
  value,
  onChange,
  disabled = false,
  className,
  descriptionClassName = 'text-xs text-gray-500 mt-1',
}: AdCreativeGenerationModeFieldProps) {
  return (
    <div className={className ?? 'space-y-1.5 min-w-[200px]'}>
      <Label htmlFor={id} className="text-sm text-gray-700">
        生成模式
      </Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as AdCreativeGenerationMode)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9 bg-white">
          <SelectValue placeholder="选择生成模式" />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {AD_CREATIVE_GENERATION_MODE_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className={descriptionClassName}>
        {AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS[value]}
      </p>
    </div>
  )
}
