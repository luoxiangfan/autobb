"use client";

import { useState, useEffect, useRef } from "react";
import {
  Clock3,
  Link2,
  Wand2,
  Link as LinkIcon,
  Rocket,
  CheckCircle2,
} from "lucide-react";

interface WorkflowStep {
  id: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  duration: string;
  color: string;
  gradient: string;
}

const workflowSteps: WorkflowStep[] = [
  {
    id: 1,
    icon: Link2,
    title: "输入链接",
    subtitle: "粘贴产品URL",
    duration: "1分钟",
    color: "text-blue-500",
    gradient: "from-blue-600 to-cyan-500",
  },
  {
    id: 2,
    icon: Wand2,
    title: "AI生成",
    subtitle: "智能创意生成",
    duration: "5分钟",
    color: "text-indigo-500",
    gradient: "from-indigo-600 to-blue-500",
  },
  {
    id: 3,
    icon: LinkIcon,
    title: "关联账号",
    subtitle: "绑定Google Ads",
    duration: "1分钟",
    color: "text-emerald-500",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    id: 4,
    icon: Rocket,
    title: "发布上线",
    subtitle: "一键投放广告",
    duration: "3分钟",
    color: "text-orange-500",
    gradient: "from-orange-500 to-amber-500",
  },
];

const WORKFLOW_CYCLE_MS = 10_000;
const WORKFLOW_PROGRESS_TICK_MS = 250;

function StepCard({
  step,
  isActive,
  isCompleted,
  onClick,
}: {
  step: WorkflowStep;
  isActive: boolean;
  isCompleted: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`relative cursor-pointer transition-all duration-300 ${
        isActive ? "scale-[1.02]" : "hover:-translate-y-0.5"
      }`}
      onClick={onClick}
    >
      {/* 步骤卡片 */}
      <div
        className={`relative p-4 rounded-2xl border-2 transition-all duration-300 ${
          isActive
            ? `border-transparent bg-gradient-to-br ${step.gradient} text-white shadow-lg`
            : isCompleted
            ? "border-blue-200 bg-blue-50"
            : "border-slate-200 bg-white hover:border-blue-200"
        }`}
      >
        {/* 图标 */}
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${
            isActive
              ? "bg-white/20"
            : isCompleted
              ? "bg-blue-600 text-white"
              : "bg-slate-100"
          }`}
        >
          {isCompleted && !isActive ? (
            <CheckCircle2 className="w-6 h-6" />
          ) : (
            <step.icon className={`w-6 h-6 ${isActive ? "text-white" : step.color}`} />
          )}
        </div>

        {/* 标题 */}
        <h3
          className={`mb-1 text-base font-bold ${
            isActive ? "text-white" : "text-slate-900"
          }`}
        >
          {step.title}
        </h3>
        <p
          className={`mb-2 text-sm ${
            isActive ? "text-white/80" : "text-slate-500"
          }`}
        >
          {step.subtitle}
        </p>

        {/* 时长 */}
        <div
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            isActive
              ? "bg-white/20 text-white"
            : "bg-slate-100 text-slate-600"
          }`}
        >
          <Clock3 className="mr-1 h-3.5 w-3.5" />
          {step.duration}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-600 via-cyan-500 to-orange-500 rounded-full transition-all duration-1000 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function WorkflowTimeline() {
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cycleStartRef = useRef<number>(Date.now());

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  // 自动播放进度
  useEffect(() => {
    if (!isVisible) return;

    const updateProgress = () => {
      const elapsed = Date.now() - cycleStartRef.current;
      setProgress(((elapsed % WORKFLOW_CYCLE_MS) / WORKFLOW_CYCLE_MS) * 100);
    };

    updateProgress();
    const interval = window.setInterval(updateProgress, WORKFLOW_PROGRESS_TICK_MS);

    return () => window.clearInterval(interval);
  }, [isVisible]);

  // 根据进度推导当前步骤（按时间比例：1+5+1+3=10分钟）
  // 输入链接(1分钟): 0-10%, AI生成(5分钟): 10-60%, 关联账号(1分钟): 60-70%, 发布上线(3分钟): 70-100%
  const activeStep = progress < 10 ? 0 : progress < 60 ? 1 : progress < 70 ? 2 : 3;

  return (
    <section ref={ref} className="bg-gradient-to-b from-white to-slate-50 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            4步完成，从创意到投放
          </h2>
          <p className="text-lg text-slate-600 sm:text-xl">
            全程只需 <span className="font-bold text-blue-600">10分钟</span>，每一步都可视化可追踪
          </p>
        </div>

        {/* 进度条 */}
        <div className="mx-auto mb-8 max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex justify-between text-sm text-slate-500 mb-2">
            <span>开始</span>
            <span className="font-medium text-slate-900">
              总进度 {Math.round(progress)}%
            </span>
            <span>完成</span>
          </div>
          <ProgressBar progress={progress} />
          <div className="flex justify-between mt-2">
            {/* 显示累计时间：0分钟, 1分钟, 6分钟, 7分钟, 10分钟 */}
            {["0分钟", "1分钟", "6分钟", "7分钟"].map((time, index) => (
              <div
                key={index}
                className={`text-sm font-medium transition-colors ${
                  index <= activeStep ? workflowSteps[Math.min(index, 3)].color : "text-slate-400"
                }`}
              >
                {time}
              </div>
            ))}
            <div
              className={`text-sm font-medium transition-colors ${
                progress >= 100 ? "text-orange-500" : "text-slate-400"
              }`}
            >
              10分钟
            </div>
          </div>
        </div>

        {/* 步骤卡片 */}
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
          {workflowSteps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              isActive={index === activeStep}
              isCompleted={index < activeStep}
              onClick={() => {
                // 按时间比例设置进度：0%, 10%, 60%, 70%
                const progressPoints = [0, 10, 60, 70];
                const nextProgress = progressPoints[index] + 5;
                cycleStartRef.current = Date.now() - (nextProgress / 100) * WORKFLOW_CYCLE_MS;
                setProgress(nextProgress);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
