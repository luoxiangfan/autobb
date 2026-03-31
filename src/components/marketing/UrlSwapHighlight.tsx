"use client";

import { CheckCircle2, Link2, Clock, Shield, Zap, RefreshCw, AlertCircle, TrendingUp, Globe, Target } from "lucide-react";

export function UrlSwapHighlight() {
  return (
    <section id="url-swap" className="py-24 bg-gradient-to-b from-white to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50/50 backdrop-blur-sm px-3 py-1 text-sm font-medium text-blue-700 mb-6">
            <span className="flex h-2 w-2 rounded-full bg-blue-600 mr-2 animate-pulse"></span>
            智能换链接引擎
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            告别联盟佣金丢失
            <br />
            <span className="text-blue-600">自动追踪并更新推广链接</span>
          </h2>
          <p className="text-xl text-slate-600 mt-6">
            当联盟平台更换推广链接时，系统自动检测并更新Google Ads配置，确保佣金归属永不掉线
          </p>
        </div>

        {/* 3列功能卡片 */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          {[
            {
              icon: Link2,
              title: "自动链接追踪",
              description: "7×24小时监控推广链接变化，发现变更立即响应，无需人工盯盘",
              features: ["智能变化检测", "实时状态监控", "多维度验证"]
            },
            {
              icon: RefreshCw,
              title: "自动更新配置",
              description: "检测到链接变化后，自动通过Google Ads API更新Campaign配置",
              features: ["API自动对接", "批量统一更新", "变更记录追溯"]
            },
            {
              icon: Shield,
              title: "异常自动处理",
              description: "连续失败自动暂停，智能重试机制，避免无效执行和资源浪费",
              features: ["3次失败暂停", "自动错误恢复", "风险预警通知"]
            }
          ].map((item, idx) => (
            <div
              key={idx}
              className="group bg-white p-8 rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-blue-50 group-hover:from-blue-200 group-hover:to-blue-100 transition-all mb-4">
                <item.icon className="w-6 h-6 text-blue-600" />
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
                    <CheckCircle2 className="w-4 h-4 text-blue-600 mr-3 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 价值场景 - 左右布局 */}
        <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-3xl p-12 border border-blue-100 mb-16">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* 左侧：问题 */}
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">
                手动换链接的痛点
              </h3>
              <div className="space-y-4">
                {[
                  {
                    icon: AlertCircle,
                    problem: "联盟链接突然更换",
                    impact: "忘记更新 → 佣金丢失 → 订单归零"
                  },
                  {
                    icon: Clock,
                    problem: "人工检查太麻烦",
                    impact: "每天盯盘 → 浪费时间 → 影响效率"
                  },
                  {
                    icon: TrendingUp,
                    problem: "促销期间链接频繁变",
                    impact: "手动更新 → 容易遗漏 → 损失惨重"
                  }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex gap-4 p-4 bg-white rounded-xl border border-red-100"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 flex-shrink-0">
                      <item.icon className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 mb-1">{item.problem}</div>
                      <div className="text-sm text-red-600">{item.impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：解决方案 */}
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">
                自动换链接的优势
              </h3>
              <div className="space-y-4">
                {[
                  {
                    icon: Zap,
                    solution: "5分钟快速检测",
                    benefit: "链接变更后5分钟内发现并更新，佣金归属零丢失"
                  },
                  {
                    icon: Globe,
                    solution: "全球代理验证",
                    benefit: "多地区代理验证链接有效性，排除缓存干扰"
                  },
                  {
                    icon: Target,
                    solution: "灵活配置策略",
                    benefit: "支持5分钟-24小时检查间隔，可设置持续运行天数"
                  }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex gap-4 p-4 bg-white rounded-xl border border-blue-100"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 flex-shrink-0">
                      <item.icon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 mb-1">{item.solution}</div>
                      <div className="text-sm text-blue-600">{item.benefit}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 核心指标 */}
        <div className="grid md:grid-cols-4 gap-6">
          {[
            {
              label: "检测频率",
              value: "5分钟",
              description: "最快检测间隔"
            },
            {
              label: "自动更新",
              value: "100%",
              description: "API自动对接"
            },
            {
              label: "佣金保障",
              value: "99.9%",
              description: "变更零遗漏"
            },
            {
              label: "异常处理",
              value: "智能",
              description: "自动暂停恢复"
            }
          ].map((stat, idx) => (
            <div
              key={idx}
              className="text-center p-6 bg-white rounded-xl border border-slate-200 hover:shadow-lg transition-all"
            >
              <div className="text-3xl font-bold text-blue-600 mb-2">
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
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-blue-600/40 hover:-translate-y-0.5 transition-all"
            >
              开始配置换链接
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
