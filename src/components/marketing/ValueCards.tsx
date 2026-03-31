"use client";

import { useEffect, useState, useRef } from "react";
import CountUp from "react-countup";
import {
  Clock,
  DollarSign,
  GraduationCap,
  Globe,
  ArrowRight,
  Calendar,
  Coffee,
  Zap,
} from "lucide-react";

interface ValueCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  beforeValue: string;
  afterValue: number;
  afterSuffix: string;
  improvement: string;
  improvementColor: string;
  gradient: string;
  description: string;
  visualType: "time" | "cost" | "roi" | "difficulty" | "global";
}

const valueCards: ValueCardProps[] = [
  {
    icon: Clock,
    title: "省时间",
    subtitle: "从熬夜到喝咖啡",
    beforeValue: "3-5天",
    afterValue: 10,
    afterSuffix: "分钟",
    improvement: "↓ 99%",
    improvementColor: "text-emerald-400",
    gradient: "from-blue-500 to-cyan-500",
    description: "告别熬夜写广告，一杯咖啡的时间搞定",
    visualType: "time",
  },
  {
    icon: DollarSign,
    title: "省钱",
    subtitle: "测试费用降低75%",
    beforeValue: "$400",
    afterValue: 100,
    afterSuffix: "$",
    improvement: "↓ 75%",
    improvementColor: "text-emerald-400",
    gradient: "from-emerald-500 to-teal-500",
    description: "不用反复测试，第一次就能跑出好效果",
    visualType: "cost",
  },
  {
    icon: GraduationCap,
    title: "零门槛",
    subtitle: "小白变专家",
    beforeValue: "140小时",
    afterValue: 3,
    afterSuffix: "分钟",
    improvement: "↓ 99.9%",
    improvementColor: "text-emerald-400",
    gradient: "from-orange-500 to-red-500",
    description: "不懂Google Ads也能像专家一样投广告",
    visualType: "difficulty",
  },
  {
    icon: Globe,
    title: "全球化",
    subtitle: "一个工具打天下",
    beforeValue: "$1500",
    afterValue: 20,
    afterSuffix: "+国家",
    improvement: "翻译费 $0",
    improvementColor: "text-blue-400",
    gradient: "from-indigo-500 to-purple-500",
    description: "20+国家，15+语言，AI自动本地化",
    visualType: "global",
  },
];

// 时间对比可视化
function TimeVisual({ isVisible }: { isVisible: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 h-24">
      {/* 传统方式 */}
      <div className="flex flex-col items-center flex-1">
        <div className="flex items-center gap-1 mb-2">
          {[1, 2, 3, 4, 5].map((day) => (
            <div
              key={day}
              className={`w-6 h-8 rounded bg-red-500/30 border border-red-500/50 flex items-center justify-center text-xs text-red-400 transition-all duration-500 ${
                isVisible ? "opacity-100" : "opacity-0"
              }`}
              style={{ transitionDelay: `${day * 100}ms` }}
            >
              <Calendar className="w-3 h-3" />
            </div>
          ))}
        </div>
        <span className="text-xs text-slate-500">3-5天</span>
      </div>

      <ArrowRight className="w-6 h-6 text-slate-400" />

      {/* AutoAds */}
      <div className="flex flex-col items-center flex-1">
        <div
          className={`w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center transition-all duration-700 ${
            isVisible ? "scale-100 opacity-100" : "scale-50 opacity-0"
          }`}
        >
          <Coffee className="w-8 h-8 text-emerald-400" />
        </div>
        <span className="text-xs text-emerald-400 mt-2">10分钟</span>
      </div>
    </div>
  );
}

