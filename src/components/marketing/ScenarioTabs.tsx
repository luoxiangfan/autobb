"use client";

import { useState, useEffect, useRef } from "react";
import {
  Clock,
  Package,
  Globe,
  ArrowRight,
  Play,
  CheckCircle2,
  Coffee,
  Moon,
  Sun,
  Zap,
} from "lucide-react";

interface Scenario {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  color: string;
  gradient: string;
  story: {
    situation: string;
    traditional: {
      steps: string[];
      pain: string;
      time: string;
    };
    withAutoAds: {
      steps: string[];
      benefit: string;
      time: string;
    };
  };
  gifPlaceholder: string;
  image?: string;
}

const scenarios: Scenario[] = [
  {
    id: "friday",
    icon: Clock,
    title: "周五接单，周一开跑",
    subtitle: "紧急Offer不再是噩梦",
    color: "text-blue-500",
    gradient: "from-blue-500 to-cyan-500",
    story: {
      situation: "周五晚上8点，老板发来新Offer，要求周一上广告",
      traditional: {
        steps: [
          "周五晚上：研究竞品广告 (3小时)",
          "周六：写广告文案 (5小时)",
          "周日：选关键词+测试 (4小时)",
          "周一：提心吊胆上线",
        ],
        pain: "整个周末泡汤，还不确定效果 😫",
        time: "12+ 小时",
      },
      withAutoAds: {
        steps: [
          "周五晚上：粘贴产品链接",
          "AI自动分析并生成广告",
          "10分钟后：广告已发布",
          "周六-周日：该玩玩该睡睡 ☕",
        ],
        benefit: "工作生活两不误，周一数据还不错！",
        time: "10 分钟",
      },
    },
    gifPlaceholder: "🌙 周五晚上悠闲操作演示",
    image: "/assets/marketing/scenario-new-product.jpg?v=2",
  },
  {
    id: "batch",
    icon: Package,
    title: "批量测试5个Offer",
    subtitle: "效率提升10倍",
    color: "text-purple-500",
    gradient: "from-purple-500 to-pink-500",
    story: {
      situation: "Media Buyer每天要测试大量Offer，快速找到爆款",
      traditional: {
        steps: [
          "逐个创建广告系列 (5个 × 2小时)",
          "分别研究关键词 (5个 × 1小时)",
          "手动跟进数据分析",
          "精力有限，只能跟3个Offer",
        ],
        pain: "效率低下，经常漏掉爆款机会 😰",
        time: "15+ 小时",
      },
      withAutoAds: {
        steps: [
          "批量导入5个Offer链接",
          "AI并行生成所有广告",
          "Dashboard统一监控数据",
          "同时跟进20+个Offer",
        ],
        benefit: "效率提升10倍，绝不漏掉爆款！",
        time: "30 分钟",
      },
    },
    gifPlaceholder: "📦 批量导入操作演示",
    image: "/assets/marketing/scenario-seasonal.png",
  },
  {
    id: "global",
    icon: Globe,
    title: "全球多国投放",
    subtitle: "翻译费归零",
    color: "text-emerald-500",
    gradient: "from-emerald-500 to-teal-500",
    story: {
      situation: "独立站要在美国、德国、日本同时投广告",
      traditional: {
        steps: [
          "找英文翻译：$300",
          "找德语翻译：$500",
          "找日语翻译：$700",
          "分别创建3国广告 (3 × 4小时)",
        ],
        pain: "时间长+成本高+效果不确定 💸",
        time: "12小时 + $1500",
      },
      withAutoAds: {
        steps: [
          "选择目标国家：美、德、日",
          "AI自动本地化文案",
          "一键发布3国广告",
          "Dashboard对比各国数据",
        ],
        benefit: "快速覆盖全球，翻译费$0！",
        time: "15 分钟 + $0",
      },
    },
    gifPlaceholder: "🌍 多国投放操作演示",
    image: "/assets/marketing/scenario-multi-language.jpg",
  },
];

function TimelineStep({
  step,
  index,
  isTraditional,
  isVisible,
}: {
  step: string;
  index: number;
  isTraditional: boolean;
  isVisible: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 transition-all duration-500 ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
        }`}
      style={{ transitionDelay: `${index * 150}ms` }}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isTraditional
          ? "bg-red-100 text-red-500"
          : "bg-emerald-100 text-emerald-500"
          }`}
      >
        {isTraditional ? (
          <span className="text-xs font-bold">{index + 1}</span>
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
      </div>
      <span
        className={`text-sm ${isTraditional ? "text-slate-600" : "text-slate-700"}`}
      >
        {step}
      </span>
    </div>
  );
}

