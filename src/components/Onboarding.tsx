'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, Rocket, FileText, TrendingUp, Zap } from 'lucide-react'

interface OnboardingProps {
  open: boolean
  onComplete: () => void
}

export function Onboarding({ open, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)

  const steps = [
    {
      title: '欢迎使用AutoAds',
      description: '智能Google Ads投放自动化平台',
      icon: Rocket,
      content: (
        <div className="space-y-4">
          <p className="text-gray-600">
            AutoAds帮助您自动化Google Ads投放流程，从Offer创建到创意生成，再到投放效果分析。
          </p>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <Card>
              <CardContent className="pt-6">
                <FileText className="h-8 w-8 text-blue-600 mb-2" />
                <h3 className="font-semibold mb-1">Offer管理</h3>
                <p className="text-sm text-gray-600">创建和管理您的营销Offers</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Zap className="h-8 w-8 text-green-600 mb-2" />
                <h3 className="font-semibold mb-1">AI创意生成</h3>
                <p className="text-sm text-gray-600">自动生成高质量广告创意</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <TrendingUp className="h-8 w-8 text-purple-600 mb-2" />
                <h3 className="font-semibold mb-1">Campaign管理</h3>
                <p className="text-sm text-gray-600">一键同步Google Ads投放</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <CheckCircle2 className="h-8 w-8 text-orange-600 mb-2" />
                <h3 className="font-semibold mb-1">数据分析</h3>
                <p className="text-sm text-gray-600">实时监控投放效果</p>
              </CardContent>
            </Card>
          </div>
        </div>
      ),
    },
    {
      title: '快速开始 - 创建Offer',
      description: 'Offer是您营销活动的核心',
      icon: FileText,
      content: (
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">什么是Offer？</h4>
            <p className="text-sm text-gray-700">
              Offer代表您要推广的产品或服务，包含产品信息、目标市场、佣金设置等关键数据。
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">创建步骤：</h4>
            <ol className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  1
                </span>
                <div>
                  <strong>前往Offers页面</strong>
                  <p className="text-gray-600">点击左侧导航栏的"Offers"</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  2
                </span>
                <div>
                  <strong>点击"创建Offer"</strong>
                  <p className="text-gray-600">填写产品名称、URL、目标国家等信息</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  3
                </span>
                <div>
                  <strong>系统自动抓取</strong>
                  <p className="text-gray-600">自动抓取产品标题、描述、图片等信息</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      title: '生成广告创意',
      description: 'AI自动生成高质量广告文案',
      icon: Zap,
      content: (
        <div className="space-y-4">
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">AI创意生成</h4>
            <p className="text-sm text-gray-700">
              基于Offer信息，AI自动生成符合Google Ads规范的广告标题、描述和关键词。
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">生成步骤：</h4>
            <ol className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="bg-green-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  1
                </span>
                <div>
                  <strong>选择Offer</strong>
                  <p className="text-gray-600">在Offers列表中点击"生成创意"</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-green-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  2
                </span>
                <div>
                  <strong>AI自动生成</strong>
                  <p className="text-gray-600">生成15个标题、4个描述和30个关键词</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-green-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  3
                </span>
                <div>
                  <strong>编辑和优化</strong>
                  <p className="text-gray-600">根据需要编辑创意内容并审批</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      title: '连接Google Ads',
      description: '授权访问您的Google Ads账户',
      icon: TrendingUp,
      content: (
        <div className="space-y-4">
          <div className="bg-purple-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">为什么需要连接？</h4>
            <p className="text-sm text-gray-700">
              连接Google Ads账户后，您可以直接同步Campaign、查看投放数据、优化广告效果。
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">连接步骤：</h4>
            <ol className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  1
                </span>
                <div>
                  <strong>前往设置页面</strong>
                  <p className="text-gray-600">点击右上角用户头像 → "Google Ads账号"</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  2
                </span>
                <div>
                  <strong>点击"连接账号"</strong>
                  <p className="text-gray-600">使用Google账号登录并授权</p>
                </div>
              </li>
              <li className="flex items-start">
                <span className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 mt-0.5 text-xs">
                  3
                </span>
                <div>
                  <strong>选择广告账户</strong>
                  <p className="text-gray-600">从列表中选择要管理的Google Ads账户</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      title: '开始使用AutoAds！',
      description: '您已准备好开始自动化投放',
      icon: CheckCircle2,
      content: (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h4 className="font-semibold text-lg mb-2">准备就绪！</h4>
            <p className="text-gray-700">
              您已了解AutoAds的核心功能，现在可以开始创建您的第一个Offer并生成广告创意了。
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">快捷操作：</h4>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-auto py-3 flex-col">
                <FileText className="h-5 w-5 mb-1" />
                <span className="text-sm">创建Offer</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex-col">
                <Zap className="h-5 w-5 mb-1" />
                <span className="text-sm">生成创意</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex-col">
                <TrendingUp className="h-5 w-5 mb-1" />
                <span className="text-sm">查看Dashboard</span>
              </Button>
              <Button variant="outline" className="h-auto py-3 flex-col">
                <CheckCircle2 className="h-5 w-5 mb-1" />
                <span className="text-sm">帮助文档</span>
              </Button>
            </div>
          </div>
        </div>
      ),
    },
  ]

  const currentStep = steps[step]
  const Icon = currentStep.icon

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <Icon className="h-8 w-8 text-blue-600" />
            <div>
              <DialogTitle className="text-2xl">{currentStep.title}</DialogTitle>
              <DialogDescription>{currentStep.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">{currentStep.content}</div>

        <DialogFooter className="flex justify-between items-center">
          <div className="flex gap-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-12 rounded-full transition-colors ${
                  index === step ? 'bg-blue-600' : index < step ? 'bg-green-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                上一步
              </Button>
            )}
            {step < steps.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>
                下一步
              </Button>
            ) : (
              <Button onClick={onComplete} className="bg-green-600 hover:bg-green-700">
                开始使用
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
