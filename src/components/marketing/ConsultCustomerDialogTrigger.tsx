'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function ConsultCustomerDialogTrigger({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={className}>
          {children}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>咨询客服</DialogTitle>
          <DialogDescription>
            扫码添加客服微信，获取试用/购买咨询。备注
            <span className="font-semibold text-slate-900">“autoads”</span>
            更快处理。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <Image
              src="/wechat.jpg"
              alt="客服微信二维码"
              width={320}
              height={320}
              sizes="260px"
              loading="lazy"
              className="h-auto w-[260px] rounded-lg"
            />
          </div>
          <div className="text-sm text-slate-600">
            备注 <span className="font-semibold text-slate-900">“autoads”</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
