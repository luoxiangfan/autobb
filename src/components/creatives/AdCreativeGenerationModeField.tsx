'use client'

import { HelpCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  /** stacked: label + select + description; inline: compact row with tooltip for description */
  layout?: 'stacked' | 'inline'
}

const MODES = Object.keys(AD_CREATIVE_GENERATION_MODE_LABELS) as AdCreativeGenerationMode[]

function ModeDescriptionHint({ description }: { description: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="查看生成模式说明"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function AdCreativeGenerationModeField({
  id = 'generationMode',
  value,
  onChange,
  disabled = false,
  className,
  descriptionClassName = 'text-xs leading-relaxed text-gray-500 mt-1.5',
  layout = 'stacked',
}: AdCreativeGenerationModeFieldProps) {
  const description = AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS[value]

  if (layout === 'inline') {
    return (
      <div className={className ?? 'min-w-[180px]'}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-gray-500">
            生成模式
          </Label>
          <ModeDescriptionHint description={description} />
        </div>
        <Select
          value={value}
          onValueChange={(v) => onChange(v as AdCreativeGenerationMode)}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="h-10 border-gray-200/90 bg-white shadow-sm transition-shadow hover:border-purple-200 focus:ring-purple-500/20"
          >
            <SelectValue placeholder="选择生成模式" />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                <span className="font-medium">{AD_CREATIVE_GENERATION_MODE_LABELS[mode]}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS[mode].split('：')[0]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className={className ?? 'min-w-[200px] space-y-1.5'}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-sm font-medium text-gray-700">
          生成模式
        </Label>
        <ModeDescriptionHint description={description} />
      </div>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as AdCreativeGenerationMode)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="h-9 border-gray-200/90 bg-white shadow-sm transition-shadow hover:border-purple-200"
        >
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
      <p className={descriptionClassName}>{description}</p>
    </div>
  )
}