function ScenarioContent({
  scenario,
  isVisible,
}: {
  scenario: Scenario;
  isVisible: boolean;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* 左侧：GIF占位 */}
      <div
        className={`aspect-video lg:aspect-square rounded-3xl bg-gradient-to-br ${scenario.gradient} flex items-center justify-center text-white shadow-xl transition-all duration-700 overflow-hidden relative ${isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
          }`}
      >
        {scenario.image ? (
          <img
            src={scenario.image}
            alt={scenario.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center p-8">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-6">
              <Play className="w-10 h-10" />
            </div>
            <p className="text-lg font-medium opacity-90">{scenario.gifPlaceholder}</p>
            <p className="text-sm opacity-70 mt-2">GIF/视频演示区域</p>
          </div>
        )}
      </div>

      {/* 右侧：故事对比 */}
      <div className="space-y-6">
        {/* 场景描述 */}
        <div
          className={`bg-slate-100 rounded-2xl p-4 transition-all duration-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
        >
          <div className="flex items-center gap-2 text-slate-600 mb-2">
            <scenario.icon className={`w-5 h-5 ${scenario.color}`} />
            <span className="text-sm font-medium">场景背景</span>
          </div>
          <p className="text-slate-800">{scenario.story.situation}</p>
        </div>

        {/* 对比卡片 */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* 传统方式 */}
          <div
            className={`bg-red-50 rounded-2xl p-5 border border-red-100 transition-all duration-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            style={{ transitionDelay: "200ms" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Moon className="w-5 h-5 text-red-500" />
              <span className="font-semibold text-red-700">😰 传统方式</span>
            </div>

            <div className="space-y-2 mb-4">
              {scenario.story.traditional.steps.map((step, index) => (
                <TimelineStep
                  key={index}
                  step={step}
                  index={index}
                  isTraditional={true}
                  isVisible={isVisible}
                />
              ))}
            </div>

            <div className="pt-4 border-t border-red-200">
              <div className="text-xs text-red-500 mb-1">耗时</div>
              <div className="text-lg font-bold text-red-700">
                {scenario.story.traditional.time}
              </div>
              <p className="text-sm text-red-600 mt-2">
                {scenario.story.traditional.pain}
              </p>
            </div>
          </div>

          {/* 用 AutoAds */}
          <div
            className={`bg-emerald-50 rounded-2xl p-5 border border-emerald-100 transition-all duration-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            style={{ transitionDelay: "400ms" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-emerald-500" />
              <span className="font-semibold text-emerald-700">🚀 用 AutoAds</span>
            </div>

            <div className="space-y-2 mb-4">
              {scenario.story.withAutoAds.steps.map((step, index) => (
                <TimelineStep
                  key={index}
                  step={step}
                  index={index}
                  isTraditional={false}
                  isVisible={isVisible}
                />
              ))}
            </div>

            <div className="pt-4 border-t border-emerald-200">
              <div className="text-xs text-emerald-500 mb-1">耗时</div>
              <div className="text-lg font-bold text-emerald-700">
                {scenario.story.withAutoAds.time}
              </div>
              <p className="text-sm text-emerald-600 mt-2">
                {scenario.story.withAutoAds.benefit}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          className={`transition-all duration-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "600ms" }}
        >
          <a
            href="/login"
            className={`inline-flex items-center px-6 py-3 bg-gradient-to-r ${scenario.gradient} text-white font-semibold rounded-full hover:shadow-lg transition-all duration-300 hover:-translate-y-1`}
          >
            立即体验这个场景
            <ArrowRight className="w-5 h-5 ml-2" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function ScenarioTabs() {
  const [activeTab, setActiveTab] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.2 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  // 自动切换Tab
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(() => {
      setActiveTab((prev) => (prev + 1) % scenarios.length);
    }, 8000);

    return () => clearInterval(interval);
  }, [isVisible]);

  return (
    <section ref={ref} className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            3个真实场景，看 AutoAds 如何帮你赚钱
          </h2>
          <p className="text-xl text-slate-600">
            选择你的场景，体验效率革命
          </p>
        </div>

        {/* Tab 切换 */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {scenarios.map((scenario, index) => (
            <button
              key={scenario.id}
              onClick={() => setActiveTab(index)}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-medium transition-all duration-300 ${activeTab === index
                ? `bg-gradient-to-r ${scenario.gradient} text-white shadow-lg`
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              <scenario.icon className="w-5 h-5" />
              <span className="hidden sm:inline">{scenario.title}</span>
              <span className="sm:hidden">{scenario.title.split("，")[0]}</span>
            </button>
          ))}
        </div>

        {/* 进度指示器 */}
        <div className="flex justify-center gap-2 mb-8">
          {scenarios.map((_, index) => (
            <div
              key={index}
              className={`h-1 rounded-full transition-all duration-300 ${index === activeTab ? "w-8 bg-slate-900" : "w-2 bg-slate-300"
                }`}
            />
          ))}
        </div>

        {/* 场景内容 */}
        <div className="max-w-6xl mx-auto">
          <ScenarioContent
            key={activeTab}
            scenario={scenarios[activeTab]}
            isVisible={isVisible}
          />
        </div>
      </div>
    </section>
  );
}
