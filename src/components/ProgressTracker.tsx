'use client';

import React from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { ProgressStage, ProgressStatus, ProgressEvent } from '@/types/progress';
import { calculateProgress } from '@/types/progress';

interface ProgressTrackerProps {
  currentStage: ProgressStage;
  currentStatus: ProgressStatus;
  currentMessage: string;
  events: ProgressEvent[];
  details?: ProgressEvent['details'];
  currentDuration?: number; // 当前阶段的耗时（毫秒）
  stageDurations?: Map<ProgressStage, number>; // 各阶段的完成耗时
}

const STAGE_CONFIG: Record<ProgressStage, { label: string; icon: string }> = {
  proxy_warmup: { label: '推广链接预热', icon: '🔥' },
  resolving_link: { label: '解析推广链接', icon: '🔗' },
  fetching_proxy: { label: '获取代理IP', icon: '🌐' },
  accessing_page: { label: '访问目标页面', icon: '🚀' },
  extracting_brand: { label: '提取品牌信息', icon: '🏷️' },
  scraping_products: { label: '抓取产品数据', icon: '📦' },
  processing_data: { label: '处理数据', icon: '⚙️' },
  ai_analysis: { label: 'AI智能分析', icon: '🤖' },
  completed: { label: '完成', icon: '✅' },
  error: { label: '错误', icon: '❌' },
};

// 阶段顺序必须与后端执行顺序一致
const STAGE_ORDER: ProgressStage[] = [
  'fetching_proxy',    // 1. 获取代理IP
  'proxy_warmup',      // 2. 推广链接预热
  'resolving_link',    // 3. 解析推广链接
  'accessing_page',    // 4. 访问目标页面
  'scraping_products', // 5. 抓取产品数据
  'extracting_brand',  // 6. 提取品牌信息
  'processing_data',   // 7. 处理数据
  'ai_analysis',       // 8. AI智能分析
  'completed',         // 9. 完成
];

