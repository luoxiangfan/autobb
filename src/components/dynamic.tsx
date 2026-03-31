/**
 * 动态导入的组件配置
 * 用于代码分割和懒加载，优化首屏加载性能
 */
import dynamic from 'next/dynamic'
import React from 'react'

// 大型组件使用动态导入，延迟加载
// 默认导出的组件
export const CampaignComparisonDynamic = dynamic(
  () => import('./CampaignComparison'),
  {
    loading: () => <div className="p-8 text-center">加载中...</div>,
    ssr: false, // 客户端渲染
  }
)

// 命名导出的组件需要特别处理
export const CreativeEditorDynamic = dynamic(
  () => import('./CreativeEditor').then(mod => mod.CreativeEditor),
  {
    loading: () => <div className="p-8 text-center">加载编辑器...</div>,
    ssr: false,
  }
)

export const RiskAlertPanelDynamic = dynamic(
  () => import('./RiskAlertPanel'),
  {
    loading: () => <div className="p-4 text-center text-sm">加载风险面板...</div>,
    ssr: false,
  }
)

export const OptimizationTaskListDynamic = dynamic(
  () => import('./OptimizationTaskList'),
  {
    loading: () => <div className="p-4 text-center text-sm">加载优化任务...</div>,
    ssr: false,
  }
)

export const ComplianceCheckerDynamic = dynamic(
  () => import('./ComplianceChecker'),
  {
    loading: () => <div className="p-4 text-center text-sm">加载合规检查...</div>,
    ssr: false,
  }
)

// Dashboard组件动态导入 - 都是命名导出
export const DashboardInsightsDynamic = dynamic(
  () => import('./dashboard/InsightsCard').then(mod => mod.InsightsCard),
  {
    loading: () => <div className="h-48 bg-gray-100 animate-pulse rounded-lg"></div>,
    ssr: false,
  }
)

export const DashboardCampaignListDynamic = dynamic(
  () => import('./dashboard/CampaignList').then(mod => mod.CampaignList),
  {
    loading: () => <div className="h-64 bg-gray-100 animate-pulse rounded-lg"></div>,
    ssr: false,
  }
)

export const DashboardKPICardsDynamic = dynamic(
  () => import('./dashboard/KPICards').then(mod => mod.KPICards),
  {
    loading: () => (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg"></div>
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg"></div>
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg"></div>
      </div>
    ),
    ssr: false,
  }
)

// Admin组件动态导入 - 默认导出
export const AdminUserEditModalDynamic = dynamic(
  () => import('./admin/UserEditModal'),
  {
    loading: () => <div className="p-6 text-center">加载用户编辑...</div>,
    ssr: false,
  }
)

export const AdminUserCreateModalDynamic = dynamic(
  () => import('./admin/UserCreateModal'),
  {
    loading: () => <div className="p-6 text-center">加载用户创建...</div>,
    ssr: false,
  }
)

// 模态框组件动态导入 - 命名导出
export const UserProfileModalDynamic = dynamic(
  () => import('./UserProfileModal').then(mod => mod.UserProfileModal),
  {
    loading: () => <div className="p-6 text-center">加载用户信息...</div>,
    ssr: false,
  }
)

export const ChangePasswordModalDynamic = dynamic(
  () => import('./ChangePasswordModal'),
  {
    loading: () => <div className="p-6 text-center">加载密码修改...</div>,
    ssr: false,
  }
)

// LaunchScoreModal动态导入 - 78KB的大组件，包含RadarChart和ScoreTrendChart
export const LaunchScoreModalDynamic = dynamic(
  () => import('./LaunchScoreModal'),
  {
    loading: () => (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent"></div>
      </div>
    ),
    ssr: false,
  }
)
