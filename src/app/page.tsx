import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  Link2,
  MessageSquare,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";

import { ConsultCustomerDialogTrigger } from "@/components/marketing/ConsultCustomerDialogTrigger";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { WorkflowTimeline } from "@/components/marketing/WorkflowTimeline";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata.home;

type IconType = typeof Wand2;

type EvidenceStat = {
  value: string;
  label: string;
  note: string;
};

type ComparisonRow = {
  metric: string;
  traditional: string;
  autoads: string;
  delta: string;
  traditionalWidth: number;
  autoadsWidth: number;
};

type AudiencePath = {
  title: string;
  subtitle: string;
  icon: IconType;
  highlights: string[];
  result: string;
};

type CapabilityCard = {
  title: string;
  summary: string;
  icon: IconType;
  bullets: string[];
  metric: string;
};

type OperationsCard = {
  title: string;
  description: string;
  icon: IconType;
  points: string[];
  badge: string;
};

type Testimonial = {
  content: string;
  author: string;
  role: string;
  avatar: string;
  result: string;
};

type PricingPlan = {
  title: string;
  subtitle: string;
  price: string;
  unit: string;
  features: string[];
  highlight?: boolean;
};

type FaqItem = {
  q: string;
  a: string;
};

const heroSignals = [
  "先咨询开通试用账号，再登录",
  "不会投也能当天上线",
  "卡在配置页也有中文引导",
  "多 Offer 不再手工重复建组",
];

const evidenceStats: EvidenceStat[] = [
  { value: "10分钟", label: "从链接到首轮发布", note: "建组、生成、关联、发布一轮跑完" },
  { value: "75%", label: "冷启动测试成本下降", note: "少烧预算，少走无效试错" },
  { value: "40%", label: "ROI 典型提升", note: "更快进入盈利优化循环" },
  { value: "1000+", label: "活跃投手持续使用", note: "从个人投手到团队都在用" },
];

const comparisonRows: ComparisonRow[] = [
  {
    metric: "创建一组可投放广告",
    traditional: "3-5天",
    autoads: "10分钟",
    delta: "效率提升 99%",
    traditionalWidth: 92,
    autoadsWidth: 18,
  },
  {
    metric: "冷启动测试预算",
    traditional: "$400",
    autoads: "$100",
    delta: "成本下降 75%",
    traditionalWidth: 86,
    autoadsWidth: 34,
  },
  {
    metric: "ROI 优化周期",
    traditional: "2-3周",
    autoads: "3-5天",
    delta: "迭代提速 60%+",
    traditionalWidth: 82,
    autoadsWidth: 44,
  },
  {
    metric: "广告通过率稳定性",
    traditional: "波动较大",
    autoads: "更稳定",
    delta: "素材质量更可控",
    traditionalWidth: 54,
    autoadsWidth: 78,
  },
];

const audiencePaths: AudiencePath[] = [
  {
    title: "新手路径",
    subtitle: "从不会投放到稳定上线",
    icon: Users,
    highlights: [
      "粘贴链接即可生成可测试广告文案与关键词",
      "默认参数直接可发，不再卡在配置页",
      "按步骤提示执行，不会 Google Ads 也能跑通",
    ],
    result: "当天完成首轮上线，先拿到第一批可优化数据。",
  },
  {
    title: "专业投手路径",
    subtitle: "从单点优化到规模化推进",
    icon: Target,
    highlights: [
      "多 Offer 批量推进，不再来回切页面",
      "关键词和创意联动迭代，少做重复手工",
      "链接变更与异常流量自动提醒，少熬夜盯盘",
    ],
    result: "把时间留给高 ROI 机会，不再被重复执行拖住。",
  },
];

