'use client'

import * as React from 'react'
import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { DateRange, DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'

import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type { DateRange }

interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  placeholder?: string
  className?: string
  variant?: 'default' | 'ghost'
  size?: 'default' | 'sm' | 'lg'
  maxDate?: Date
  minDate?: Date
  showPresets?: boolean
  showClearButton?: boolean
  compact?: boolean
}

const presetRanges = [
  { label: '今天', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: '昨天', getValue: () => { const yesterday = subDays(new Date(), 1); return { from: startOfDay(yesterday), to: endOfDay(yesterday) } } },
  { label: '最近7天', getValue: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { label: '最近30天', getValue: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }) },
  { label: '本月', getValue: () => ({ from: startOfMonth(new Date()), to: endOfDay(new Date()) }) },
  { label: '上月', getValue: () => { const lastMonth = subDays(startOfMonth(new Date()), 1); return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) } } },
]

const normalizeRange = (range: DateRange | undefined): DateRange | undefined => {
  if (!range?.from) return undefined
  return {
    from: startOfDay(range.from),
    to: range.to ? startOfDay(range.to) : undefined,
  }
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = '选择日期范围',
  className,
  variant = 'ghost',
  size = 'sm',
  maxDate,
  minDate,
  showPresets = true,
  showClearButton = true,
  compact = false,
}: DateRangePickerProps) {
  const [date, setDate] = React.useState<DateRange | undefined>(() => normalizeRange(value))
  const [draftDate, setDraftDate] = React.useState<DateRange | undefined>(() => normalizeRange(value))
  const [isOpen, setIsOpen] = React.useState(false)
  const [showTwoMonths, setShowTwoMonths] = React.useState(false)
  const [isMobile, setIsMobile] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const monthCount = compact ? 1 : (showTwoMonths ? 2 : 1)
  const normalizedMinDate = React.useMemo(() => (minDate ? startOfDay(minDate) : undefined), [minDate])
  const normalizedMaxDate = React.useMemo(() => (maxDate ? endOfDay(maxDate) : undefined), [maxDate])
  const minMonth = React.useMemo(
    () => (normalizedMinDate ? startOfMonth(normalizedMinDate) : undefined),
    [normalizedMinDate]
  )
  const maxMonth = React.useMemo(
    () => (normalizedMaxDate ? startOfMonth(normalizedMaxDate) : undefined),
    [normalizedMaxDate]
  )

  const clampMonth = React.useCallback((candidate: Date) => {
    let nextMonth = startOfMonth(candidate)

    if (minMonth && isBefore(nextMonth, minMonth)) {
      nextMonth = minMonth
    }
    if (maxMonth && isAfter(nextMonth, maxMonth)) {
      nextMonth = maxMonth
    }
    if (maxMonth && monthCount > 1) {
      const latestAllowedStartMonth = addMonths(maxMonth, -(monthCount - 1))
      if (isAfter(nextMonth, latestAllowedStartMonth)) {
        nextMonth = latestAllowedStartMonth
      }
    }

    return nextMonth
  }, [maxMonth, minMonth, monthCount])

  const [visibleMonth, setVisibleMonth] = React.useState<Date>(() => (
    startOfMonth(value?.from ?? normalizedMaxDate ?? new Date())
  ))

  React.useEffect(() => {
    const nextRange = normalizeRange(value)
    setDate(nextRange)
    setDraftDate(nextRange)
  }, [value])

  React.useEffect(() => {
    setVisibleMonth((current) => clampMonth(current))
  }, [clampMonth])

  React.useEffect(() => {
    if (compact || typeof window === 'undefined') {
      setShowTwoMonths(false)
      return
    }

    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    const syncLayout = () => {
      setShowTwoMonths(mediaQuery.matches)
    }
    syncLayout()
    mediaQuery.addEventListener('change', syncLayout)
    return () => mediaQuery.removeEventListener('change', syncLayout)
  }, [compact])

  React.useEffect(() => {
    if (!compact || typeof window === 'undefined') {
      setIsMobile(false)
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const syncIsMobile = () => {
      setIsMobile(mediaQuery.matches)
    }
    syncIsMobile()
    mediaQuery.addEventListener('change', syncIsMobile)
    return () => mediaQuery.removeEventListener('change', syncIsMobile)
  }, [compact])

  const compactDayPickerStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!compact) return undefined
    return {
      '--rdp-day-width': isMobile ? '28px' : '20px',
      '--rdp-day-height': isMobile ? '28px' : '20px',
      '--rdp-day_button-width': isMobile ? '26px' : '18px',
      '--rdp-day_button-height': isMobile ? '26px' : '18px',
      '--rdp-day_button-border': '0px solid transparent',
      '--rdp-day_button-border-radius': isMobile ? '6px' : '5px',
      '--rdp-selected-border': '0px solid transparent',
      '--rdp-nav_button-width': isMobile ? '24px' : '16px',
      '--rdp-nav_button-height': isMobile ? '24px' : '16px',
      '--rdp-nav-height': isMobile ? '26px' : '18px',
      '--rdp-weekday-padding': '0px',
      '--rdp-weekday-opacity': '1',
    } as React.CSSProperties
  }, [compact, isMobile])

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraftDate(date)
      setVisibleMonth(clampMonth(date?.from ?? normalizedMaxDate ?? new Date()))
    } else {
      setDraftDate(date)
    }
    setIsOpen(open)
  }

  const handleMonthChange = (month: Date) => {
    setVisibleMonth(clampMonth(month))
  }

  const handleSelect = (range: DateRange | undefined) => {
    setDraftDate(normalizeRange(range))
  }

  const handlePresetClick = (preset: typeof presetRanges[0]) => {
    const nextRange = normalizeRange(preset.getValue())
    setDate(nextRange)
    setDraftDate(nextRange)
    onChange?.(nextRange)
    setIsOpen(false)
  }

  const handleApply = () => {
    if (!draftDate?.from || !draftDate?.to) return
    setDate(draftDate)
    onChange?.(draftDate)
    setIsOpen(false)
  }

  const handleCancel = () => {
    setDraftDate(date)
    setIsOpen(false)
  }

  const handleResetDraft = () => {
    setDraftDate(undefined)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDate(undefined)
    setDraftDate(undefined)
    onChange?.(undefined)
  }

  const displayText = date?.from && date?.to
    ? `${format(date.from, 'yyyy-MM-dd')} ~ ${format(date.to, 'yyyy-MM-dd')}`
    : placeholder
  const canApply = Boolean(draftDate?.from && draftDate?.to)
  const selectedRangeText = canApply
    ? `${format(draftDate!.from!, 'yyyy-MM-dd')} ~ ${format(draftDate!.to!, 'yyyy-MM-dd')}`
    : '请选择开始与结束日期'

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant, size }),
          'max-w-[220px] justify-start text-left font-normal',
          !date?.from && 'text-muted-foreground',
          variant === 'ghost' && 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          size === 'sm' && 'h-8 px-3 text-sm',
          className
        )}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <CalendarIcon className="mr-1 h-3.5 w-3.5" />
        <span className="truncate">{displayText}</span>
        {showClearButton && date?.from && (
          <X
            className="ml-auto h-3.5 w-3.5 opacity-50 hover:opacity-100"
            onClick={handleClear}
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align={isMobile ? 'center' : 'start'}
        sideOffset={8}
        className={cn(
          compact ? (isMobile ? 'w-[min(96vw,360px)]' : 'w-[176px]') : 'w-[min(92vw,760px)]',
          'p-0'
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(() => {
            const firstPresetButton = contentRef.current?.querySelector<HTMLButtonElement>('button[data-date-range-preset="true"]')
            if (showPresets && firstPresetButton) {
              firstPresetButton.focus()
              return
            }
            const firstDayButton = contentRef.current?.querySelector<HTMLButtonElement>('.rdp-day_button:not([disabled])')
            firstDayButton?.focus()
          })
        }}
      >
        <div className={cn(compact ? (isMobile ? 'max-h-[340px]' : 'max-h-[206px]') : 'max-h-[75vh]', 'flex flex-col overflow-auto', !compact && 'lg:flex-row')}>
          {showPresets && (
            <div className="flex flex-wrap gap-1 border-b p-3 lg:w-[132px] lg:flex-col lg:border-b-0 lg:border-r">
              <div className="mb-1 text-xs font-medium text-muted-foreground">快捷选择</div>
              {presetRanges.map((preset, index) => {
                const presetRange = normalizeRange(preset.getValue())
                const isPresetSelected = Boolean(
                  draftDate?.from
                  && draftDate?.to
                  && presetRange?.from
                  && presetRange?.to
                  && format(draftDate.from, 'yyyy-MM-dd') === format(presetRange.from, 'yyyy-MM-dd')
                  && format(draftDate.to, 'yyyy-MM-dd') === format(presetRange.to, 'yyyy-MM-dd')
                )

                return (
                  <Button
                    key={preset.label}
                    data-date-range-preset={index === 0 ? 'true' : undefined}
                    variant={isPresetSelected ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={isPresetSelected}
                    className="h-8 justify-start px-2 text-xs lg:w-full"
                    onClick={() => handlePresetClick(preset)}
                  >
                    {preset.label}
                  </Button>
                )
              })}
            </div>
          )}
          <div className={cn(compact ? 'w-full p-1' : 'flex-1 p-3')}>
            <DayPicker
              mode="range"
              month={visibleMonth}
              onMonthChange={handleMonthChange}
              selected={draftDate}
              onSelect={handleSelect}
              resetOnSelect
              excludeDisabled
              numberOfMonths={monthCount}
              locale={zhCN}
              navLayout={compact ? 'around' : 'after'}
              captionLayout="label"
              showOutsideDays
              startMonth={minMonth}
              endMonth={maxMonth}
              style={compactDayPickerStyle}
              className={cn(compact && !isMobile && 'text-[10px]')}
              labels={{
                labelNext: () => '下个月',
                labelPrevious: () => '上个月',
                labelDayButton: (day, modifiers) => {
                  const base = format(day, 'yyyy年M月d日 EEEE', { locale: zhCN })
                  const suffixes: string[] = []
                  if (modifiers.today) suffixes.push('今天')
                  if (modifiers.selected) suffixes.push('已选中')
                  if (modifiers.disabled) suffixes.push('不可选')
                  return suffixes.length > 0 ? `${base}，${suffixes.join('，')}` : base
                },
              }}
              disabled={(day) => {
                const normalizedDay = startOfDay(day)
                if (normalizedMaxDate && isAfter(normalizedDay, normalizedMaxDate)) return true
                if (normalizedMinDate && isBefore(normalizedDay, normalizedMinDate)) return true
                return false
              }}
              classNames={{
                months: compact ? 'flex flex-col' : 'flex flex-col gap-4 xl:flex-row xl:gap-5',
                month: compact ? (isMobile ? 'relative space-y-0.5' : 'relative space-y-0') : 'space-y-2',
                month_caption: compact
                  ? (isMobile
                    ? 'pointer-events-none relative mb-1 flex h-[26px] items-center justify-end pl-[58px] pr-1'
                    : 'pointer-events-none relative mb-0.5 flex h-[18px] items-center justify-end pl-11 pr-0.5')
                  : 'relative flex items-center justify-center pt-1',
                caption_label: compact
                  ? (isMobile ? 'text-sm font-semibold leading-[26px] text-right tracking-tight text-foreground' : 'text-[10px] font-semibold leading-[18px] text-right tracking-tight text-foreground')
                  : 'text-sm font-medium',
                chevron: compact ? (isMobile ? 'h-4 w-4' : 'h-3 w-3') : 'h-4 w-4',
                nav: compact ? 'hidden' : 'space-x-1 flex items-center',
                button_previous: cn(
                  compact
                    ? (isMobile
                      ? 'absolute left-0 top-0 z-10 inline-flex h-[26px] w-[26px] items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground opacity-85 hover:bg-accent hover:text-foreground disabled:opacity-35'
                      : 'absolute left-0 top-0 z-10 inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground opacity-85 hover:bg-accent hover:text-foreground disabled:opacity-35')
                    : 'h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100'
                ),
                button_next: cn(
                  compact
                    ? (isMobile
                      ? 'absolute left-[28px] top-0 z-10 inline-flex h-[26px] w-[26px] items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground opacity-85 hover:bg-accent hover:text-foreground disabled:opacity-35'
                      : 'absolute left-[19px] top-0 z-10 inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground opacity-85 hover:bg-accent hover:text-foreground disabled:opacity-35')
                    : 'h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100'
                ),
                month_grid: 'w-full border-collapse',
                weekdays: compact ? '' : 'flex',
                weekday: cn('text-muted-foreground rounded-sm text-center font-medium', compact ? (isMobile ? 'px-0 py-0 text-xs leading-5' : 'px-0 py-0 text-[10px] leading-4') : 'w-8 text-[0.75rem]'),
                weeks: compact ? '' : '',
                week: cn(compact ? '' : 'mt-1.5 flex w-full'),
                cell: cn(
                  compact ? (isMobile ? 'relative p-0 text-center align-middle text-xs' : 'relative p-0 text-center align-middle text-[10px]') : 'h-8 w-8 p-0 text-center text-xs relative',
                  'focus-within:relative focus-within:z-20'
                ),
                day: cn(compact ? (isMobile ? 'h-[28px] w-[28px] p-0 text-xs' : 'h-[20px] w-[20px] p-0 text-[10px]') : 'h-8 w-8 p-0', 'font-normal rounded-md'),
                day_button: cn(
                  compact ? (isMobile ? 'h-[26px] w-[26px] rounded-[6px] p-0 text-xs' : 'h-[18px] w-[18px] rounded-[4px] p-0 text-[10px]') : 'h-8 w-8 p-0',
                  'font-normal transition-colors hover:bg-accent hover:text-accent-foreground',
                  'aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:font-semibold'
                ),
                selected: compact
                  ? 'drp-range-selected'
                  : 'bg-primary text-primary-foreground',
                range_start: 'drp-range-start',
                range_end: 'drp-range-end',
                range_middle: 'drp-range-middle',
                today: compact ? 'text-primary font-medium' : 'bg-accent text-accent-foreground font-semibold',
                outside: compact
                  ? 'pointer-events-none select-none drp-outside-hidden'
                  : 'text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
                disabled: 'text-muted-foreground opacity-50 cursor-not-allowed',
                hidden: 'invisible',
              }}
            />
          </div>
        </div>
        <div className={cn('border-t', compact ? (isMobile ? 'px-2 py-1.5' : 'px-1 py-0.5') : 'flex items-center justify-between px-3 py-2')}>
          {!compact && (
            <span className="truncate pr-3 text-xs text-muted-foreground">{selectedRangeText}</span>
          )}
          <div className={cn('flex items-center', compact ? 'w-full justify-between gap-1' : 'gap-2')}>
            {compact && (
              <span className={cn('truncate text-muted-foreground', isMobile ? 'text-[11px]' : 'text-[9px]')}>灰色日期不可选</span>
            )}
            <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(compact && (isMobile ? 'h-7 px-2.5 text-xs' : 'h-5 px-1.5 text-[10px]'))}
              onClick={handleResetDraft}
            >
              重置
            </Button>
            {!compact && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                取消
              </Button>
            )}
            <Button size="sm" className={cn(compact && (isMobile ? 'h-7 px-2.5 text-xs' : 'h-5 px-1.5 text-[10px]'))} onClick={handleApply} disabled={!canApply}>
              应用
            </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
      {compact && (
        <style jsx global>{`
          .drp-range-selected,
          .drp-range-start,
          .drp-range-end,
          .drp-range-middle {
            border-radius: 0 !important;
            background: rgba(37, 99, 235, 0.24) !important;
            color: rgb(15, 23, 42) !important;
          }

          .drp-range-selected > button,
          .drp-range-start > button,
          .drp-range-end > button,
          .drp-range-middle > button {
            border-radius: 0 !important;
            background: transparent !important;
            color: rgb(15, 23, 42) !important;
            font-weight: 500 !important;
          }

          .drp-outside-hidden {
            background: transparent !important;
            color: transparent !important;
          }

          .drp-outside-hidden > button {
            background: transparent !important;
            color: transparent !important;
            border-radius: 0 !important;
          }
        `}</style>
      )}
    </Popover>
  )
}
