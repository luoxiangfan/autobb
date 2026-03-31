import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { Mail, MessageCircle, Clock, MapPin } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.contact;

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <MarketingHeader />

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">
              联系我们
            </h1>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              有任何问题或建议？我们随时准备为您提供帮助
            </p>
          </div>

          {/* Contact Methods */}
          <div className="grid md:grid-cols-2 gap-6 mb-16">
            {/* Email */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mb-6">
                <Mail className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">邮件咨询</h3>
              <p className="text-slate-600 mb-4">
                发送邮件至我们的客服邮箱，我们将在 24 小时内回复
              </p>
              <a
                href="mailto:support@autoads.dev"
                className="text-blue-600 font-medium hover:text-blue-700 transition-colors"
              >
                support@autoads.dev
              </a>
            </div>

            {/* WeChat */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mb-6">
                <MessageCircle className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">微信客服</h3>
              <p className="text-slate-600 mb-4">
                添加微信客服，获取更快速的一对一支持
              </p>
              <span className="text-emerald-600 font-medium">
                微信号：AutoAds_Support
              </span>
            </div>

            {/* Business Hours */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center mb-6">
                <Clock className="w-7 h-7 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">服务时间</h3>
              <p className="text-slate-600 mb-4">
                我们的客服团队在以下时间为您提供服务
              </p>
              <div className="text-slate-900">
                <p className="font-medium">周一至周五</p>
                <p className="text-slate-600">09:00 - 18:00 (北京时间)</p>
              </div>
            </div>

            {/* Location */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center mb-6">
                <MapPin className="w-7 h-7 text-orange-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">公司地址</h3>
              <p className="text-slate-600 mb-4">
                欢迎来访交流，请提前预约
              </p>
              <span className="text-slate-900">
                中国 · 深圳
              </span>
            </div>
          </div>

          {/* FAQ Section */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">常见问题</h2>
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <div className="space-y-6">
                {[
                  {
                    q: "如何开始使用 AutoAds？",
                    a: "注册账号后，您可以立即开始免费试用。只需粘贴您的推广链接，AI 将自动生成广告文案。"
                  },
                  {
                    q: "支持哪些支付方式？",
                    a: "我们支持支付宝、微信支付、银行转账等多种支付方式。企业客户可申请对公转账。"
                  },
                  {
                    q: "如何获取技术支持？",
                    a: "您可以通过邮件或微信联系我们的客服团队。付费用户享有优先响应服务。"
                  },
                  {
                    q: "是否提供退款服务？",
                    a: "我们提供 7 天无理由退款保障。如果产品不符合您的预期，可以申请全额退款。"
                  }
                ].map((faq, idx) => (
                  <div key={idx} className="border-b border-slate-100 last:border-0 pb-6 last:pb-0">
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">{faq.q}</h3>
                    <p className="text-slate-600">{faq.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-8 md:p-12 text-white">
              <h2 className="text-2xl font-bold mb-4">还有其他问题？</h2>
              <p className="text-slate-300 mb-8">我们的团队随时准备为您解答</p>
              <a
                href="mailto:support@autoads.dev"
                className="inline-flex items-center px-8 py-4 bg-white text-slate-900 text-lg font-semibold rounded-full hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
              >
                发送邮件
              </a>
            </div>
          </section>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