const capabilityCards: CapabilityCard[] = [
  {
    title: "AI 创意引擎",
    summary: "不再从空白文档开始写广告。",
    icon: Wand2,
    bullets: ["标题 / 描述一体生成", "关键词分层与优先级建议", "多语言本地化适配"],
    metric: "15+ 标题 · 4+ 描述 · 20+ 关键词",
  },
  {
    title: "自动换链接",
    summary: "链接一变自动同步，避免佣金白跑。",
    icon: Link2,
    bullets: ["7×24 变更监测", "Google Ads 配置自动同步", "异常重试与暂停机制"],
    metric: "最快 5 分钟检测间隔",
  },
  {
    title: "补点击风控协同",
    summary: "异常流量更早识别，减少预算空耗。",
    icon: Gauge,
    bullets: ["异常分布可视化", "任务状态实时追踪", "可回溯执行记录"],
    metric: "风控巡检时间显著下降",
  },
  {
    title: "增长数据看板",
    summary: "不再凭感觉优化，数据直接指路。",
    icon: BarChart3,
    bullets: ["投放前后效果对比", "关键指标分层监控", "优化建议可执行化"],
    metric: "更快定位高潜力广告组",
  },
];

const operationsCards: OperationsCard[] = [
  {
    title: "链接稳定性保障",
    description: "联盟链接一变就自动更新，避免广告在跑、佣金丢失。",
    icon: Link2,
    points: ["链接变化自动检测", "多地区校验，减少失效跳转", "异常自动重试并告警"],
    badge: "自动追踪 · 自动更新 · 自动兜底",
  },
  {
    title: "测试期流量协同",
    description: "冷启动可配置补点击策略，让首批有效信号更快到位。",
    icon: TrendingUp,
    points: ["频率与周期可配置，避免过补", "全局状态一屏可见，少盯盘", "策略记录可追溯，复盘不扯皮"],
    badge: "冷启动更稳 · 决策更快",
  },
];

const testimonials: Testimonial[] = [
  {
    content:
      "以前周五接到紧急 Offer 基本要牺牲周末。现在 10 分钟就能拉起第一版广告，周一直接看数据。",
    author: "Alex Chen",
    role: "Media Buyer",
    avatar: "/assets/marketing/avatar-1.png",
    result: "首发效率提升 99%",
  },
  {
    content:
      "批量导入和统一监控非常关键。我现在能同时推进的 Offer 数量，比过去至少高一个量级。",
    author: "Sarah Li",
    role: "独立站运营",
    avatar: "/assets/marketing/avatar-2.png",
    result: "并行管理能力 10x",
  },
  {
    content:
      "我不是 Google Ads 专家，但系统把复杂步骤拆得很清楚，出稿质量和通过率都比手写更稳定。",
    author: "Mike Wang",
    role: "新手投手",
    avatar: "/assets/marketing/avatar-3.png",
    result: "通过率持续稳定",
  },
];

const pricingPlans: PricingPlan[] = [
  {
    title: "年度会员",
    subtitle: "适合快速起量与稳步学习",
    price: "¥6,999",
    unit: "/年",
    features: ["12个月使用权", "完整功能访问", "AI创意与关键词能力", "标准支持服务"],
  },
  {
    title: "长期会员",
    subtitle: "适合持续规模化投放",
    price: "¥11,999",
    unit: "/一次性",
    highlight: true,
    features: ["长期使用权", "完整功能访问", "优先功能更新", "高优先级支持"],
  },
  {
    title: "私有化部署",
    subtitle: "适合团队协作与数据隔离",
    price: "¥34,999",
    unit: "/授权",
    features: ["私有化部署", "1年技术支持", "可定制能力扩展", "数据完全私有"],
  },
];

const faqItems: FaqItem[] = [
  {
    q: "我完全不懂 Google Ads，能直接上手吗？",
    a: "可以。你可以按“链接输入 → AI 生成 → 账号关联 → 发布”流程直接启动，默认参数即可跑通第一轮测试。",
  },
  {
    q: "咨询和试用有什么区别？",
    a: "咨询用于确认方案并开通试用账号；试用是账号开通后登录系统体验完整流程。也就是先咨询开通，再登录试用。",
  },
  {
    q: "价格方案会影响核心功能吗？",
    a: "不会。核心能力一致，差异主要在使用周期、支持优先级和部署形态。",
  },
  {
    q: "从上线到看到第一轮结果通常多久？",
    a: "多数团队当天即可完成首轮发布，通常 3-5 天内就能获得可用于优化的第一批关键数据。",
  },
];

