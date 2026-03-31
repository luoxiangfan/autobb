'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Loader2, AlertCircle, TrendingUp, Edit3, RotateCcw, GripVertical, Clock, Globe, Link, Tag, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { getTimezoneByCountry } from '@/lib/timezone-utils';
import { REFERER_OPTIONS, SOCIAL_MEDIA_REFERRERS, CreateClickFarmTaskRequest } from '@/lib/click-farm-types';
import { balanceDistribution, generateDefaultDistribution } from '@/lib/click-farm/distribution';
import HourlyDistributionEditor from '@/components/ui/HourlyDistributionEditor';

interface ClickFarmTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  preSelectedOfferId?: number; // 预选的Offer ID
  editTaskId?: string | number; // 🆕 编辑模式：传入任务ID
}

interface Offer {
  id: number;
  offerName?: string;
  name?: string;
  brand?: string;
  brand_name?: string;
  targetCountry: string;  // API返回驼峰命名
  affiliateLink?: string;  // API返回驼峰命名
}

const TIME_PERIODS = [
  { value: '00:00-24:00', label: '全天 (00:00-24:00)', hours: 24 },
  { value: '06:00-24:00', label: '白天 (06:00-24:00)', hours: 18 },
];

const DURATION_OPTIONS = [
  { value: 7, label: '7天' },
  { value: 14, label: '14天' },
  { value: 30, label: '30天' },
  { value: 9999, label: '不限期' },
];