// 成本对比可视化
function CostVisual({ isVisible }: { isVisible: boolean }) {
  return (
    <div className="flex items-end justify-center gap-8 h-24">
      {/* 传统 */}
      <div className="flex flex-col items-center">
        <div
          className={`w-12 bg-gradient-to-t from-red-500 to-red-400 rounded-t transition-all duration-1000 ease-out ${
            isVisible ? "h-20" : "h-0"
          }`}
        />
        <span className="text-xs text-slate-500 mt-2">$400</span>
      </div>

      {/* AutoAds */}
      <div className="flex flex-col items-center">
        <div
          className={`w-12 bg-gradient-to-t from-emerald-500 to-emerald-400 rounded-t transition-all duration-1000 ease-out delay-300 ${
            isVisible ? "h-5" : "h-0"
          }`}
        />
        <span className="text-xs text-emerald-400 mt-2">$100</span>
      </div>
    </div>
  );
}

// ROI增长可视化
function RoiVisual({ isVisible }: { isVisible: boolean }) {
  return (
    <div className="h-24 flex items-center justify-center">
      <svg viewBox="0 0 120 60" className="w-full h-full">
        {/* 基准线 */}
        <line x1="10" y1="50" x2="110" y2="50" stroke="#334155" strokeWidth="1" />

        {/* 增长曲线 */}
        <path
          d="M 10 45 Q 40 40, 60 30 T 110 10"
          fill="none"
          stroke="url(#roiGradient)"
          strokeWidth="3"
          strokeLinecap="round"
          className={`transition-all duration-1500 ${
            isVisible ? "stroke-dashoffset-0" : ""
          }`}
          style={{
            strokeDasharray: 150,
            strokeDashoffset: isVisible ? 0 : 150,
            transition: "stroke-dashoffset 1.5s ease-out",
          }}
        />

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="roiGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>

        {/* 数据点 */}
        <circle
          cx="10"
          cy="45"
          r="4"
          fill="#8B5CF6"
          className={`transition-all duration-500 ${isVisible ? "opacity-100" : "opacity-0"}`}
        />
        <circle
          cx="110"
          cy="10"
          r="4"
          fill="#EC4899"
          className={`transition-all duration-500 delay-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}
        />

        {/* 标签 */}
        <text x="10" y="58" className="text-[8px] fill-slate-500">2.0x</text>
        <text x="100" y="8" className="text-[8px] fill-purple-400">2.8x</text>
      </svg>
    </div>
  );
}

// 难度对比可视化
function DifficultyVisual({ isVisible }: { isVisible: boolean }) {
  return (
    <div className="h-24 flex items-center justify-center gap-4">
      {/* 传统 - 复杂 */}
      <div className="flex flex-col items-center">
        <div className="relative w-16 h-16">
          <div
            className={`absolute inset-0 rounded-full border-4 border-red-500/30 transition-all duration-700 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            className={`absolute inset-2 rounded-full border-4 border-red-500/50 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            className={`absolute inset-4 rounded-full border-4 border-red-500/70 transition-all duration-700 delay-400 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-red-400">专家</span>
          </div>
        </div>
        <span className="text-xs text-slate-500 mt-1">140小时</span>
      </div>

      <ArrowRight className="w-6 h-6 text-slate-400" />

      {/* AutoAds - 简单 */}
      <div className="flex flex-col items-center">
        <div
          className={`w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center transition-all duration-700 delay-500 ${
            isVisible ? "scale-100 opacity-100" : "scale-50 opacity-0"
          }`}
        >
          <Zap className="w-8 h-8 text-emerald-400" />
        </div>
        <span className="text-xs text-emerald-400 mt-1">3分钟</span>
      </div>
    </div>
  );
}

// 全球化可视化
function GlobalVisual({ isVisible }: { isVisible: boolean }) {
  const countries = [
    { x: 25, y: 30, delay: 0 },    // 美国
    { x: 55, y: 25, delay: 200 },  // 欧洲
    { x: 75, y: 35, delay: 400 },  // 中国
    { x: 85, y: 50, delay: 600 },  // 日本
    { x: 45, y: 55, delay: 800 },  // 巴西
    { x: 60, y: 60, delay: 1000 }, // 澳洲
  ];

  return (
    <div className="h-24 flex items-center justify-center">
      <svg viewBox="0 0 100 70" className="w-full h-full">
        {/* 简化的世界地图轮廓 */}
        <ellipse
          cx="50"
          cy="35"
          rx="45"
          ry="30"
          fill="none"
          stroke="#334155"
          strokeWidth="1"
          strokeDasharray="4 2"
        />

        {/* 国家点 */}
        {countries.map((country, index) => (
          <g key={index}>
            <circle
              cx={country.x}
              cy={country.y}
              r="4"
              fill="#3B82F6"
              className={`transition-all duration-500 ${
                isVisible ? "opacity-100 scale-100" : "opacity-0 scale-0"
              }`}
              style={{
                transitionDelay: `${country.delay}ms`,
                transformOrigin: `${country.x}px ${country.y}px`
              }}
            />
            <circle
              cx={country.x}
              cy={country.y}
              r="8"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="1"
              className={`transition-all duration-700 ${
                isVisible ? "opacity-30 scale-100" : "opacity-0 scale-0"
              }`}
              style={{
                transitionDelay: `${country.delay + 200}ms`,
                transformOrigin: `${country.x}px ${country.y}px`
              }}
            />
          </g>
        ))}

        {/* 连接线 */}
        <path
          d="M 25 30 Q 40 20, 55 25 Q 65 28, 75 35"
          fill="none"
          stroke="#3B82F6"
          strokeWidth="1"
          strokeDasharray="2 2"
          className={`transition-all duration-1000 ${
            isVisible ? "opacity-50" : "opacity-0"
          }`}
          style={{ transitionDelay: "800ms" }}
        />
      </svg>
    </div>
  );
}

// 根据类型返回对应的可视化组件
function VisualComponent({ type, isVisible }: { type: string; isVisible: boolean }) {
  switch (type) {
    case "time":
      return <TimeVisual isVisible={isVisible} />;
    case "cost":
      return <CostVisual isVisible={isVisible} />;
    case "roi":
      return <RoiVisual isVisible={isVisible} />;
    case "difficulty":
      return <DifficultyVisual isVisible={isVisible} />;
    case "global":
      return <GlobalVisual isVisible={isVisible} />;
    default:
      return null;
  }
}

function ValueCard({ card, index }: { card: ValueCardProps; index: number }) {
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
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`group relative bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-2 overflow-hidden ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      {/* 渐变背景 hover效果 */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`}
      />

      <div className="relative z-10 p-6">
        {/* 头部：图标 + 标题 */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}
          >
            <card.icon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">{card.title}</h3>
            <p className="text-sm text-slate-500">{card.subtitle}</p>
          </div>
        </div>

        {/* 可视化区域 */}
        <div className="mb-4 bg-slate-50 rounded-2xl p-4">
          <VisualComponent type={card.visualType} isVisible={isVisible} />
        </div>

        {/* 数据对比 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 line-through">{card.beforeValue}</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <span className="text-lg font-bold text-slate-900">
              {isVisible && card.visualType !== "roi" ? (
                <CountUp end={card.afterValue} duration={2} delay={0.5} />
              ) : isVisible ? (
                <CountUp end={card.afterValue} duration={2} delay={0.5} decimals={1} />
              ) : (
                "0"
              )}
              <span className="text-sm font-medium text-slate-600 ml-1">
                {card.afterSuffix}
              </span>
            </span>
          </div>
          <span className={`text-sm font-bold ${card.improvementColor}`}>
            {card.improvement}
          </span>
        </div>

        {/* 描述 */}
        <p className="text-sm text-slate-600 leading-relaxed">{card.description}</p>
      </div>
    </div>
  );
}

export function ValueCards() {
  return (
    <section className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            为什么 1000+ 专业玩家选择 AutoAds？
          </h2>
          <p className="text-xl text-slate-600">
            4大核心价值，让你的广告投放效率翻倍
          </p>
        </div>

        {/* 卡片网格 - 2x2 布局 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {valueCards.map((card, index) => (
            <ValueCard key={index} card={card} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
