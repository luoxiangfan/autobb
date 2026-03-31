import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.terms;

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <MarketingHeader />

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">
              服务条款
            </h1>
            <p className="text-slate-600">
              最后更新日期：2025年1月1日
            </p>
          </div>

          {/* Content */}
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-slate-200">
            <div className="prose prose-slate max-w-none">
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">1. 服务协议</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  欢迎使用 AutoAds（以下简称"本服务"）。本服务条款（以下简称"本条款"）是您与 AutoAds 之间关于使用本服务的法律协议。
                </p>
                <p className="text-slate-600 leading-relaxed">
                  使用本服务即表示您已阅读、理解并同意接受本条款的约束。如果您不同意本条款的任何部分，请勿使用本服务。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">2. 服务描述</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  AutoAds 是一个 Google Ads 自动化投放平台，提供以下服务：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>AI 驱动的广告文案生成</li>
                  <li>关键词研究和推荐</li>
                  <li>广告系列创建和管理</li>
                  <li>投放数据分析和优化建议</li>
                  <li>批量 Offer 管理</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">3. 账户注册</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  使用本服务需要注册账户。您在注册时需要：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>提供真实、准确、完整的注册信息</li>
                  <li>妥善保管您的账户密码</li>
                  <li>对账户下的所有活动负责</li>
                  <li>发现账户被盗用时立即通知我们</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">4. 使用规范</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  使用本服务时，您同意不会：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>违反任何适用的法律法规</li>
                  <li>侵犯他人的知识产权或其他合法权益</li>
                  <li>发布虚假、误导性或欺诈性的广告内容</li>
                  <li>推广违禁产品或服务</li>
                  <li>干扰或破坏本服务的正常运行</li>
                  <li>未经授权访问本服务的系统或数据</li>
                  <li>转售、转让或分享您的账户</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">5. 付费服务</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  本服务提供多种付费方案：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li><strong>年度会员</strong>：¥5,999/年，包含12个月使用权</li>
                  <li><strong>长期会员</strong>：¥10,999 一次性付款，长期使用权</li>
                  <li><strong>私有化部署</strong>：¥29,999，包含1年技术支持</li>
                </ul>
                <p className="text-slate-600 leading-relaxed mt-4">
                  所有价格均以人民币计价，可能会根据市场情况进行调整。价格调整不影响已购买的服务。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">6. 退款政策</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  我们提供以下退款保障：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>购买后 7 天内可申请无理由全额退款</li>
                  <li>退款将在 5-10 个工作日内原路返回</li>
                  <li>已使用超过 7 天的服务不支持退款</li>
                  <li>私有化部署服务一经开始实施不支持退款</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">7. 知识产权</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  本服务的所有内容，包括但不限于软件、文本、图形、标识、图标等，均为 AutoAds 或其许可方的财产，受知识产权法保护。
                </p>
                <p className="text-slate-600 leading-relaxed">
                  您使用本服务生成的广告内容，其知识产权归您所有。但您授予我们非独占性许可，允许我们为提供服务目的使用这些内容。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">8. 免责声明</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  本服务按"现状"提供，我们不对以下情况承担责任：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>服务的中断、延迟或错误</li>
                  <li>您的广告在 Google Ads 平台的审核结果</li>
                  <li>您的广告投放效果和投资回报</li>
                  <li>因您违反 Google Ads 政策导致的账户问题</li>
                  <li>因不可抗力导致的服务中断</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">9. 责任限制</h2>
                <p className="text-slate-600 leading-relaxed">
                  在法律允许的最大范围内，AutoAds 对因使用或无法使用本服务而产生的任何间接、附带、特殊、惩罚性或后果性损害不承担责任。
                  我们的总责任不超过您在过去12个月内支付给我们的服务费用。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">10. 服务变更与终止</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  我们保留以下权利：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>随时修改、暂停或终止本服务的任何部分</li>
                  <li>因违反本条款而暂停或终止您的账户</li>
                  <li>更新本条款（重大变更将提前通知）</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">11. 争议解决</h2>
                <p className="text-slate-600 leading-relaxed">
                  本条款受中华人民共和国法律管辖。因本条款引起的任何争议，双方应首先通过友好协商解决。
                  协商不成的，任何一方均可向 AutoAds 所在地有管辖权的人民法院提起诉讼。
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-slate-900 mb-4">12. 联系方式</h2>
                <p className="text-slate-600 leading-relaxed">
                  如果您对本服务条款有任何疑问，请通过以下方式联系我们：
                </p>
                <p className="text-slate-600 mt-4">
                  邮箱：<a href="mailto:legal@autoads.dev" className="text-blue-600 hover:text-blue-700">legal@autoads.dev</a>
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
