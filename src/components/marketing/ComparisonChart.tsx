"use client";

import { useState, useEffect, useRef } from "react";
import CountUp from "react-countup";
import { Clock, DollarSign, TrendingUp, RotateCcw, Target, CheckCircle2 } from "lucide-react";

interface ComparisonItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  before: { value: number; suffix: string; display: string };
  after: { value: number; suffix: string; display: string };
  improvement: string;
  improvementType: "decrease" | "increase";
}

const comparisonData: ComparisonItem[] = [
  {
    icon: Clock,
    label: "创建广告时间",
    before: { value: 72, suffix: "小时", display: "3-5天" },
    after: { value: 10, suffix: "分钟", display: "10分钟" },
    improvement: "↓ 99%",
    improvementType: "decrease",
  },
  {
    icon: DollarSign,
    label: "测试成本",
    before: { value: 400, suffix: "$", display: "$400" },
    after: { value: 100, suffix: "$", display: "$100" },
    improvement: "↓ 75%",
    improvementType: "decrease",
  },
  {
    icon: TrendingUp,
    label: "ROI收益",
    before: { value: 2.0, suffix: "x", display: "2.0x" },
    after: { value: 2.8, suffix: "x", display: "2.8x" },
    improvement: "↑ 40%",
    improvementType: "increase",
  },
  {
    icon: RotateCcw,
    label: "创意重试次数",
    before: { value: 2.5, suffix: "次", display: "2.5次" },
    after: { value: 1.2, suffix: "次", display: "1.2次" },
    improvement: "↓ 52%",
    improvementType: "decrease",
  },
  {
    icon: Target,
    label: "广告通过率",
    before: { value: 80, suffix: "%", display: "80%" },
    after: { value: 95, suffix: "%", display: "95%" },
    improvement: "↑ 15%",
    improvementType: "increase",
  },
];

function AnimatedBar({
  value,
  maxValue,
  color,
  isVisible,
  delay,
}: {
  value: number;
  maxValue: number;
  color: string;
  isVisible: boolean;
  delay: number;
}) {
  const percentage = (value / maxValue) * 100;

  return (
    <div className="h-8 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-out ${color}`}
        style={{
          width: isVisible ? `${percentage}%` : "0%",
          transitionDelay: `${delay}ms`,
        }}
      />
    </div>
  );
}

function ComparisonRow({
  item,
  index,
  isVisible,
}: {
  item: ComparisonItem;
  index: number;
  isVisible: boolean;
}) {
  // 计算最大值用于柱状图比例
  const maxValue = Math.max(item.before.value, item.after.value) * 1.2;

  return (
    <div
      className={`grid grid-cols-12 gap-4 items-center py-6 border-b border-slate-100 last:border-b-0 transition-all duration-500 ${
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      {/* 指标名称 */}
      <div className="col-span-12 md:col-span-2 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
          <item.icon className="w-5 h-5 text-slate-600" />
        </div>
        <span className="font-medium text-slate-900">{item.label}</span>
      </div>

      {/* 传统方式 */}
      <div className="col-span-5 md:col-span-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-500">传统方式</span>
          <span className="text-sm font-semibold text-red-600">
            {item.before.display}
          </span>
        </div>
        <AnimatedBar
          value={item.before.value}
          maxValue={maxValue}
          color="bg-gradient-to-r from-red-400 to-red-500"
          isVisible={isVisible}
          delay={index * 100}
        />
      </div>

      {/* AutoAds */}
      <div className="col-span-5 md:col-span-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-500">用 AutoAds</span>
          <span className="text-sm font-semibold text-emerald-600">
            {isVisible ? (
              item.after.value % 1 === 0 ? (
                <CountUp end={item.after.value} duration={2} delay={index * 0.1} />
              ) : (
                <CountUp
                  end={item.after.value}
                  duration={2}
                  delay={index * 0.1}
                  decimals={1}
                />
              )
            ) : (
              "0"
            )}
            {item.after.suffix}
          </span>
        </div>
        <AnimatedBar
          value={item.after.value}
          maxValue={maxValue}
          color="bg-gradient-to-r from-emerald-400 to-emerald-500"
          isVisible={isVisible}
          delay={index * 100 + 300}
        />
      </div>

      {/* 提升幅度 */}
      <div className="col-span-2 md:col-span-2 text-right">
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${
            item.improvementType === "decrease"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-purple-100 text-purple-700"
          }`}
        >
          {item.improvement}
        </span>
      </div>
    </div>
  );
}

export function ComparisonChart() {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            使用 AutoAds 前后对比
          </h2>
          <p className="text-xl text-slate-600">
            真实数据，一目了然
          </p>
        </div>

        {/* 对比表格 */}
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            {/* 表头 */}
            <div className="hidden md:grid grid-cols-12 gap-4 pb-4 border-b-2 border-slate-200">
              <div className="col-span-2 text-sm font-semibold text-slate-500">
                指标
              </div>
              <div className="col-span-4 text-sm font-semibold text-red-500 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                传统方式
              </div>
              <div className="col-span-4 text-sm font-semibold text-emerald-500 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                用 AutoAds
              </div>
              <div className="col-span-2 text-sm font-semibold text-slate-500 text-right">
                提升
              </div>
            </div>

            {/* 数据行 */}
            {comparisonData.map((item, index) => (
              <ComparisonRow
                key={index}
                item={item}
                index={index}
                isVisible={isVisible}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
