'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  ProgressStage,
  ProgressStatus,
  ProgressEvent,
  SSEMessage,
} from '@/types/progress';

interface ExtractionResult {
  finalUrl: string;
  finalUrlSuffix: string;
  brand: string;
  productDescription?: string;
  targetLanguage: string;
  productCount?: number;
  [key: string]: any;
}

interface UseOfferExtractionReturn {
  // State
  isExtracting: boolean;
  currentStage: ProgressStage;
  currentStatus: ProgressStatus;
  currentMessage: string;
  events: ProgressEvent[];
  details?: ProgressEvent['details'];
  result: ExtractionResult | null;
  error: string | null;
  errorDetails?: Record<string, unknown>; // 错误详情（包含errorCode等）
  currentDuration?: number; // 当前阶段的耗时（毫秒）

  // Actions
  startExtraction: (affiliateLink: string, targetCountry: string) => void;
  reset: () => void;
}

export function useOfferExtraction(): UseOfferExtractionReturn {
  const [isExtracting, setIsExtracting] = useState(false);
  const [currentStage, setCurrentStage] = useState<ProgressStage>('resolving_link');
  const [currentStatus, setCurrentStatus] = useState<ProgressStatus>('pending');
  const [currentMessage, setCurrentMessage] = useState('');
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [details, setDetails] = useState<ProgressEvent['details']>();
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown> | undefined>(); // 错误详情
  const [currentDuration, setCurrentDuration] = useState<number | undefined>(); // 当前阶段耗时

  const eventSourceRef = useRef<EventSource | null>(null);
  const stageStartTimeRef = useRef<number>(Date.now()); // 追踪当前阶段开始时间
  const lastStageRef = useRef<ProgressStage>('resolving_link'); // 追踪上一个阶段

  const reset = useCallback(() => {
    setIsExtracting(false);
    setCurrentStage('resolving_link');
    setCurrentStatus('pending');
    setCurrentMessage('');
    setEvents([]);
    setDetails(undefined);
    setResult(null);
    setError(null);
    setErrorDetails(undefined);
    setCurrentDuration(undefined);
    stageStartTimeRef.current = Date.now();
    lastStageRef.current = 'resolving_link';

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const startExtraction = useCallback(
    async (affiliateLink: string, targetCountry: string) => {
      reset();
      setIsExtracting(true);
      setCurrentMessage('准备开始提取...');

      try {
        // Use fetch with streaming instead of EventSource for POST requests
        const response = await fetch('/api/offers/extract/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            affiliate_link: affiliateLink,
            target_country: targetCountry,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log('✅ SSE stream completed');
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete messages (separated by \n\n)
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || ''; // Keep incomplete message in buffer

          for (const message of messages) {
            if (!message.trim() || !message.startsWith('data: ')) continue;

            try {
              const jsonStr = message.substring(6); // Remove "data: " prefix
              const data: SSEMessage = JSON.parse(jsonStr);

              console.log('📨 SSE Message:', data);

              if (data.type === 'progress') {
                const progressEvent = data.data;

                // 如果是新的阶段开始，重置计时器
                if (progressEvent.stage !== lastStageRef.current && progressEvent.status === 'in_progress') {
                  stageStartTimeRef.current = Date.now();
                  setCurrentDuration(0);
                  lastStageRef.current = progressEvent.stage;
                }

                // 如果阶段完成，使用后端返回的duration
                if (progressEvent.status === 'completed' || progressEvent.status === 'error') {
                  const duration = progressEvent.duration;
                  if (duration !== undefined) {
                    setCurrentDuration(duration);
                  }
                }

                // 如果正在进行的阶段，更新已用时间
                if (progressEvent.status === 'in_progress') {
                  const elapsed = Date.now() - stageStartTimeRef.current;
                  setCurrentDuration(elapsed);
                }

                setCurrentStage(progressEvent.stage);
                setCurrentStatus(progressEvent.status);
                setCurrentMessage(progressEvent.message);
                setDetails(progressEvent.details);
                setEvents((prev) => [...prev, progressEvent]);
              } else if (data.type === 'complete') {
                setCurrentStage('completed');
                setCurrentStatus('completed');
                setCurrentMessage('提取完成！');
                setResult(data.data as any);
                setIsExtracting(false);
              } else if (data.type === 'error') {
                setCurrentStage('error');
                setCurrentStatus('error');
                setCurrentMessage(data.data.message);
                setError(data.data.message);
                setErrorDetails(data.data.details);
                setIsExtracting(false);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE message:', parseError, message);
            }
          }
        }
      } catch (err) {
        console.error('Extraction failed:', err);
        setCurrentStage('error');
        setCurrentStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        setCurrentMessage('提取失败，请重试');
        setIsExtracting(false);
      }
    },
    [reset]
  );

  return {
    isExtracting,
    currentStage,
    currentStatus,
    currentMessage,
    events,
    details,
    result,
    error,
    errorDetails,
    currentDuration, // 返回当前阶段耗时
    startExtraction,
    reset,
  };
}
