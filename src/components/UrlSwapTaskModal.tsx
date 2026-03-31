'use client';

import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Loader2, AlertCircle, Link, Clock, Globe, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { UrlSwapTask } from '@/lib/url-swap-types';
import { URL_SWAP_INTERVAL_OPTIONS, URL_SWAP_ALLOWED_INTERVALS_MINUTES } from '@/lib/url-swap-intervals';
import { parseAffiliateLinksText, findInvalidAffiliateLinks } from '@/lib/url-swap-link-utils';

interface UrlSwapTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  offerId?: number;  // 创建模式下必填
  editTaskId?: string;  // 编辑模式下必填（二选一）
}

interface Offer {
  id: number;
  offerName?: string;
  name?: string;
  brand?: string;
  brand_name?: string;
  targetCountry: string;
  affiliateLink?: string;
  // 🆕 关联的Google Ads信息（从Campaign获取）
  googleCustomerId?: string;
  googleCampaignId?: string;
}

const DURATION_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' },
  { value: -1, label: '不限期' },
];

export default function UrlSwapTaskModal({
  open,
  onOpenChange,
  onSuccess,
  offerId,
  editTaskId,
}: UrlSwapTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [taskData, setTaskData] = useState<UrlSwapTask | null>(null);
  const [proxyWarning, setProxyWarning] = useState('');
  const [enabling, setEnabling] = useState(false);

  // Form state
  const [swapIntervalMinutes, setSwapIntervalMinutes] = useState(30);
  const [durationDays, setDurationDays] = useState(30);
  const [googleCustomerId, setGoogleCustomerId] = useState('');
  const [googleCampaignId, setGoogleCampaignId] = useState('');
  const [swapMode, setSwapMode] = useState<'auto' | 'manual'>('auto');
  const [manualLinksText, setManualLinksText] = useState('');

  const isEditMode = !!editTaskId;
  const canEnableTask = isEditMode && !!taskData && (taskData.status === 'disabled' || taskData.status === 'error');

  // Load existing task data (edit mode)
  useEffect(() => {
    if (open && editTaskId) {
      loadTaskData();
    }
  }, [open, editTaskId]);

  // Load offer (create mode)
  useEffect(() => {
    if (open && !editTaskId && offerId) {
      loadOfferById(offerId);
    }
  }, [open, offerId, editTaskId]);

  const loadTaskData = async () => {
    try {
      const response = await fetch(`/api/url-swap/tasks/${editTaskId}`);
      if (!response.ok) throw new Error('加载任务失败');

      const { data: task } = await response.json();
      setTaskData(task);
      setSwapIntervalMinutes(task.swap_interval_minutes);
      setDurationDays(task.duration_days);
      setGoogleCustomerId(task.google_customer_id || '');
      setGoogleCampaignId(task.google_campaign_id || '');
      setSwapMode((task as any).swap_mode === 'manual' ? 'manual' : 'auto');
      setManualLinksText(Array.isArray((task as any).manual_affiliate_links) ? (task as any).manual_affiliate_links.join('\n') : '');

      // 加载关联的Offer信息
      if (task.offer_id) {
        loadOfferById(task.offer_id);
      }
    } catch (error) {
      console.error('加载任务失败:', error);
      toast.error('加载任务失败');
      onOpenChange(false);
    }
  };

  const handleEnableTask = async () => {
    if (!editTaskId) return;
    setEnabling(true);
    try {
      const response = await fetch(`/api/url-swap/tasks/${editTaskId}/enable`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || '启用任务失败');
      }
      toast.success('任务已启用');
      setTaskData(prev => (prev ? { ...prev, status: 'enabled' } : prev));
    } catch (error: any) {
      console.error('启用任务失败:', error);
      toast.error(error?.message || '启用任务失败');
    } finally {
      setEnabling(false);
    }
  };

  const loadOfferById = async (id: number) => {
    try {
      setLoadingOffer(true);

      // 获取Offer信息
      const response = await fetch(`/api/offers/${id}`);
      if (!response.ok) throw new Error('加载Offer失败');

      const data = await response.json();
      const offerData = data.offer || data.data;

      if (offerData) {
        // 🆕 从本地DB获取该Offer关联的Google Ads信息（不依赖Google Ads API）
        try {
          const idsResponse = await fetch(`/api/offers/${id}/google-ads-ids`);
          if (idsResponse.ok) {
            const idsResult = await idsResponse.json();
            const ids = idsResult?.data;

            if (ids?.googleCustomerId) {
              offerData.googleCustomerId = ids.googleCustomerId;
              if (!isEditMode || !googleCustomerId) {
                setGoogleCustomerId(ids.googleCustomerId);
              }
            }

            if (ids?.googleCampaignId) {
              offerData.googleCampaignId = ids.googleCampaignId;
              if (!isEditMode || !googleCampaignId) {
                setGoogleCampaignId(ids.googleCampaignId);
              }
            }
          }
        } catch (idsError) {
          console.warn('获取Offer关联Google Ads信息失败:', idsError);
          // 不影响主流程，继续执行
        }

        setOffer(offerData);
        checkProxy(offerData);
      }
    } catch (error) {
      console.error('加载Offer失败:', error);
      toast.error('加载Offer失败');
    } finally {
      setLoadingOffer(false);
    }
  };

  const checkProxy = async (offerData: Offer) => {
    try {
      const response = await fetch(`/api/settings/proxy?country=${offerData.targetCountry.toLowerCase()}`);
      if (!response.ok) {
        setProxyWarning(`未配置 ${offerData.targetCountry} 代理，请先前往设置页面配置`);
        return;
      }
      const data = await response.json();
      if (!data.data?.proxy_url) {
        setProxyWarning(`未配置 ${offerData.targetCountry} 代理，请先前往设置页面配置`);
      } else {
        setProxyWarning('');
      }
    } catch {
      setProxyWarning('检查代理配置失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!offer) {
      toast.error('无法获取Offer信息');
      return;
    }

    if (!offer.affiliateLink) {
      if (swapMode === 'auto') {
        toast.error('Offer未配置联盟推广链接，无法创建换链任务');
        return;
      }
    }

    if (proxyWarning) {
      toast.error('请先配置代理');
      return;
    }

    // 缺少Customer/Campaign ID会导致任务执行失败（无法更新Google Ads）
    if (!googleCustomerId.trim() || !googleCampaignId.trim()) {
      toast.error('请填写 Customer ID 与 Campaign ID（用于更新 Google Ads Final URL suffix）');
      return;
    }

    let manualAffiliateLinks: string[] = [];
    if (swapMode === 'manual') {
      manualAffiliateLinks = parseAffiliateLinksText(manualLinksText);

      if (manualAffiliateLinks.length === 0) {
        toast.error('方式二需要至少配置 1 个推广链接');
        return;
      }

      const invalidLinks = findInvalidAffiliateLinks(manualAffiliateLinks);
      if (invalidLinks.length > 0) {
        toast.error('推广链接需包含 http/https 协议，请检查输入');
        return;
      }
    }

    const validIntervals = [...URL_SWAP_ALLOWED_INTERVALS_MINUTES];
    if (!validIntervals.includes(swapIntervalMinutes)) {
      toast.error(`换链间隔必须是以下值之一：${validIntervals.join(', ')} 分钟`);
      return;
    }

    if (durationDays !== -1 && (durationDays < 1 || durationDays > 365)) {
      toast.error('任务持续天数必须在1-365天之间，或选择"不限期"');
      return;
    }

    try {
      setLoading(true);

      const requestData = {
        offer_id: offer.id,
        swap_interval_minutes: swapIntervalMinutes,
        duration_days: durationDays === -1 ? -1 : durationDays,
        google_customer_id: googleCustomerId || null,
        google_campaign_id: googleCampaignId || null,
        swap_mode: swapMode,
        manual_affiliate_links: swapMode === 'manual' ? manualAffiliateLinks : undefined,
      };

      const url = isEditMode
        ? `/api/url-swap/tasks/${editTaskId}`
        : '/api/url-swap/tasks';

      const response = await fetch(url, {
        method: isEditMode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `${isEditMode ? '更新' : '创建'}任务失败`);
      }

      toast.success(`换链任务${isEditMode ? '更新' : '创建'}成功`);
      onOpenChange(false);
      onSuccess?.();
      resetFormState();
    } catch (error: any) {
      console.error('创建任务失败:', error);
      toast.error(error.message || '创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    setSwapIntervalMinutes(30);
    setDurationDays(30);
    setGoogleCustomerId('');
    setGoogleCampaignId('');
    setSwapMode('auto');
    setManualLinksText('');
    setProxyWarning('');
    setTaskData(null);
  };

  const handleDialogOpenChange = (newOpen: boolean) => {
    if (!newOpen && !loading) {
      setTimeout(() => {
        resetFormState();
      }, 200);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '编辑换链任务' : '创建换链任务'}</DialogTitle>
          <DialogDescription>
            支持两种换链方式：自动访问推广链接解析（方式一）或轮询推广链接列表解析（方式二）
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Offer Info Card */}
          <div className="space-y-2">
            <Label>关联 Offer</Label>
            {loadingOffer ? (
              <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载Offer信息...
              </div>
            ) : offer ? (
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Offer ID:</span>
                  <span className="font-medium">#{offer.id}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">产品:</span>
                  <Badge variant="outline">
                    {offer.offerName || offer.brand || offer.name || offer.brand_name || `Offer #${offer.id}`}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">投放国家:</span>
                  <span className="font-medium">{offer.targetCountry}</span>
                </div>
                {offer.affiliateLink && (
                  <div className="flex items-start gap-2 pt-2 border-t border-muted-foreground/20">
                    <Link className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-muted-foreground text-sm block">联盟推广链接:</span>
                      <a
                        href={offer.affiliateLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm break-all block"
                      >
                        {offer.affiliateLink.length > 50
                          ? `${offer.affiliateLink.substring(0, 50)}...`
                          : offer.affiliateLink}
                        <ExternalLink className="inline ml-1 h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                加载失败，请重试
              </div>
            )}
          </div>

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

          {/* Swap Mode */}
          <div className="space-y-2">
            <Label htmlFor="swapMode">换链方式 *</Label>
            <Select
              id="swapMode"
              value={swapMode}
              onValueChange={(value) => setSwapMode(value === 'manual' ? 'manual' : 'auto')}
              required
            >
              <SelectContent>
                <SelectItem value="auto">方式一：自动访问推广链接解析</SelectItem>
                <SelectItem value="manual">方式二：轮询推广链接列表（不同账号）</SelectItem>
              </SelectContent>
            </Select>
            {swapMode === 'auto' ? (
              <p className="text-xs text-muted-foreground">
                适用于：同一个推广链接多次访问最终参数会变化或联盟更换链接。系统自动访问当前推广链接获取最新 Final URL/Suffix，需要配置对应国家代理。
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                适用于：同一Offer不同联盟账号有不同推广链接，需要在账号间轮换。系统会按顺序访问列表中的推广链接并提取 Final URL/Suffix，需要配置代理。
              </p>
            )}
          </div>

          {/* Task Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="interval">换链间隔 *</Label>
              <Select
                id="interval"
                value={swapIntervalMinutes.toString()}
                onValueChange={(value) => setSwapIntervalMinutes(parseInt(value))}
                required
              >
                <SelectContent>
                    {URL_SWAP_INTERVAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                检测Offer链接变化的频率
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">任务持续 *</Label>
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

          {/* Manual promotion link list */}
          {swapMode === 'manual' && (
            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor="manualSuffixes">推广链接列表 *</Label>
              <Textarea
                id="manualSuffixes"
                value={manualLinksText}
                onChange={(e) => setManualLinksText(e.target.value)}
                placeholder={`一行一个完整推广链接\n示例：https://link.foshotech.com/49Q2NF1\nhttps://www.belk.com/?cm_mmc=...`}
                className="min-h-[120px]"
                required
              />
              <p className="text-xs text-muted-foreground">
                系统会按顺序轮询访问（到末尾后回到第一条），自动提取 Final URL 和 Final URL Suffix 用于更新Campaign追踪参数。
              </p>
            </div>
          )}

          {/* Google Ads Configuration */}
          <div className="space-y-3 pt-2 border-t">
            <Label className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Google Ads 配置
              {offer?.googleCustomerId || offer?.googleCampaignId ? (
                <Badge variant="secondary" className="ml-2">已关联</Badge>
              ) : (
                <span className="text-xs text-muted-foreground font-normal">（必填）</span>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {offer?.googleCustomerId || offer?.googleCampaignId
                ? '从关联的Campaign自动获取，如需修改请前往Campaign管理页面'
                : '用于更新Campaign层级 Final URL suffix（缺失将导致任务执行失败）'
              }
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerId">Customer ID</Label>
                <Input
                  id="customerId"
                  value={googleCustomerId}
                  onChange={(e) => setGoogleCustomerId(e.target.value)}
                  placeholder="例如: 123-456-7890"
                  disabled={!!(offer?.googleCustomerId)}
                  className={offer?.googleCustomerId ? 'bg-gray-50' : ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaignId">Campaign ID</Label>
                <Input
                  id="campaignId"
                  value={googleCampaignId}
                  onChange={(e) => setGoogleCampaignId(e.target.value)}
                  placeholder="例如: 123456789"
                  disabled={!!(offer?.googleCampaignId)}
                  className={offer?.googleCampaignId ? 'bg-gray-50' : ''}
                />
              </div>
            </div>
          </div>

          {/* Dialog Footer */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            {canEnableTask && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleEnableTask}
                disabled={loading || enabling}
              >
                {enabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                直接启用
              </Button>
            )}
            <Button type="submit" disabled={loading || (swapMode === 'auto' && !!proxyWarning)}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditMode ? '更新任务' : '创建任务'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
