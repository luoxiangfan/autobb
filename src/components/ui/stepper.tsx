'use client'

/**
 * Stepper Component - P1-3优化
 * 使用shadcn/ui风格的步骤导航组件
 */

import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Step {
  id: number
  label: string
  description?: string
}

export interface StepperProps {
  steps: Step[]
  currentStep: number
  className?: string
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      <ol role="list" className="flex items-center w-full relative justify-between pb-12 px-8">
        {/* Background Line */}
        <div className="absolute top-5 left-8 right-8 border-t-2 border-dashed border-gray-200 -z-10" />

        {/* Active Progress Line */}
        <div
          className="absolute top-5 left-8 h-[2px] bg-blue-600 transition-all duration-500 ease-in-out -z-10"
          style={{
            width: `calc(${((currentStep - 1) / (steps.length - 1)) * 100}% - ${((currentStep - 1) / (steps.length - 1)) * 4}rem)`
            // Calculation: Percentage of total width minus percentage of total padding (4rem = 64px approx for left+right padding compensation?)
            // Actually, simpler: width is percentage of the *content box*.
            // If line is inside ol (which has padding), and we want it to span between steps.
            // The steps are justified between.
            // The distance is 100% of content box.
            // So width should be percentage of (100% - padding).
            // But 'width: X%' on absolute child refers to padding box of parent.
            // So 100% is full width including padding.
            // We want width to be percentage of (100% - 4rem).
            // So `calc((100% - 4rem) * percentage)`.
          }}
        />

        {steps.map((step, stepIdx) => {
          const isCompleted = currentStep > step.id
          const isCurrent = currentStep === step.id
          const isUpcoming = currentStep < step.id

          return (
            <li
              key={step.id}
              className={cn(
                'relative flex flex-col items-center group',
                // Adjust width distribution if needed, but justify-between handles spacing
              )}
            >
              {/* Step Circle */}
              <div
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300 z-10 bg-white',
                  isCompleted && 'border-blue-600 bg-blue-600 text-white scale-105 shadow-md shadow-blue-200',
                  isCurrent && 'border-blue-600 text-blue-600 ring-4 ring-blue-50 scale-110 shadow-lg',
                  isUpcoming && 'border-gray-200 text-gray-400 bg-white'
                )}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5 animate-in zoom-in duration-300" />
                ) : (
                  <span className={cn("text-sm font-bold", isCurrent && "animate-pulse")}>{step.id}</span>
                )}
              </div>

              {/* Step Label */}
              <div className="mt-3 text-center absolute top-10 w-40 left-1/2 -translate-x-1/2">
                <p
                  className={cn(
                    'text-sm font-medium transition-colors duration-300 mb-0.5',
                    isCurrent && 'text-blue-700 font-bold',
                    isCompleted && 'text-blue-600',
                    isUpcoming && 'text-gray-400'
                  )}
                >
                  {step.label}
                </p>
                {step.description && (
                  <p className={cn(
                    "text-xs transition-colors duration-300 hidden md:block",
                    isCurrent ? "text-blue-400" : "text-gray-400"
                  )}>
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Stepper
