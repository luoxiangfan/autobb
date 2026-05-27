'use client'

import { HelpCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS,
  AD_CREATIVE_GENERATION_MODE_SELECT_LABELS,
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

const MODES = Object.keys(AD_CREATIVE_GENERATION_MODE_SELECT_LABELS) as AdCreativeGenerationMode[]

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

  const selectClassName =
    layout === 'inline'
      ? 'h-10 min-w-[11rem] border-gray-200/90 bg-white pr-8 shadow-sm transition-shadow hover:border-purple-200 focus:ring-purple-500/20'
      : 'h-9 border-gray-200/90 bg-white shadow-sm transition-shadow hover:border-purple-200'

  if (layout === 'inline') {
    return (
      <div className={className ?? 'min-w-[11rem]'}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-gray-500">
            生成模式
          </Label>
          <ModeDescriptionHint description={description} />
        </div>
        <Select
          id={id}
          value={value}
          title={description}
          onValueChange={(v) => onChange(v as AdCreativeGenerationMode)}
          disabled={disabled}
          className={selectClassName}
        >
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem
                key={mode}
                value={mode}
                title={AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS[mode]}
              >
                {AD_CREATIVE_GENERATION_MODE_SELECT_LABELS[mode]}
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
        id={id}
        value={value}
        title={description}
        onValueChange={(v) => onChange(v as AdCreativeGenerationMode)}
        disabled={disabled}
        className={selectClassName}
      >
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem
              key={mode}
              value={mode}
              title={AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS[mode]}
            >
              {AD_CREATIVE_GENERATION_MODE_SELECT_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className={descriptionClassName}>{description}</p>
    </div>
  )
}
