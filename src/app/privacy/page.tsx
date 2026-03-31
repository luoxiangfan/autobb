import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.privacy;

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <MarketingHeader />

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">
              隐私政策
            </h1>
            <p className="text-slate-600">
              最后更新日期：2025年1月1日
            </p>
          </div>

          {/* Content */}
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-slate-200">
            <div className="prose prose-slate max-w-none">
              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">1. 概述</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  AutoAds（以下简称"我们"）非常重视用户的隐私保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。
                </p>
                <p className="text-slate-600 leading-relaxed">
                  使用我们的服务即表示您同意本隐私政策中描述的数据处理方式。如果您不同意本政策的任何部分，请停止使用我们的服务。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">2. 信息收集</h2>
                <p className="text-slate-600 leading-relaxed mb-4">我们可能收集以下类型的信息：</p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li><strong>账户信息</strong>：注册时提供的用户名、邮箱地址、密码等</li>
                  <li><strong>使用数据</strong>：您使用服务时产生的操作记录、日志数据等</li>
                  <li><strong>设备信息</strong>：浏览器类型、IP地址、设备标识符等</li>
                  <li><strong>支付信息</strong>：订单信息、支付方式（我们不存储完整的支付卡信息）</li>
                  <li><strong>广告数据</strong>：您创建的广告内容、关键词、投放数据等</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">3. 信息使用</h2>
                <p className="text-slate-600 leading-relaxed mb-4">我们使用收集的信息用于：</p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>提供、维护和改进我们的服务</li>
                  <li>处理您的交易和发送相关通知</li>
                  <li>向您发送技术通知、更新和安全警报</li>
                  <li>响应您的评论、问题和客户服务请求</li>
                  <li>分析使用趋势以改进用户体验</li>
                  <li>检测、预防和解决技术问题</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">4. 信息共享</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  我们不会出售您的个人信息。我们可能在以下情况下共享您的信息：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li><strong>服务提供商</strong>：与帮助我们运营服务的第三方服务提供商共享</li>
                  <li><strong>法律要求</strong>：在法律要求或政府机关合法请求时</li>
                  <li><strong>业务转让</strong>：在公司合并、收购或资产出售的情况下</li>
                  <li><strong>您的同意</strong>：在获得您明确同意的其他情况下</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">5. 数据安全</h2>
                <p className="text-slate-600 leading-relaxed mb-4">
                  我们采取适当的技术和组织措施来保护您的个人信息，包括：
                </p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li>使用 SSL/TLS 加密传输数据</li>
                  <li>对敏感数据进行加密存储</li>
                  <li>定期进行安全审计和漏洞扫描</li>
                  <li>限制员工访问个人数据的权限</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">6. 数据保留</h2>
                <p className="text-slate-600 leading-relaxed">
                  我们会在实现本隐私政策所述目的所需的期限内保留您的个人信息，除非法律要求或允许更长的保留期限。
                  当您删除账户时，我们将在合理时间内删除或匿名化您的个人信息，除非我们需要保留某些信息以遵守法律义务。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">7. 您的权利</h2>
                <p className="text-slate-600 leading-relaxed mb-4">您对您的个人信息享有以下权利：</p>
                <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                  <li><strong>访问权</strong>：请求访问我们持有的您的个人信息</li>
                  <li><strong>更正权</strong>：请求更正不准确或不完整的信息</li>
                  <li><strong>删除权</strong>：请求删除您的个人信息</li>
                  <li><strong>数据可携带权</strong>：请求以结构化格式获取您的数据</li>
                  <li><strong>撤回同意权</strong>：随时撤回您之前给予的同意</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">8. Cookie 使用</h2>
                <p className="text-slate-600 leading-relaxed">
                  我们使用 Cookie 和类似技术来收集和存储信息，以便为您提供更好的服务体验。
                  您可以通过浏览器设置管理 Cookie 偏好，但禁用某些 Cookie 可能会影响服务的功能。
                </p>
              </section>

              <section className="mb-10">
                <h2 className="text-xl font-bold text-slate-900 mb-4">9. 政策更新</h2>
                <p className="text-slate-600 leading-relaxed">
                  我们可能会不时更新本隐私政策。更新后的政策将在本页面发布，并在生效前通过适当方式通知您。
                  建议您定期查看本页面以了解最新的隐私保护措施。
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-slate-900 mb-4">10. 联系我们</h2>
                <p className="text-slate-600 leading-relaxed">
                  如果您对本隐私政策有任何疑问或需要行使您的权利，请通过以下方式联系我们：
                </p>
                <p className="text-slate-600 mt-4">
                  邮箱：<a href="mailto:privacy@autoads.dev" className="text-blue-600 hover:text-blue-700">privacy@autoads.dev</a>
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