export default function MarketingHome() {
  return (
    <div className="marketing-shell min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-slate-900">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/92 backdrop-blur">
        <div className="mx-auto flex h-[4.5rem] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2" aria-label="AutoAds 首页">
            <Image src="/logo.svg" alt="AutoAds" width={124} height={34} className="h-8 w-auto" priority />
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="首页导航">
            <a href="#proof" className="text-base font-medium text-slate-700 transition-colors hover:text-blue-700">
              增长证据
            </a>
            <a href="#audience" className="text-base font-medium text-slate-700 transition-colors hover:text-blue-700">
              适用人群
            </a>
            <a href="#workflow" className="text-base font-medium text-slate-700 transition-colors hover:text-blue-700">
              上手流程
            </a>
            <a href="#features" className="text-base font-medium text-slate-700 transition-colors hover:text-blue-700">
              核心能力
            </a>
            <a href="#pricing" className="text-base font-medium text-slate-700 transition-colors hover:text-blue-700">
              价格方案
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <ConsultCustomerDialogTrigger className="inline-flex items-center justify-center rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-orange-600/30 transition hover:bg-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 sm:text-base">
              预约咨询
            </ConsultCustomerDialogTrigger>
            <Link
              href="/login"
              className="hidden items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-blue-400 hover:text-blue-700 sm:inline-flex sm:text-base"
            >
              账号登录
            </Link>
          </div>
        </div>
      </header>

      <main className="overflow-x-clip pb-24 pt-[4.5rem] md:pb-0">
        <section className="relative border-b border-slate-200/80 bg-[radial-gradient(circle_at_15%_0%,rgba(37,99,235,0.16),transparent_42%),radial-gradient(circle_at_85%_0%,rgba(249,115,22,0.14),transparent_38%),linear-gradient(to_bottom,#ffffff,#f8fafc)]">
	          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.06fr,0.94fr] lg:gap-14 lg:px-8 lg:py-20">
	            <div className="max-w-2xl">
		              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-semibold text-blue-700">
		                <ShieldCheck className="h-3.5 w-3.5" />
		                AutoAds 2.0 全新发布
		              </div>

			              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
			                <span className="block">
			                  <span className="text-blue-700">10分钟</span>搞定
			                </span>
			                <span className="block">Google Ads 投放</span>
			              </h1>

	              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">
	                别再熬夜写广告、别再盲测烧预算、别再卡在复杂配置。首轮上线更快，试错成本更低。
	              </p>

		              <p className="mt-4 inline-flex items-center rounded-full border border-blue-300 bg-gradient-to-r from-blue-50 via-white to-blue-50 px-4 py-2 text-base font-bold tracking-tight text-blue-800 shadow-sm shadow-blue-900/5">
		                粘贴链接 → AI生成 → 一键发布
		              </p>

	              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
	                <ConsultCustomerDialogTrigger className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-orange-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-600/30 transition hover:-translate-y-0.5 hover:bg-orange-500 motion-reduce:transform-none sm:w-auto">
	                  预约咨询
	                  <MessageSquare className="h-4 w-4" />
	                </ConsultCustomerDialogTrigger>
	                <Link
	                  href="/login"
	                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-900 transition hover:border-blue-400 hover:text-blue-700 sm:w-auto"
	                >
	                  账号登录
	                  <ArrowRight className="h-4 w-4" />
	                </Link>
	              </div>

	              <div className="mt-7 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
	                {heroSignals.map((item) => (
	                  <p key={item} className="inline-flex items-start gap-2">
	                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
	                    <span>{item}</span>
	                  </p>
	                ))}
	              </div>

	            </div>

	            <div className="relative mx-auto w-full max-w-[640px] lg:max-w-none">
	              <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
	                <div className="relative aspect-[16/11] lg:h-[430px] lg:aspect-auto">
	                  <Image
	                    src="/assets/marketing/hero-demo.png"
	                    alt="AutoAds 首页产品演示"
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 48vw"
                    priority
                  />
	                </div>
	              </div>

			              <div className="hero-tag-float absolute right-0 top-8 hidden rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/10 sm:block lg:-right-6">
			                <div className="flex items-center gap-3">
			                  <div className="rounded-full bg-emerald-100 p-2 text-emerald-600">
			                    <CheckCircle2 className="h-4 w-4" />
			                  </div>
			                  <div>
			                    <div className="text-xl font-bold text-slate-900">15个标题</div>
			                    <div className="text-sm font-semibold text-slate-500">已生成</div>
			                  </div>
			                </div>
			              </div>

			              <div className="hero-tag-float hero-tag-float-delay absolute -left-1 top-[42%] hidden rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/10 sm:block lg:-left-5">
			                <div className="flex items-center gap-3">
			                  <div className="rounded-full bg-blue-100 p-2 text-blue-600">
			                    <Target className="h-4 w-4" />
			                  </div>
			                  <div>
			                    <div className="text-xl font-bold text-slate-900">20+ 关键词</div>
			                    <div className="text-sm font-semibold text-slate-500">智能推荐</div>
			                  </div>
			                </div>
			              </div>

			              <div className="hero-tag-float hero-tag-float-delay-2 absolute bottom-4 right-2 hidden rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/10 sm:block lg:right-2">
			                <div className="flex items-center gap-3">
			                  <div className="rounded-full bg-violet-100 p-2 text-violet-600">
			                    <Wand2 className="h-4 w-4" />
			                  </div>
			                  <div>
			                    <div className="text-xl font-bold text-slate-900">4个描述文案</div>
			                    <div className="text-sm font-semibold text-violet-600">AI 生成中...</div>
			                  </div>
			                </div>
			              </div>
	            </div>
          </div>
        </section>

        <section id="proof" className="border-b border-slate-200 bg-white py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">增长证据一眼看懂：更快、更省、更稳</h2>
              <p className="mt-4 text-lg text-slate-600">
                每一分钱花在哪、为什么涨跌，一眼看清。该停就停，该加就加。
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {evidenceStats.map((item) => (
                <article key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="font-display text-3xl font-bold text-slate-950">{item.value}</p>
                  <p className="mt-2 text-base font-semibold text-slate-800">{item.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.note}</p>
                </article>
              ))}
            </div>

            <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="grid gap-4 pb-4 text-sm font-semibold text-slate-600 lg:grid-cols-[1.6fr,1fr,1fr,auto]">
                <div>关键指标</div>
                <div>传统方式</div>
                <div>使用 AutoAds</div>
                <div className="lg:text-right">变化</div>
              </div>

              {comparisonRows.map((row) => (
                <article key={row.metric} className="grid gap-4 border-t border-slate-200 py-5 lg:grid-cols-[1.6fr,1fr,1fr,auto] lg:items-center">
                  <div className="text-base font-semibold text-slate-900">{row.metric}</div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>传统方式</span>
                      <span className="text-slate-700">{row.traditional}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-400" style={{ width: `${row.traditionalWidth}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-blue-700">
                      <span>使用 AutoAds</span>
                      <span className="text-blue-800">{row.autoads}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-blue-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${row.autoadsWidth}%` }} />
                    </div>
                  </div>

                  <div className="lg:text-right">
                    <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">{row.delta}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="audience" className="border-b border-slate-200 bg-slate-50 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">新手能跑通，专业投手能放量</h2>
              <p className="mt-4 text-lg text-slate-600">不会投先跑通，会投放就放量。</p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {audiencePaths.map((path) => (
                <article key={path.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-semibold text-slate-950">{path.title}</h3>
                      <p className="mt-1 text-base text-slate-600">{path.subtitle}</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
                      <path.icon className="h-5 w-5" />
                    </div>
                  </div>

                  <ul className="mt-5 space-y-3">
                    {path.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-base text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-base font-medium text-blue-900">{path.result}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div id="workflow" className="border-b border-slate-200 bg-white">
          <WorkflowTimeline />
        </div>

        <section id="features" className="border-b border-slate-200 bg-slate-50 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">核心能力，一套打通</h2>
              <p className="mt-4 text-lg text-slate-600">少切系统、少做重复动作，把时间留给 ROI。</p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {capabilityCards.map((card) => (
                <article key={card.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-950">{card.title}</h3>
                      <p className="mt-2 text-base text-slate-600">{card.summary}</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
                      <card.icon className="h-5 w-5" />
                    </div>
                  </div>

                  <ul className="mt-5 space-y-2.5">
                    {card.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2 text-sm text-slate-700">
                        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-5 inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">{card.metric}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {operationsCards.map((card) => (
                <article key={card.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
                      <card.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-slate-950">{card.title}</h3>
                      <p className="mt-2 text-base text-slate-600">{card.description}</p>
                    </div>
                  </div>

                  <ul className="mt-5 space-y-2.5">
                    {card.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-5 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{card.badge}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="testimonials" className="border-b border-slate-200 bg-white py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <div className="mx-auto mb-10 max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">来自一线投手的实战反馈</h2>
              <p className="mt-4 text-lg text-slate-600">他们选 AutoAds，不是因为花哨，而是因为结果来得更快。</p>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {testimonials.map((item) => (
                <article key={item.author} className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <div className="mb-3 flex items-center gap-1 text-orange-500">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                  <p className="text-base leading-relaxed text-slate-700">“{item.content}”</p>
                  <p className="mt-4 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{item.result}</p>

                  <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-4">
                    <Image src={item.avatar} alt={item.author} width={44} height={44} className="h-11 w-11 rounded-full border border-slate-200 object-cover" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.author}</p>
                      <p className="text-xs text-slate-500">{item.role}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-b border-slate-200 bg-slate-50 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <div className="mx-auto mb-10 max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">透明定价，按增长阶段选方案</h2>
              <p className="mt-4 text-lg text-slate-600">先把首轮跑通，再按扩量节奏选方案。长期会员更省心。</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.title}
                  className={`rounded-3xl border p-6 shadow-sm ${
                    plan.highlight
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-xl font-semibold">{plan.title}</h3>
                    {plan.highlight ? (
                      <span className="inline-flex rounded-full bg-orange-500 px-2.5 py-1 text-xs font-bold text-white shadow-sm shadow-orange-900/30">
                        强烈推荐
                      </span>
                    ) : null}
                  </div>
                  <p className={`mt-1 text-base ${plan.highlight ? "text-slate-300" : "text-slate-600"}`}>{plan.subtitle}</p>

                  <div className="mt-5 flex items-end gap-1">
                    <span className="font-display text-4xl font-bold leading-none">{plan.price}</span>
                    <span className={`text-sm ${plan.highlight ? "text-slate-300" : "text-slate-500"}`}>{plan.unit}</span>
                  </div>

                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? "text-blue-300" : "text-blue-700"}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-7 grid gap-2">
                    <ConsultCustomerDialogTrigger
                      className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                        plan.highlight
                          ? "bg-orange-500 text-white hover:bg-orange-400"
                          : "bg-orange-600 text-white hover:bg-orange-500"
                      }`}
                    >
                      预约咨询
                    </ConsultCustomerDialogTrigger>
                    <Link
                      href="/login"
                      className={`inline-flex w-full items-center justify-center rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                        plan.highlight
                          ? "border-slate-500 text-slate-100 hover:border-slate-300"
                          : "border-slate-300 text-slate-900 hover:border-blue-400 hover:text-blue-700"
                      }`}
                    >
                      账号登录
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="border-b border-slate-200 bg-white py-16 sm:py-20">
	          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
	            <h2 className="text-center font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">常见问题</h2>
	            <div className="mx-auto mt-8 max-w-4xl space-y-3">
              {faqItems.map((item) => (
                <details key={item.q} className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition open:border-blue-200 open:bg-blue-50/50">
                  <summary className="cursor-pointer list-none text-lg font-semibold leading-relaxed text-slate-900">{item.q}</summary>
                  <p className="mt-3 text-base leading-relaxed text-slate-700">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-slate-950 py-16 sm:py-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.28),transparent_40%),radial-gradient(circle_at_80%_100%,rgba(249,115,22,0.22),transparent_35%)]" />
          <div className="relative mx-auto w-full max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">下一轮增长，不必再靠熬夜换结果</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-300">
              不确定怎么开始就先咨询；开通试用账号后登录，今天就能上线首轮。
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ConsultCustomerDialogTrigger className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-orange-400">
                预约咨询
                <MessageSquare className="h-4 w-4" />
              </ConsultCustomerDialogTrigger>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-slate-500 px-6 py-3 text-base font-semibold text-white transition hover:border-slate-300"
              >
                账号登录
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-2">
          <ConsultCustomerDialogTrigger className="inline-flex w-full items-center justify-center rounded-full bg-orange-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm shadow-orange-600/30 transition hover:bg-orange-500">
            预约咨询
          </ConsultCustomerDialogTrigger>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-base font-semibold text-slate-900 transition hover:border-blue-400 hover:text-blue-700"
          >
            账号登录
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
