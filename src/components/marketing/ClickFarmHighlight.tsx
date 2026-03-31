"use client";

import { CheckCircle2, Zap, Globe, BarChart3, Wand2, Target, TrendingUp, Shield } from "lucide-react";

export function ClickFarmHighlight() {
  return (
    <section className="py-24 bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center rounded-full border border-purple-100 bg-purple-50/50 backdrop-blur-sm px-3 py-1 text-sm font-medium text-purple-700 mb-6">
            <span className="flex h-2 w-2 rounded-full bg-purple-600 mr-2 animate-pulse"></span>
            自动化补点击引擎
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            为新offer和新campaign提供
            <br />
            <span className="text-purple-600">初期流量保障</span>
          </h2>
          <p className="text-xl text-slate-600 mt-6">
            配置一次，系统自动每天执行。全自动、全天候、全球覆盖。
          </p>
        </div>

        {/* 3列功能卡片 */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          {[
            {
              icon: Zap,
              title: "全自动执行",
              description: "配置一次，系统自动每天执行。无需手动干预，24/7持续运行",
              features: ["24小时自动运行", "智能重试机制", "异常自动告警"]
            },
            {
              icon: Globe,
              title: "全球覆盖",
              description: "100+国家代理支持，模拟真实全球流量分布",
              features: ["全球代理池", "多时区支持", "反作弊优化"]
            },
            {
              icon: BarChart3,
              title: "可视化统计",
              description: "实时查看每日补点击效果和成功率，数据一目了然",
              features: ["日报表统计", "趋势分析", "成功率监控"]
            }
          ].map((item, idx) => (
            <div
              key={idx}
              className="group bg-white p-8 rounded-2xl border border-slate-200 hover:border-purple-300 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-100 to-purple-50 group-hover:from-purple-200 group-hover:to-purple-100 transition-all mb-4">
                <item.icon className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {item.title}
              </h3>
              <p className="text-slate-600 mb-6">
                {item.description}
              </p>
              <ul className="space-y-3">
                {item.features.map(feature => (
                  <li key={feature} className="flex items-center text-sm text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-purple-600 mr-3 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 场景示例 - 2x2网格 */}
        <div className="bg-gradient-to-br from-purple-50 to-slate-50 rounded-3xl p-12 border border-purple-100">
          <h3 className="text-2xl font-bold text-slate-900 mb-8">
            应用场景
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                icon: Wand2,
                scenario: "新offer刚上线",
                benefit: "立即获得初期流量和数据积累，加速优化反馈周期"
              },
              {
                icon: Target,
                scenario: "新campaign测试",
                benefit: "安全的自动化测试环境，无需手动操作和风险"
              },
              {
                icon: TrendingUp,
                scenario: "持续流量补充",
                benefit: "保持offer活跃度，维持稳定的排名和权重"
              },
              {
                icon: Shield,
                scenario: "反作弊防护",
                benefit: "真实代理、随机时间、全球分散，规避平台风控"
              }
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex gap-4 p-6 bg-white rounded-xl border border-slate-100 hover:border-purple-200 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-100 flex-shrink-0">
                  <item.icon className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900 mb-1">{item.scenario}</div>
                  <div className="text-sm text-slate-600">{item.benefit}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 核心指标 */}
        <div className="mt-16 grid md:grid-cols-4 gap-6">
          {[
            {
              label: "自动化",
              value: "100%",
              description: "零人工干预"
            },
            {
              label: "全天候",
              value: "24/7",
              description: "不间断执行"
            },
            {
              label: "全球覆盖",
              value: "100+",
              description: "国家代理"
            },
            {
              label: "成功率",
              value: "95%+",
              description: "行业标准"
            }
          ].map((stat, idx) => (
            <div
              key={idx}
              className="text-center p-6 bg-white rounded-xl border border-slate-200 hover:shadow-lg transition-all"
            >
              <div className="text-3xl font-bold text-purple-600 mb-2">
                {stat.value}
              </div>
              <div className="font-semibold text-slate-900 text-sm">
                {stat.label}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {stat.description}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <div className="inline-flex flex-col sm:flex-row gap-4">
            <a
              href="/login"
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-600/40 hover:-translate-y-0.5 transition-all"
            >
              开始配置补点击
            </a>
            <a
              href="#pricing"
              className="px-8 py-4 border-2 border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-all"
            >
              查看套餐价格
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
