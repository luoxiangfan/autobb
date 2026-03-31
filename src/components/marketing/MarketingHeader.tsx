import Link from "next/link";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 w-full bg-white/70 backdrop-blur-xl z-50 border-b border-slate-200/60 supports-[backdrop-filter]:bg-white/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.svg" alt="AutoAds" className="h-8 w-auto" />
          </Link>
          <nav className="hidden md:flex space-x-8">
            <a href="/#value" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
              核心价值
            </a>
            <a href="/#workflow" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
              使用流程
            </a>
            <a href="/#pricing" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
              价格方案
            </a>
            <a href="/#testimonials" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
              客户案例
            </a>
            <a href="https://www.urlchecker.dev/batchopen" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
              免费补点击
            </a>
          </nav>
          <div className="flex items-center gap-4">
            <a href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              登录
            </a>
            <a
              href="/login"
              className="px-5 py-2 bg-slate-900 text-white text-sm font-semibold rounded-full hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 hover:shadow-slate-900/30 hover:-translate-y-0.5"
            >
              免费试用
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
