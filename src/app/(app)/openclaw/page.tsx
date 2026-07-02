'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OpenClawPageProvider, useOpenClawPageContext } from './openclaw-page-context'
import { OpenClawConfigTab } from './_components/open-claw-config-tab'
import { OpenClawFeishuHealthTab } from './_components/open-claw-feishu-health-tab'
import { OpenClawStrategyTab } from './_components/open-claw-strategy-tab'
import { OpenClawReportTab } from './_components/open-claw-report-tab'

function OpenClawPageShell() {
  const { loading, settings } = useOpenClawPageContext()

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">加载 OpenClaw 配置...</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OpenClaw</h1>
          <p className="text-slate-500 text-sm mt-1">飞书协作 + AutoAds 自动化控制台</p>
        </div>
        <Link
          href="/help/openclaw-config"
          className={`${buttonVariants({ variant: 'outline', size: 'sm' })} gap-2`}
        >
          配置指南
        </Link>
      </div>

      <Tabs defaultValue="config">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="config">配置中心</TabsTrigger>
          {settings?.isAdmin === true && <TabsTrigger value="feishu-health">飞书链路健康</TabsTrigger>}
          <TabsTrigger value="strategy">自动分析</TabsTrigger>
          <TabsTrigger value="report">每日报表</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <OpenClawConfigTab />
        </TabsContent>

        {settings?.isAdmin === true && (
          <TabsContent value="feishu-health" className="space-y-6">
            <OpenClawFeishuHealthTab />
          </TabsContent>
        )}

        <TabsContent value="strategy" className="space-y-6">
          <OpenClawStrategyTab />
        </TabsContent>

        <TabsContent value="report" className="space-y-6">
          <OpenClawReportTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function OpenClawPage() {
  return (
    <OpenClawPageProvider>
      <OpenClawPageShell />
    </OpenClawPageProvider>
  )
}
