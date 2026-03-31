import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { Target, Zap, Users, TrendingUp } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.about;

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <MarketingHeader />

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">
              关于 AutoAds
            </h1>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              我们致力于让 Google Ads 投放变得简单、高效、智能
            </p>
          </div>

          {/* Mission */}
          <section className="mb-16">
            <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">我们的使命</h2>
              <p className="text-lg text-slate-600 leading-relaxed mb-6">
                AutoAds 诞生于一个简单的想法：<span className="font-semibold text-slate-900">让每一位 Affiliate Marketer 都能轻松驾驭 Google Ads</span>。
              </p>
              <p className="text-lg text-slate-600 leading-relaxed mb-6">
                我们深知，传统的广告投放流程繁琐、耗时，需要大量的专业知识和经验。
                很多优秀的产品因为缺乏有效的推广而被埋没，很多有潜力的营销人员因为技术门槛而望而却步。
              </p>
              <p className="text-lg text-slate-600 leading-relaxed">
                AutoAds 的目标是打破这些壁垒，通过 AI 技术和自动化流程，
                让广告投放从"技术活"变成"简单事"，让每一分预算都能发挥最大价值。
              </p>
            </div>
          </section>

          {/* Values */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">核心价值观</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                {
                  icon: Target,
                  title: "效率至上",
                  description: "我们相信时间是最宝贵的资源。AutoAds 将原本需要数小时的工作压缩到10分钟内完成。",
                  color: "blue"
                },
                {
                  icon: Zap,
                  title: "智能驱动",
                  description: "利用最先进的 AI 技术，自动生成高质量广告文案，智能优化投放策略。",
                  color: "purple"
                },
                {
                  icon: Users,
                  title: "用户为本",
                  description: "每一个功能的设计都以用户需求为出发点，追求极致的使用体验。",
                  color: "emerald"
                },
                {
                  icon: TrendingUp,
                  title: "持续创新",
                  description: "紧跟行业趋势，不断迭代产品，为用户提供最前沿的营销工具。",
                  color: "orange"
                }
              ].map((value, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                >
                  <div className={`w-12 h-12 rounded-xl bg-${value.color}-100 flex items-center justify-center mb-4`}>
                    <value.icon className={`w-6 h-6 text-${value.color}-600`} />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{value.title}</h3>
                  <p className="text-slate-600">{value.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Team */}
          <section className="mb-16">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-8 md:p-12 text-white">
              <h2 className="text-2xl font-bold mb-6">我们的团队</h2>
              <p className="text-lg text-slate-300 leading-relaxed mb-6">
                AutoAds 团队由一群热爱技术、深耕数字营销领域的专业人士组成。
                我们拥有丰富的 Google Ads 投放经验和 AI 技术背景，
                深刻理解 Affiliate Marketer 的痛点和需求。
              </p>
              <p className="text-lg text-slate-300 leading-relaxed">
                我们不仅是产品的开发者，更是产品的使用者。
                我们用自己的实战经验打磨每一个功能，确保 AutoAds 真正解决实际问题。
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">准备好开始了吗？</h2>
            <p className="text-slate-600 mb-8">加入 1000+ 专业玩家，体验 AI 驱动的广告投放</p>
            <Link
              href="/login"
              className="inline-flex items-center px-8 py-4 bg-slate-900 text-white text-lg font-semibold rounded-full hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              免费试用
            </Link>
          </section>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