export default function ClickFarmTaskModal({
  open,
  onOpenChange,
  onSuccess,
  preSelectedOfferId,
  editTaskId,  // 🆕 编辑模式参数
}: ClickFarmTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);

  // Form state
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [dailyClickCount, setDailyClickCount] = useState(216);
  const [timePeriod, setTimePeriod] = useState('06:00-24:00');
  const [durationDays, setDurationDays] = useState(14);
  const [scheduledStartDate, setScheduledStartDate] = useState<string>(  // 🆕 开始日期状态
    new Date().toISOString().split('T')[0]  // 默认当天
  );
  const [proxyWarning, setProxyWarning] = useState('');
  const [distribution, setDistribution] = useState<number[]>([]);
  const [isEditingDistribution, setIsEditingDistribution] = useState(false);
  const [isDistributionManuallyModified, setIsDistributionManuallyModified] = useState(false);
  const [draggedHour, setDraggedHour] = useState<number | null>(null);
  // 🔧 修复P2-10(2025-12-30): 初始值设为空,避免误导用户,实际值由选择offer时自动设置
  const [timezone, setTimezone] = useState<string>('');
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  // 🆕 Referer配置状态
  const [refererConfig, setRefererConfig] = useState<{
    type: 'none' | 'random' | 'specific' | 'custom';
    referer?: string;
  }>({ type: 'none' });

  const isEditMode = !!editTaskId;  // 🆕 判断是否为编辑模式
  const canRestartTask = isEditMode && (taskStatus === 'paused' || taskStatus === 'stopped');

  // 🔧 修复P1-2(2025-12-30): 清理拖拽事件监听器,防止内存泄漏
  useEffect(() => {
    // 当对话框关闭时,清理可能残留的全局事件监听器
    if (!open) {
      setDraggedHour(null);
      setIsEditingDistribution(false);
    }
  }, [open]);

  // 🆕 加载现有任务数据（编辑模式）
  useEffect(() => {
    if (open && editTaskId) {
      loadTaskData();
    }
  }, [open, editTaskId]);

  // 🆕 加载任务数据
  const loadTaskData = async () => {
    try {
      const response = await fetch(`/api/click-farm/tasks/${editTaskId}`);
      if (!response.ok) throw new Error('加载任务失败');

      const { data: task } = await response.json();

      setTaskStatus(task.status || null);
      setSelectedOfferId(task.offer_id);
      setDailyClickCount(task.daily_click_count);
      // 🔧 修复P0-2(2025-12-30): 直接使用后端返回的时间范围,避免数据丢失
      setTimePeriod(`${task.start_time}-${task.end_time}`);
      // 🔧 修复P0-3(2025-12-30): 后端-1表示不限期,前端转换为9999
      setDurationDays(task.duration_days === -1 ? 9999 : task.duration_days);
      // 🔧 修复(2025-12-31): scheduled_start_date可能是ISO格式，转换为yyyy-MM-dd格式
      const startDateStr = task.scheduled_start_date;
      if (startDateStr) {
        const formattedDate = typeof startDateStr === 'string'
          ? startDateStr.split('T')[0]
          : startDateStr;
        setScheduledStartDate(formattedDate);
      } else {
        setScheduledStartDate(new Date().toISOString().split('T')[0]);
      }
      setDistribution(task.hourly_distribution);
      setTimezone(task.timezone);  // 🆕 加载timezone
      // 🆕 加载Referer配置
      // 🔧 修复(2025-12-31): referer_config可能是对象或字符串，需要先检查类型
      const refererConfigValue = task.referer_config;
      if (refererConfigValue && typeof refererConfigValue === 'string' && refererConfigValue.trim() && refererConfigValue !== 'null') {
        const refererCfg = JSON.parse(refererConfigValue);
        setRefererConfig({
          type: refererCfg.type || 'none',
          referer: refererCfg.referer
        });
      } else if (refererConfigValue && typeof refererConfigValue === 'object') {
        // referer_config 已经是对象
        setRefererConfig({
          type: refererConfigValue.type || 'none',
          referer: refererConfigValue.referer
        });
      } else {
        setRefererConfig({ type: 'none' });
      }
      // 🔧 修复P0-1(2025-12-30): 编辑模式下加载的distribution不应被useEffect覆盖
      // 设置为true表示这是从服务器加载的数据,阻止自动生成
      setIsDistributionManuallyModified(true);
    } catch (error) {
      console.error('加载任务失败:', error);
      toast.error('加载任务失败');
      onOpenChange(false);
    }
  };

  const handleRestartTask = async () => {
    if (!editTaskId) return;
    setRestarting(true);
    try {
      const response = await fetch(`/api/click-farm/tasks/${editTaskId}/restart`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || '恢复任务失败');
      }
      toast.success('任务已恢复');
      setTaskStatus('running');
    } catch (error: any) {
      console.error('恢复任务失败:', error);
      toast.error(error?.message || '恢复任务失败');
    } finally {
      setRestarting(false);
    }
  };

  // Load offers on mount
  useEffect(() => {
    if (open) {
      loadOffers();
    }
  }, [open]);

  // 🔧 修复(2025-12-30): [核心] distribution状态的唯一管理源
  // 这是distribution自动生成的唯一入口,避免多处设置导致竞态条件
  // 触发条件: selectedOfferId变化 || dailyClickCount变化 || timePeriod变化 || 手动修改标志重置
  // 手动修改场景(不触发此effect): 拖拽编辑、均衡分布、编辑器修改、编辑模式加载
  useEffect(() => {
    if (selectedOfferId && dailyClickCount > 0 && timePeriod && !isDistributionManuallyModified) {
      const [startTime, endTime] = timePeriod.split('-');
      const newDist = generateDefaultDistribution(dailyClickCount, startTime, endTime);
      setDistribution(newDist);
    }
  }, [selectedOfferId, dailyClickCount, timePeriod, isDistributionManuallyModified]);

  // 🔧 修复(2025-12-30): loadAuxiliaryData只负责检查代理和设置时区,不涉及distribution
  // distribution统一由useEffect(line 142-148)管理
  const loadAuxiliaryData = async (offer: Offer, offersList: Offer[]) => {
    // 🔧 修复P2-4(2025-12-30): 添加错误处理,防止时区设置失败影响整体流程
    try {
      // 并行检查代理
      const proxyResult = await fetch(`/api/settings/proxy?country=${offer.targetCountry.toLowerCase()}`)
        .then(async (res) => {
          if (!res.ok) return { warning: `未配置${offer.targetCountry}代理，请先前往设置页面配置` };
          const data = await res.json();
          if (!data.data?.proxy_url) return { warning: `未配置${offer.targetCountry}代理，请先前往设置页面配置` };
          return { warning: '' };
        })
        .catch(() => ({ warning: '检查代理配置失败' }));
      if (proxyResult.warning) {
        setProxyWarning(proxyResult.warning);
      } else {
        setProxyWarning('');
      }

      // 自动设置时区
      const autoTimezone = getTimezoneByCountry(offer.targetCountry);
      setTimezone(autoTimezone);
    } catch (error) {
      console.error('[loadAuxiliaryData] 错误:', error);
      // 设置失败不阻塞,使用默认时区
      toast.error('获取时区信息失败,已使用默认时区');
    }
  };

  // 🔧 修复(2025-12-30): 简化useLayoutEffect逻辑,避免复杂的调用链
  // 该effect只负责设置selectedOfferId,distribution由useEffect(line 142-148)统一管理
  // 🔧 修复P1-1(2025-12-30): 添加selectedOfferId到依赖数组,避免闭包陈旧值
  useLayoutEffect(() => {
    console.log('[ClickFarmTaskModal] useLayoutEffect EXECUTE: open=', open, 'preSelectedOfferId=', preSelectedOfferId, 'offers.length=', offers.length, 'selectedOfferId=', selectedOfferId);
    if (!open) return;

    // 如果有 preSelectedOfferId 且 offers 已加载，选中它
    if (preSelectedOfferId && offers.length > 0) {
      const offer = offers.find(o => o.id === preSelectedOfferId);
      if (offer && selectedOfferId !== preSelectedOfferId) {
        console.log('[ClickFarmTaskModal] useLayoutEffect: 选中 offer id =', offer.id, 'name =', offer.name);
        setSelectedOfferId(preSelectedOfferId);
      }
    } else if (!preSelectedOfferId && offers.length > 0 && !selectedOfferId) {
      // 如果没有 preSelectedOfferId，选择第一个 offer
      console.log('[ClickFarmTaskModal] useLayoutEffect: 无 preSelectedOfferId，选择第一个 offer');
      setSelectedOfferId(offers[0].id);
      // 异步加载辅助数据(代理检查、时区设置)
      loadAuxiliaryData(offers[0], offers).catch(e => {
        console.error('[ClickFarmTaskModal] loadAuxiliaryData 错误', e);
      });
    }
  }, [open, preSelectedOfferId, offers.length, selectedOfferId]);

  // 🔧 修复(2025-12-30): 删除重复的useEffect,统一由第142-148行的useEffect管理distribution生成
  // 原代码在此处有重复的useEffect,导致distribution被设置两次,引发竞态条件

  const loadOffers = async () => {
    try {
      setLoadingOffers(true);
      console.log('[ClickFarmTaskModal] loadOffers START: preSelectedOfferId =', preSelectedOfferId);

      // 🆕 如果有 preSelectedOfferId，只获取单个Offer的信息
      if (preSelectedOfferId) {
        const response = await fetch(`/api/offers/${preSelectedOfferId}`, {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          // 如果单个offer获取失败，降级获取列表
          console.log('[ClickFarmTaskModal] loadOffers: 单个offer获取失败，降级获取列表');
          await loadOffersList();
          return;
        }

        const data = await response.json();
        const offerData = data.offer || data.data;
        console.log('[ClickFarmTaskModal] loadOffers: 获取单个offer:', offerData);

        if (offerData) {
          setOffers([offerData]);
          setSelectedOfferId(preSelectedOfferId);
          // 🔧 修复(2025-12-30): 异步加载辅助数据(代理检查、时区设置),不阻塞主流程
          // distribution由useEffect自动生成,无需等待
          loadAuxiliaryData(offerData, [offerData]).catch(e => {
            console.error('[ClickFarmTaskModal] loadAuxiliaryData 错误', e);
          });
        }
      } else {
        // 没有 preSelectedOfferId 时，获取列表
        await loadOffersList();
      }

      console.log('[ClickFarmTaskModal] loadOffers END');
    } catch (error) {
      console.error('加载Offer失败:', error);
      toast.error('加载Offer列表失败');
    } finally {
      setLoadingOffers(false);
    }
  };

  // 🆕 获取Offer列表（用于没有 preSelectedOfferId 的情况）
  const loadOffersList = async () => {
    const response = await fetch('/api/offers?limit=100&isActive=true', {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) throw new Error('加载Offer失败');

    const data = await response.json();
    const offersData = data.offers || [];
    console.log('[ClickFarmTaskModal] loadOffersList: API返回', offersData.length, '个offers');
    setOffers(offersData);

    if (offersData.length > 0) {
      setSelectedOfferId(offersData[0].id);
      // 🔧 修复(2025-12-30): 异步加载辅助数据,不阻塞主流程
      loadAuxiliaryData(offersData[0], offersData).catch(e => {
        console.error('[ClickFarmTaskModal] loadAuxiliaryData 错误', e);
      });
    }
  };

  const generateDistribution = async () => {
    try {
      const [startTime, endTime] = timePeriod.split('-');
      const response = await fetch('/api/click-farm/distribution/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_click_count: dailyClickCount,
          start_time: startTime,
          end_time: endTime,
        }),
      });

      if (!response.ok) throw new Error('生成分布失败');

      const data = await response.json();
      setDistribution(data.data.distribution);
      // 🔧 修复P2-2(2025-12-30): API生成的distribution也标记为手动修改,防止被覆盖
      setIsDistributionManuallyModified(true);
    } catch (error) {
      console.error('生成时间分布失败:', error);
      toast.error('生成时间分布失败');
    }
  };

  // 🔧 修复P2-1(2025-12-30): checkProxy函数未使用,已删除冗余代码
  // 代理检查逻辑已整合到loadAuxiliaryData中

  const handleOfferChange = (offerId: number, offersDataParam?: Offer[]) => {
    console.log('[ClickFarmTaskModal] handleOfferChange START: offerId =', offerId, 'current offers.length =', offers.length, 'current selectedOfferId =', selectedOfferId);
    setSelectedOfferId(offerId);
    setIsDistributionManuallyModified(false); // 重置手动修改标志

    // 使用传入的 offersDataParam，如果没传则使用 state offers
    const offersList = offersDataParam || offers;
    const offer = offersList.find(o => o.id === offerId);
    console.log('[ClickFarmTaskModal] handleOfferChange: 找到offer?', !!offer, 'offerName:', offer?.offerName, 'brand:', offer?.brand, 'targetCountry:', offer?.targetCountry);
    if (offer) {
      // 🔧 修复(2025-12-30): 异步加载辅助数据,不阻塞
      loadAuxiliaryData(offer, offersList).catch(e => {
        console.error('[ClickFarmTaskModal] loadAuxiliaryData 错误', e);
      });
    }
    console.log('[ClickFarmTaskModal] handleOfferChange END');
  };

  /**
   * 拖拽编辑分布曲线
   */
  const handleDistributionBarDrag = (hour: number, deltaY: number) => {
    if (!isEditingDistribution || distribution.length === 0) return;

    // 🔧 修复P2-3(2025-12-30): 防止除零错误,处理全为0的边界情况
    const maxValue = Math.max(...distribution);
    if (maxValue === 0) {
      // 如果所有值都是0,直接返回,不处理拖拽
      return;
    }

    // Calculate new value based on drag distance
    const pixelsPerClick = 40 / maxValue; // 40px max height
    const clicksDelta = Math.round(-deltaY / pixelsPerClick); // negative because drag up = increase

    const newDistribution = [...distribution];
    const oldValue = newDistribution[hour];
    const newValue = Math.max(0, oldValue + clicksDelta);

    newDistribution[hour] = newValue;

    // Normalize to maintain total daily click count
    const currentTotal = newDistribution.reduce((sum, n) => sum + n, 0);
    if (currentTotal !== dailyClickCount && currentTotal > 0) {
      const ratio = dailyClickCount / currentTotal;
      for (let i = 0; i < newDistribution.length; i++) {
        newDistribution[i] = Math.round(newDistribution[i] * ratio);
      }
    }

    // Final adjustment to ensure exact total
    const finalTotal = newDistribution.reduce((sum, n) => sum + n, 0);
    const diff = dailyClickCount - finalTotal;
    if (diff !== 0) {
      // Add/subtract diff to the hour with highest value (excluding current hour if it was just set to 0)
      const maxIndex = newDistribution.indexOf(Math.max(...newDistribution));
      newDistribution[maxIndex] = Math.max(0, newDistribution[maxIndex] + diff);
    }

    setDistribution(newDistribution);
    // 🔧 修复(2025-12-30): 拖拽编辑后标记为手动修改,阻止useEffect自动覆盖
    setIsDistributionManuallyModified(true);
  };

  const handleBarMouseDown = (hour: number, e: React.MouseEvent) => {
    if (!isEditingDistribution) return;

    e.preventDefault();
    setDraggedHour(hour);

    const startY = e.clientY;
    const startValue = distribution[hour];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      handleDistributionBarDrag(hour, deltaY);
    };

    const handleMouseUp = () => {
      setDraggedHour(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const toggleEditMode = () => {
    if (distribution.length === 0) {
      toast.error('请先配置Offer和每日点击数以生成分布');
      return;
    }
    setIsEditingDistribution(!isEditingDistribution);
  };

  const resetDistribution = () => {
    generateDistribution();
    setIsDistributionManuallyModified(false);
    toast.success('已重置为默认分布');
  };

  const handleBalanceDistribution = () => {
    const [startTime, endTime] = timePeriod.split('-');
    const balanced = balanceDistribution(dailyClickCount, startTime, endTime);
    setDistribution(balanced);
    setIsDistributionManuallyModified(true);
    toast.success('已应用均衡分布');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ==========================================
    // 第一部分：Offer信息完整性校验
    // ==========================================

    // 1.1 校验Offer是否已选择
    if (!selectedOfferId) {
      toast.error('请选择一个Offer');
      return;
    }

    // 1.2 校验selectedOffer对象存在
    if (!selectedOffer) {
      toast.error('无法获取Offer信息，请重新选择');
      return;
    }

    // 1.3 校验Offer基本信息完整性
    const offerValidationErrors: string[] = [];

    if (!selectedOffer.affiliateLink) {
      offerValidationErrors.push('联盟推广链接（affiliateLink）未配置');
    } else {
      // 1.4 校验联盟链接格式有效性
      try {
        const url = new URL(selectedOffer.affiliateLink);
        if (!url.protocol.startsWith('http')) {
          offerValidationErrors.push('联盟推广链接协议无效（需http/https）');
        }
        if (!url.hostname) {
          offerValidationErrors.push('联盟推广链接域名无效');
        }
      } catch {
        offerValidationErrors.push('联盟推广链接格式无效（需有效的URL格式）');
      }
    }

    if (!selectedOffer.targetCountry) {
      offerValidationErrors.push('投放国家（targetCountry）未配置');
    }

    // 1.5 校验Offer名称标识（至少有一个可识别的名称）
    const offerName = selectedOffer.offerName || selectedOffer.brand || selectedOffer.name || selectedOffer.brand_name;
    if (!offerName || offerName.trim() === '') {
      offerValidationErrors.push('Offer名称信息不完整（无品牌、名称或Offer名称）');
    }

    // 如果有Offer信息校验错误，一次性显示
    if (offerValidationErrors.length > 0) {
      toast.error('Offer信息不完整，无法创建补点击任务');
      offerValidationErrors.forEach(err => {
        toast.error(err, { description: '请先完善Offer信息后再试' });
      });
      return;
    }

    // ==========================================
    // 第二部分：任务配置校验
    // ==========================================

    // 2.1 校验每日点击数
    if (!dailyClickCount || dailyClickCount < 1) {
      toast.error('每日点击数必须大于等于1');
      return;
    }
    if (dailyClickCount > 1000) {
      toast.error('每日点击数不能超过1000');
      return;
    }
    if (!Number.isInteger(dailyClickCount)) {
      toast.error('每日点击数必须为整数');
      return;
    }

    // 2.2 校验时间范围格式
    if (!timePeriod || !timePeriod.includes('-')) {
      toast.error('时间范围格式无效，请重新选择');
      return;
    }

    const [startTime, endTime] = timePeriod.split('-');
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

    if (!timeRegex.test(startTime)) {
      toast.error(`开始时间"${startTime}"格式无效（需HH:mm格式）`);
      return;
    }
    if (!timeRegex.test(endTime) && endTime !== '24:00') {
      toast.error(`结束时间"${endTime}"格式无效（需HH:mm格式或24:00）`);
      return;
    }

    // 2.3 校验持续天数
    if (!durationDays) {
      toast.error('请选择任务持续天数');
      return;
    }
    if (durationDays !== 9999 && (durationDays < 1 || durationDays > 365)) {
      toast.error('任务持续天数必须在1-365天之间，或选择"不限期"');
      return;
    }

    // 2.4 校验开始日期
    if (!scheduledStartDate) {
      toast.error('请选择任务开始日期');
      return;
    }
    // 校验日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(scheduledStartDate)) {
      toast.error('开始日期格式无效（需YYYY-MM-DD格式）');
      return;
    }
    // 校验开始日期不能是过去（允许今天及以后）
    const today = new Date().toISOString().split('T')[0];
    if (scheduledStartDate < today) {
      toast.error('开始日期不能早于今天');
      return;
    }

    // 2.5 校验时区
    if (!timezone) {
      toast.error('执行时区未设置，请重新选择Offer');
      return;
    }
    // 简单的IANA时区格式校验
    const ianaTimezoneRegex = /^[A-Za-z]+\/[A-Za-z_]+$/;
    if (!ianaTimezoneRegex.test(timezone)) {
      toast.error('执行时区格式无效');
      return;
    }

    // 2.6 校验24小时分布
    if (!distribution || !Array.isArray(distribution)) {
      toast.error('请先生成时间分布');
      return;
    }
    if (distribution.length !== 24) {
      toast.error(`时间分布数据无效（期望24小时，实际${distribution.length}小时）`);
      return;
    }

    // 2.7 校验分布数据有效性
    const [startHour] = startTime.split(':').map(Number);
    const [endHour] = endTime.split(':').map(Number);

    const invalidHours = distribution.find((count, hour) => {
      if (typeof count !== 'number' || count < 0) return true;
      // 非执行时间内应该有0点击
      if (endTime === '24:00') {
        if (hour < startHour) return count !== 0;
      } else if (endHour > startHour) {
        if (hour < startHour || hour >= endHour) return count !== 0;
      } else {
        if (hour < startHour && hour >= endHour) return count !== 0;
      }
      return false;
    });
    if (invalidHours !== undefined) {
      toast.error('时间分布数据与时间范围不匹配');
      return;
    }

    // 2.8 校验分布总和是否等于每日点击数
    const distributionTotal = distribution.reduce((sum, count) => sum + count, 0);
    if (distributionTotal !== dailyClickCount) {
      toast.error(`时间分布总和（${distributionTotal}）不等于每日点击数（${dailyClickCount}），请重新生成分布`);
      return;
    }

    // ==========================================
    // 第三部分：外部依赖校验
    // ==========================================

    if (proxyWarning) {
      toast.error('请先配置代理');
      return;
    }

    // 🔧 修复P2-8(2025-12-30): 校验refererConfig完整性
    if (refererConfig.type === 'specific' && !refererConfig.referer) {
      toast.error('请选择具体的Referer来源');
      return;
    }
    // 🆕 校验自定义Referer URL
    if (refererConfig.type === 'custom' && !refererConfig.referer) {
      toast.error('请输入自定义Referer URL');
      return;
    }
    if (refererConfig.type === 'custom' && refererConfig.referer) {
      try {
        new URL(refererConfig.referer);
      } catch {
        toast.error('自定义Referer URL格式无效，请输入完整的URL（如 https://example.com）');
        return;
      }
    }

    // ==========================================
    // 第四部分：提交数据
    // ==========================================

    try {
      setLoading(true);

      const requestData: CreateClickFarmTaskRequest = {
        offer_id: selectedOfferId!,
        daily_click_count: dailyClickCount,
        start_time: startTime,
        end_time: endTime,
        duration_days: durationDays === 9999 ? -1 : durationDays,
        scheduled_start_date: scheduledStartDate,
        hourly_distribution: distribution,
        timezone: timezone,
        referer_config: refererConfig,  // 🆕 添加Referer配置
      };

      console.log('[ClickFarmTaskModal] 发送请求数据:', {
        ...requestData,
        hourly_distribution: `[array of ${requestData.hourly_distribution.length} items]`,
        offer_info: {
          id: selectedOffer.id,
          name: offerName,
          country: selectedOffer.targetCountry,
          affiliateLink: '***hidden***'
        },
        referer_config: requestData.referer_config
      });

      // 🆕 编辑模式：使用PUT方法
      const response = await fetch(
        isEditMode ? `/api/click-farm/tasks/${editTaskId}` : '/api/click-farm/tasks',
        {
          method: isEditMode ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `${isEditMode ? '更新' : '创建'}任务失败`);
      }

      toast.success(`补点击任务${isEditMode ? '更新' : '创建'}成功`);
      onOpenChange(false);
      onSuccess?.();

      // Reset form - 使用统一的重置函数
      resetFormState();

    } catch (error: any) {
      console.error('创建任务失败:', error);
      toast.error(error.message || '创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  const selectedOffer = offers.find(o => o.id === selectedOfferId);

  // 🔧 修复P2-7(2025-12-30): 添加重置表单状态的函数
  const resetFormState = () => {
    setSelectedOfferId(null);
    setDailyClickCount(216);
    setTimePeriod('06:00-24:00');
    setDurationDays(14);
    setScheduledStartDate(new Date().toISOString().split('T')[0]);
    setDistribution([]);
    setProxyWarning('');
    setIsEditingDistribution(false);
    setIsDistributionManuallyModified(false);
    setDraggedHour(null);
    setTimezone(''); // 重置为空,等待选择offer时设置
    setRefererConfig({ type: 'none' });
  };

  // 处理对话框关闭,根据情况重置状态
  const handleDialogOpenChange = (newOpen: boolean) => {
    // 如果关闭对话框且不是编辑模式,重置表单
    if (!newOpen && !loading) {
      // 延迟重置,避免关闭动画时显示重置效果
      setTimeout(() => {
        resetFormState();
      }, 200);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEditMode ? '编辑补点击任务' : '创建补点击任务'}</DialogTitle>
          <DialogDescription>
            配置自动点击任务，帮助广告冷启动和提升投放表现
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Offer Selection + Offer Info Card */}
          <div className="space-y-4">
            {/* Offer Selection - Show dropdown when no preSelectedOfferId and not in edit mode */}
            {!preSelectedOfferId && !isEditMode && (
              <div className="space-y-2">
                <Label htmlFor="offer">选择Offer *</Label>
                {loadingOffers ? (
                  <div className="flex items-center justify-center h-10 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                ) : (
                  <Select
                    id="offer"
                    value={selectedOfferId?.toString() || ''}
                    onValueChange={(value) => handleOfferChange(parseInt(value))}
                    required
                  >
                    <SelectContent>
                      <SelectItem value="" disabled>
                        请选择Offer
                      </SelectItem>
                      {offers.map((offer) => (
                        <SelectItem key={offer.id} value={offer.id.toString()}>
                          #{offer.id} - {offer.offerName || offer.brand || offer.name || offer.brand_name} ({offer.targetCountry})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Offer Info - Show full offer details (displayed after selection or when preSelectedOfferId is provided) */}
            <div className="space-y-2">
              <Label>关联 Offer</Label>

              {/* Offer Info Card */}
              {selectedOffer ? (
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  {/* Offer ID */}
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Offer ID:</span>
                    <span className="font-medium">#{selectedOffer.id}</span>
                  </div>

                  {/* 产品标识 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">产品标识:</span>
                    <Badge className="h-5 text-xs" variant="outline">
                      {selectedOffer.offerName || selectedOffer.brand || selectedOffer.name || selectedOffer.brand_name || `Offer #${selectedOffer.id}`}
                    </Badge>
                  </div>

                  {/* 投放国家 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">投放国家:</span>
                    <span className="font-medium">{selectedOffer.targetCountry}</span>
                  </div>

                  {/* 执行时区 - 🔧 修复P2-10(2025-12-30): 只在timezone有值时显示 */}
                  {timezone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">时区:</span>
                      <span className="font-medium">{timezone}</span>
                    </div>
                  )}

                  {/* 联盟推广链接：单行显示，截断 */}
                  <div className="flex items-start gap-2 pt-2 border-t border-muted-foreground/20">
                    <Link className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-muted-foreground text-sm block">联盟推广链接:</span>
                      {selectedOffer.affiliateLink ? (
                        <div className="relative group">
                          <a
                            href={selectedOffer.affiliateLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-sm break-all block"
                          >
                            {selectedOffer.affiliateLink.length > 60
                              ? `${selectedOffer.affiliateLink.substring(0, 60)}...`
                              : selectedOffer.affiliateLink}
                          </a>
                          {/* Tooltip显示完整链接 */}
                          <div className="hidden group-hover:block absolute z-10 left-0 bottom-full mb-2 p-2 bg-popover text-popover-foreground text-xs rounded shadow-lg border max-w-[350px] break-all">
                            {selectedOffer.affiliateLink}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          未配置联盟链接
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  请选择一个 Offer
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Proxy Warning + Core Config + Referer Config */}
          <div className="space-y-4">
            {/* Proxy Warning */}
            {proxyWarning && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <div className="ml-2">
                  <p className="font-medium">{proxyWarning}</p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => window.open('/settings', '_blank')}
                  >
                    前往配置
                  </Button>
                </div>
              </Alert>
            )}

            {/* Configuration Fields - 2 Column Layout */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {/* Daily Click Count */}
              <div className="space-y-1">
                <Label htmlFor="dailyClicks">每日点击数 *</Label>
                <Input
                  id="dailyClicks"
                  type="number"
                  min={1}
                  max={1000}
                  value={dailyClickCount}
                  onChange={(e) => {
                    // 🔧 修复P2-5(2025-12-30): 改进清空行为,空值时保留NaN而非设为0
                    const value = e.target.value;
                    if (value === '') {
                      setDailyClickCount(0); // 临时设为0,用户继续输入时会更新
                    } else {
                      const parsed = parseInt(value);
                      setDailyClickCount(isNaN(parsed) ? 0 : parsed);
                    }
                    setIsDistributionManuallyModified(false); // Reset manual modification flag
                  }}
                  placeholder="建议: 216次/天"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  按需配置自然点击量
                </p>
              </div>

              {/* Scheduled Start Date */}
              <div className="space-y-1">
                <Label htmlFor="scheduledStartDate">开始日期 *</Label>
                <Input
                  id="scheduledStartDate"
                  type="date"
                  value={scheduledStartDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setScheduledStartDate(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  默认今天，可选未来日期
                </p>
              </div>

              {/* Time Period */}
              <div className="space-y-1">
                <Label htmlFor="timePeriod">时间段 *</Label>
                <Select
                  id="timePeriod"
                  value={timePeriod}
                  onValueChange={(value) => {
                    setTimePeriod(value);
                    // 🔧 修复P1-3(2025-12-30): 改变时间段时重置手动修改标志,触发distribution重新生成
                    setIsDistributionManuallyModified(false);
                  }}
                  required
                >
                  <SelectContent>
                    {TIME_PERIODS.map((period) => (
                      <SelectItem key={period.value} value={period.value}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Duration */}
              <div className="space-y-1">
                <Label htmlFor="duration">持续时长 *</Label>
                <Select
                  id="duration"
                  value={durationDays.toString()}
                  onValueChange={(value) => setDurationDays(parseInt(value))}
                  required
                >
                  <SelectContent>
                    {DURATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Referer配置 */}
            <div className="space-y-1.5 pt-2.5 border-t">
              <Label className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Referer来源配置
              </Label>
              <p className="text-xs text-muted-foreground">
                模拟真实用户来源，防止反爬识别
              </p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {/* Referer类型选择 */}
                <div className="space-y-1">
                  <Label htmlFor="refererType">Referer类型</Label>
                  <Select
                    id="refererType"
                    value={refererConfig.type}
                    onValueChange={(value) => {
                      setRefererConfig(prev => ({
                        ...prev,
                        type: value as 'none' | 'random' | 'specific' | 'custom',
                        referer: value === 'specific' || value === 'custom' ? prev.referer : undefined
                      }));
                    }}
                  >
                    <SelectContent>
                      {REFERER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {REFERER_OPTIONS.find(o => o.value === refererConfig.type)?.description}
                  </p>
                </div>

                {/* 特定Referer选择（仅当类型为specific时显示） */}
                {refererConfig.type === 'specific' ? (
                  <div className="space-y-1">
                    <Label htmlFor="specificReferer">选择Referer</Label>
                    <Select
                      id="specificReferer"
                      value={refererConfig.referer || ''}
                      onValueChange={(value) => {
                        setRefererConfig(prev => ({ ...prev, referer: value }));
                      }}
                    >
                      <SelectContent>
                        {SOCIAL_MEDIA_REFERRERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {/* 自定义Referer输入（仅当类型为custom时显示） */}
                {refererConfig.type === 'custom' ? (
                  <div className="space-y-1">
                    <Label htmlFor="customReferer">自定义Referer URL</Label>
                    <Input
                      id="customReferer"
                      type="url"
                      placeholder="https://example.com"
                      value={refererConfig.referer || ''}
                      onChange={(e) => {
                        setRefererConfig(prev => ({ ...prev, referer: e.target.value }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      输入完整的Referer URL（需包含协议）
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Bottom: Time Distribution Curve (spans both columns) */}
          <div className="col-span-1 lg:col-span-2">
            {/* Distribution Preview - Enhanced Editor */}
            {distribution.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    时间分布曲线
                  </Label>
                  <div className="flex items-center gap-2">
                    {isEditingDistribution && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleBalanceDistribution}
                          className="h-8 text-xs"
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          均衡分布
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={resetDistribution}
                          className="h-8 text-xs"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          重置
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={isEditingDistribution ? "default" : "outline"}
                      onClick={toggleEditMode}
                      className="h-8"
                    >
                      {isEditingDistribution ? '完成编辑' : '自定义编辑'}
                    </Button>
                  </div>
                </div>

                {/* Enhanced Distribution Editor */}
                <HourlyDistributionEditor
                  distribution={distribution}
                  dailyClickCount={dailyClickCount}
                  timePeriod={timePeriod}
                  isEditing={isEditingDistribution}
                  onChange={(hour, value) => {
                    if (!isEditingDistribution) return;
                    const newDistribution = [...distribution];
                    newDistribution[hour] = Math.max(0, value);

                    // 保持总数不变，智能重新分配差值
                    const currentTotal = newDistribution.reduce((sum, n) => sum + n, 0);
                    const diff = dailyClickCount - currentTotal;

                    if (diff !== 0) {
                      // 将差值按比例分配给其他小时
                      const otherHours = newDistribution
                        .map((val, idx) => ({ idx, val }))
                        .filter(({ idx }) => idx !== hour && newDistribution[idx] > 0);

                      if (otherHours.length > 0) {
                        const totalOthers = otherHours.reduce((sum, { val }) => sum + val, 0);

                        for (const { idx } of otherHours) {
                          const ratio = totalOthers > 0 ? newDistribution[idx] / totalOthers : 1 / otherHours.length;
                          newDistribution[idx] = Math.max(0, Math.round(newDistribution[idx] + diff * ratio));
                        }
                      }

                      // 最终微调确保总数精确
                      const finalTotal = newDistribution.reduce((sum, n) => sum + n, 0);
                      const finalDiff = dailyClickCount - finalTotal;
                      if (finalDiff !== 0) {
                        const maxIdx = newDistribution.indexOf(Math.max(...newDistribution));
                        newDistribution[maxIdx] = Math.max(0, newDistribution[maxIdx] + finalDiff);
                      }
                    }

                    setDistribution(newDistribution);
                    // 🔧 修复(2025-12-30): 编辑器修改后标记为手动修改,阻止useEffect自动覆盖
                    setIsDistributionManuallyModified(true);
                  }}
                />
              </div>
            )}

            {/* DialogFooter inside form */}
            <div className="pt-4 border-t">
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={loading}
                >
                  取消
                </Button>
                {canRestartTask && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleRestartTask}
                    disabled={loading || restarting}
                  >
                    {restarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    直接恢复
                  </Button>
                )}
                <Button type="submit" disabled={loading || !!proxyWarning}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isEditMode ? '更新任务' : '创建任务'}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