export default function ProgressTracker({
  currentStage,
  currentStatus,
  currentMessage,
  events,
  details,
  currentDuration,
  stageDurations,
}: ProgressTrackerProps) {
  const progress = calculateProgress(currentStage, currentStatus);

  // 从事件中提取各阶段完成耗时（如果没有传入stageDurations）
  const getStageDuration = (stage: ProgressStage): number | undefined => {
    // 优先使用传入的stageDurations
    if (stageDurations?.has(stage)) {
      return stageDurations.get(stage);
    }
    // 从events中查找该阶段的completed事件
    const completedEvent = events.find(
      (e) => e.stage === stage && e.status === 'completed' && e.duration !== undefined
    );
    return completedEvent?.duration;
  };

  // 从事件中提取代理国家不匹配警告信息
  const getProxyMismatchInfo = (stage: ProgressStage): { targetCountry?: string; usedProxyCountry?: string } | null => {
    if (stage !== 'fetching_proxy') return null;
    const completedEvent = events.find(
      (e) => e.stage === 'fetching_proxy' && e.status === 'completed' && e.details?.proxyCountryMismatch
    );
    if (!completedEvent?.details?.proxyCountryMismatch) return null;
    return {
      targetCountry: completedEvent.details.targetCountry,
      usedProxyCountry: completedEvent.details.usedProxyCountry,
    };
  };

  // 格式化耗时显示
  const formatDuration = (ms: number): string => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStageStatus = (stage: ProgressStage): ProgressStatus => {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    const stageIndex = STAGE_ORDER.indexOf(stage);

    if (currentStage === 'error') {
      // Find the last completed stage before error
      const lastEvent = [...events].reverse().find((e) => e.status === 'completed');
      if (lastEvent) {
        const lastCompletedIndex = STAGE_ORDER.indexOf(lastEvent.stage);
        if (stageIndex <= lastCompletedIndex) return 'completed';
        if (stageIndex === lastCompletedIndex + 1) return 'error';
      }
      return 'pending';
    }

    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return currentStatus;
    return 'pending';
  };

  const renderStageIcon = (stage: ProgressStage) => {
    const status = getStageStatus(stage);

    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-6 h-6 text-green-600" />;
      case 'in_progress':
        return <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />;
      case 'error':
        return <XCircle className="w-6 h-6 text-red-600" />;
      case 'pending':
      default:
        return <Circle className="w-6 h-6 text-gray-300" />;
    }
  };

  const renderStageDetails = (stage: ProgressStage) => {
    if (stage !== currentStage || !details) return null;

    return (
      <div className="ml-10 mt-2 text-sm text-gray-600 space-y-1">
        {details.currentUrl && (
          <div className="truncate">
            <span className="font-medium">URL:</span> {details.currentUrl}
          </div>
        )}
        {details.redirectCount !== undefined && details.redirectCount > 0 && (
          <div>
            <span className="font-medium">重定向次数:</span> {details.redirectCount}
          </div>
        )}
        {details.proxyUsed && (
          <div className="truncate">
            <span className="font-medium">代理:</span> {details.proxyUsed}
          </div>
        )}
        {details.brandName && (
          <div>
            <span className="font-medium">品牌:</span> {details.brandName}
          </div>
        )}
        {details.productCount !== undefined && (
          <div>
            <span className="font-medium">产品数:</span> {details.productCount}
          </div>
        )}
        {details.retryCount !== undefined && details.retryCount > 0 && (
          <div className="text-orange-600">
            <span className="font-medium">重试次数:</span> {details.retryCount}
          </div>
        )}
        {details.errorMessage && (
          <div className="text-red-600">
            <span className="font-medium">错误:</span> {details.errorMessage}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="font-medium text-gray-700">提取进度</span>
          <span className="text-gray-600">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Current Status Message */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-start space-x-3">
          {currentStatus === 'in_progress' && (
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin mt-0.5 flex-shrink-0" />
          )}
          {currentStatus === 'error' && (
            <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          )}
          {currentStatus === 'completed' && currentStage === 'completed' && (
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{currentMessage}</p>
            {details && Object.keys(details).length > 0 && (
              <div className="mt-2 text-xs text-gray-600 space-y-1">
                {details.currentUrl && (
                  <div className="truncate">
                    <span className="font-semibold">当前URL:</span> {details.currentUrl}
                  </div>
                )}
                {details.brandName && (
                  <div>
                    <span className="font-semibold">品牌名称:</span> {details.brandName}
                  </div>
                )}
                {details.productCount !== undefined && (
                  <div>
                    <span className="font-semibold">产品数量:</span> {details.productCount}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stage List */}
      <div className="space-y-3">
        {STAGE_ORDER.slice(0, -1).map((stage) => {
          const status = getStageStatus(stage);
          const config = STAGE_CONFIG[stage];
          const isActive = stage === currentStage;
          const stageDuration = getStageDuration(stage);
          const isInProgress = status === 'in_progress';
          const proxyMismatchInfo = getProxyMismatchInfo(stage);

          return (
            <div
              key={stage}
              className={`flex items-start space-x-3 transition-all ${
                isActive ? 'scale-105' : ''
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">{renderStageIcon(stage)}</div>
              <div className="flex-1 min-w-0">
                <div
                  className={`flex items-center gap-2 text-sm font-medium ${
                    status === 'completed'
                      ? 'text-green-700'
                      : status === 'in_progress'
                      ? 'text-blue-700'
                      : status === 'error'
                      ? 'text-red-700'
                      : 'text-gray-500'
                  }`}
                >
                  <span className="mr-1">{config.icon}</span>
                  <span>{config.label}</span>
                  {/* 已完成阶段显示耗时 */}
                  {status === 'completed' && stageDuration !== undefined && (
                    <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {formatDuration(stageDuration)}
                    </span>
                  )}
                  {/* 正在执行阶段显示实时耗时 */}
                  {isInProgress && currentDuration !== undefined && (
                    <span className="text-xs font-mono text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded animate-pulse">
                      {formatDuration(currentDuration)}...
                    </span>
                  )}
                  {/* 代理国家不匹配警告 */}
                  {status === 'completed' && proxyMismatchInfo && (
                    <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                      ⚠️ 无{proxyMismatchInfo.targetCountry}代理，使用{proxyMismatchInfo.usedProxyCountry}代理
                    </span>
                  )}
                </div>
                {renderStageDetails(stage)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Event Log (Optional, for debugging) */}
      {process.env.NODE_ENV === 'development' && events.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            查看详细日志 ({events.length} 条事件)
          </summary>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto bg-gray-50 p-2 rounded">
            {events.map((event, idx) => (
              <div key={idx} className="text-gray-600">
                <span className="font-mono">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>{' '}
                - <span className="font-medium">{event.stage}</span>:{' '}
                <span className={event.status === 'error' ? 'text-red-600' : ''}>
                  {event.message}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
