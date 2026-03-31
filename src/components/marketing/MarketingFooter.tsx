import Image from "next/image";
import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="bg-slate-950 text-slate-400 py-16 border-t border-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand Column */}
          <div className="col-span-1 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-6">
              <Image src="/logo-white.svg" alt="AutoAds" width={124} height={32} className="h-8 w-auto" />
            </Link>
            <p className="text-sm leading-relaxed mb-6">
              专为 Affiliate Marketer 打造的 Google Ads
              自动化投放平台。10分钟搞定投放，让每一分预算都发挥最大价值
            </p>
          </div>

          {/* Links Columns */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">产品</h3>
            <ul className="space-y-3">
              <li><a href="/#value" className="text-sm hover:text-white transition-colors">核心价值</a></li>
              <li><a href="/#workflow" className="text-sm hover:text-white transition-colors">使用流程</a></li>
              <li><a href="/#pricing" className="text-sm hover:text-white transition-colors">价格方案</a></li>
              <li><a href="#" className="text-sm hover:text-white transition-colors">更新日志</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">资源</h3>
            <ul className="space-y-3">
              <li><a href="#" className="text-sm hover:text-white transition-colors">帮助中心</a></li>
              <li><a href="#" className="text-sm hover:text-white transition-colors">投放教程</a></li>
              <li><a href="/#testimonials" className="text-sm hover:text-white transition-colors">客户案例</a></li>
              <li><a href="#" className="text-sm hover:text-white transition-colors">社区论坛</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">公司</h3>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-sm hover:text-white transition-colors">关于我们</Link></li>
              <li><Link href="/contact" className="text-sm hover:text-white transition-colors">联系方式</Link></li>
              <li><Link href="/privacy" className="text-sm hover:text-white transition-colors">隐私政策</Link></li>
              <li><Link href="/terms" className="text-sm hover:text-white transition-colors">服务条款</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-900 text-center md:text-left flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} AutoAds. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex space-x-6">
            <Link href="/privacy" className="text-sm text-slate-500 hover:text-white transition-colors">隐私政策</Link>
            <Link href="/terms" className="text-sm text-slate-500 hover:text-white transition-colors">服务条款</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
