"use client";

import { useEffect, useState, useMemo } from "react";
import { Timer, Gift, ShoppingBag, Heart, Star, Zap, ShoppingCart } from "lucide-react";

// 节日类型定义
type HolidayType =
    | "spring-festival"   // 春节
    | "valentine"         // 情人节
    | "women-day"         // 38女神节
    | "618-sale"          // 618购物节
    | "back-to-school"    // 返校季
    | "single-day"        // 双11光棍节
    | "black-friday"      // 黑色星期五
    | "cyber-monday"      // 网络星期一
    | "christmas"         // 圣诞节
    | "none";

// 节日配置
interface HolidayConfig {
    type: HolidayType;
    name: string;
    shortName: string;
    // 计算下一个节日日期
    getNextDate: (currentYear: number, currentDate: Date) => Date | null;
    // 主题色
    theme: {
        primary: string;
        secondary: string;
        accent: string;
        gradient: string;
    };
    // 图标
    icon: "gift" | "shopping" | "heart" | "star" | "zap" | "cart";
    // 是否显示
    enabled: boolean;
}

const holidayConfigs: HolidayConfig[] = [
    {
        type: "spring-festival",
        name: "春节特惠",
        shortName: "春节",
        getNextDate: (year, now) => {
            // 春节大约在1月21日到2月20日之间
            // 简化处理：设定为1月22日
            const springFestival = new Date(year, 0, 22);
            if (now < springFestival) return springFestival;
            return new Date(year + 1, 0, 22);
        },
        theme: {
            primary: "from-red-600 to-orange-500",
            secondary: "bg-red-500/20",
            accent: "text-red-300",
            gradient: "bg-gradient-to-r from-red-900 via-red-700 to-orange-600"
        },
        icon: "gift",
        enabled: true
    },
    {
        type: "valentine",
        name: "情人节礼物",
        shortName: "情人节",
        getNextDate: (year, now) => {
            const valentine = new Date(year, 1, 14);
            if (now < valentine) return valentine;
            return new Date(year + 1, 1, 14);
        },
        theme: {
            primary: "from-pink-500 to-rose-400",
            secondary: "bg-pink-500/20",
            accent: "text-pink-300",
            gradient: "bg-gradient-to-r from-pink-900 via-pink-700 to-rose-600"
        },
        icon: "heart",
        enabled: true
    },
    {
        type: "women-day",
        name: "38女神节",
        shortName: "女神节",
        getNextDate: (year, now) => {
            const womenDay = new Date(year, 2, 8);
            if (now < womenDay) return womenDay;
            return new Date(year + 1, 2, 8);
        },
        theme: {
            primary: "from-purple-500 to-pink-400",
            secondary: "bg-purple-500/20",
            accent: "text-purple-300",
            gradient: "bg-gradient-to-r from-purple-900 via-purple-700 to-pink-600"
        },
        icon: "star",
        enabled: true
    },
    {
        type: "618-sale",
        name: "618年中大促",
        shortName: "618",
        getNextDate: (year, now) => {
            // 618通常是6月18日，活动从6月1日开始
            const saleStart = new Date(year, 5, 1);
            const saleDay = new Date(year, 5, 18);
            if (now < saleStart) return saleStart;
            if (now < saleDay) return saleDay;
            return new Date(year + 1, 5, 1);
        },
        theme: {
            primary: "from-orange-500 to-red-500",
            secondary: "bg-orange-500/20",
            accent: "text-orange-300",
            gradient: "bg-gradient-to-r from-orange-900 via-orange-700 to-red-600"
        },
        icon: "shopping",
        enabled: true
    },
    {
        type: "back-to-school",
        name: "返校季特惠",
        shortName: "返校季",
        getNextDate: (year, now) => {
            // 返校季通常是8月中旬到9月初
            const bts = new Date(year, 7, 15);
            if (now < bts) return bts;
            return new Date(year + 1, 7, 15);
        },
        theme: {
            primary: "from-blue-500 to-cyan-400",
            secondary: "bg-blue-500/20",
            accent: "text-blue-300",
            gradient: "bg-gradient-to-r from-blue-900 via-blue-700 to-cyan-600"
        },
        icon: "cart",
        enabled: true
    },
    {
        type: "single-day",
        name: "双11全球狂欢节",
        shortName: "双11",
        getNextDate: (year, now) => {
            const singleDay = new Date(year, 10, 11);
            if (now < singleDay) return singleDay;
            return new Date(year + 1, 10, 11);
        },
        theme: {
            primary: "from-orange-400 to-yellow-500",
            secondary: "bg-orange-500/20",
            accent: "text-orange-300",
            gradient: "bg-gradient-to-r from-orange-900 via-orange-700 to-yellow-600"
        },
        icon: "shopping",
        enabled: true
    },
    {
        type: "black-friday",
        name: "黑色星期五",
        shortName: "黑五",
        getNextDate: (year, now) => {
            // 黑色星期五是11月最后一个周五
            const nov = new Date(year, 10, 1);
            const dayOfWeek = nov.getDay();
            const firstFriday = 5 - dayOfWeek + (dayOfWeek > 5 ? 7 : 0) + 1;
            const blackFriday = new Date(year, 10, firstFriday + 21);
            if (now < blackFriday) return blackFriday;
            return new Date(year + 1, 10, firstFriday + 21);
        },
        theme: {
            primary: "from-blue-600 to-indigo-500",
            secondary: "bg-blue-500/20",
            accent: "text-blue-300",
            gradient: "bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-800"
        },
        icon: "shopping",
        enabled: true
    },
    {
        type: "cyber-monday",
        name: "网络星期一",
        shortName: "网一",
        getNextDate: (year, now) => {
            // 网络星期一是黑色星期五后的周一
            const nov = new Date(year, 10, 1);
            const dayOfWeek = nov.getDay();
            const firstFriday = 5 - dayOfWeek + (dayOfWeek > 5 ? 7 : 0) + 1;
            const blackFriday = new Date(year, 10, firstFriday + 21);
            const cyberMonday = new Date(blackFriday);
            cyberMonday.setDate(blackFriday.getDate() + 3);
            if (now < cyberMonday) return cyberMonday;
            return new Date(year + 1, 10, firstFriday + 21 + 3);
        },
        theme: {
            primary: "from-purple-500 to-blue-500",
            secondary: "bg-purple-500/20",
            accent: "text-purple-300",
            gradient: "bg-gradient-to-r from-purple-900 via-blue-800 to-indigo-900"
        },
        icon: "zap",
        enabled: true
    },
    {
        type: "christmas",
        name: "圣诞狂欢节",
        shortName: "圣诞",
        getNextDate: (year, now) => {
            const christmas = new Date(year, 11, 25);
            if (now < christmas) return christmas;
            return new Date(year + 1, 11, 25);
        },
        theme: {
            primary: "from-red-600 to-green-500",
            secondary: "bg-red-500/20",
            accent: "text-red-300",
            gradient: "bg-gradient-to-r from-green-900 via-red-800 to-green-700"
        },
        icon: "gift",
        enabled: true
    },
];

// 获取当前活跃的节日
function getActiveHoliday(): { config: HolidayConfig; targetDate: Date } | null {
    const now = new Date();
    const currentYear = now.getFullYear();

    // 找出下一个即将到来的节日
    let nextHoliday: { config: HolidayConfig; targetDate: Date } | null = null;

    for (const config of holidayConfigs) {
        if (!config.enabled) continue;

        const targetDate = config.getNextDate(currentYear, now);
        if (!targetDate) continue;

        // 计算距离节日的天数
        const daysUntil = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // 只显示30天内的节日
        if (daysUntil <= 30 && daysUntil > -7) {
            if (!nextHoliday || targetDate < nextHoliday.targetDate) {
                nextHoliday = { config, targetDate };
            }
        }
    }

    return nextHoliday;
}

// 获取图标组件
function HolidayIcon({ icon, className }: { icon: string; className?: string }) {
    const iconMap: Record<string, React.ReactNode> = {
        gift: <Gift className={className} />,
        shopping: <ShoppingBag className={className} />,
        heart: <Heart className={className} />,
        star: <Star className={className} />,
        zap: <Zap className={className} />,
        cart: <ShoppingCart className={className} />,
    };
    return iconMap[icon] || <Gift className={className} />;
}

export function HolidayCountdown() {
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
    });
    const [activeHoliday, setActiveHoliday] = useState<{ config: HolidayConfig; targetDate: Date } | null>(null);
    const [mounted, setMounted] = useState(false);

    // 初始化节日
    useEffect(() => {
        const holiday = getActiveHoliday();
        setActiveHoliday(holiday);
    }, []);

    // 倒计时逻辑
    useEffect(() => {
        if (!activeHoliday) return;

        const calculateTime = () => {
            const now = new Date();
            const targetDate = activeHoliday.targetDate;
            const difference = targetDate.getTime() - now.getTime();

            if (difference > 0) {
                setTimeLeft({
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    minutes: Math.floor((difference / 1000 / 60) % 60),
                    seconds: Math.floor((difference / 1000) % 60),
                });
            }
        };

        calculateTime();
        const timer = setInterval(calculateTime, 1000);

        return () => clearInterval(timer);
    }, [activeHoliday]);

    // 客户端渲染后显示
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || !activeHoliday) return null;

    const { config, targetDate } = activeHoliday;
    const theme = config.theme;
    const isUrgent = timeLeft.days <= 3; // 3天内显示紧急样式

    // 计算活动状态
    const now = new Date();
    const isActive = now <= targetDate && now.getTime() - targetDate.getTime() < 7 * 24 * 60 * 60 * 1000;
    const statusText = isActive ? "活动进行中" : "距活动开始";

    return (
        <div className="relative z-10 w-full min-h-[20vh] flex items-center justify-center overflow-hidden animate-in fade-in slide-in-from-top-4 duration-700">
            {/* 渐变背景 */}
            <div className={`absolute inset-0 z-0 ${theme.gradient}`} />

            {/* 装饰性光效 */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse delay-1000" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center gap-2 text-white p-2 w-full max-w-4xl">
                {/* Title Section */}
                <div className="flex items-center gap-2 mb-1 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                    <div className={`p-2 rounded-full ${theme.secondary} border border-white/20 shadow-lg`}>
                        <HolidayIcon
                            icon={config.icon}
                            className={`w-5 h-5 ${theme.accent} drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]`}
                        />
                    </div>
                    <span className={`
                        font-bold text-2xl sm:text-4xl tracking-wider
                        bg-clip-text text-transparent
                        bg-gradient-to-r from-white via-white/90 to-white/80
                        drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]
                        font-sans
                    `}>
                        {config.name}
                    </span>
                </div>

                {/* 状态提示 */}
                <div className={`
                    px-3 py-1 rounded-full text-xs font-medium
                    ${isActive
                        ? "bg-green-500/30 border border-green-400/30 text-green-200"
                        : "bg-white/10 border border-white/20 text-white/70"
                    }
                `}>
                    {statusText}
                </div>

                {/* Countdown Cards */}
                <div className="flex items-start justify-center gap-3 sm:gap-5 w-full animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
                    {[
                        { value: timeLeft.days, label: "天" },
                        { value: timeLeft.hours, label: "时" },
                        { value: timeLeft.minutes, label: "分" },
                        { value: timeLeft.seconds, label: "秒" }
                    ].map((item, index) => (
                        <div key={index} className="flex flex-col items-center gap-1">
                            <div className="relative group">
                                {isUrgent && (
                                    <div className={`absolute inset-0 rounded-xl blur-md opacity-70 animate-pulse ${theme.primary.split(' ')[0].replace('from-', 'bg-')}`} />
                                )}
                                <div className={`
                                    relative w-14 sm:w-20 h-16 sm:h-24
                                    bg-white/10 backdrop-blur-md
                                    border border-white/20
                                    rounded-xl
                                    flex items-center justify-center
                                    shadow-2xl overflow-hidden
                                    transition-all duration-300
                                    group-hover:bg-white/15
                                `}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-50" />
                                    <span className={`
                                        font-mono text-3xl sm:text-5xl font-bold text-white
                                        drop-shadow-md tracking-tighter tabular-nums
                                        ${isUrgent ? 'animate-pulse' : ''}
                                    `}>
                                        {String(item.value).padStart(2, '0')}
                                    </span>
                                </div>
                            </div>
                            <span className="text-xs sm:text-sm font-bold text-white uppercase tracking-[0.2em] drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
                                {item.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
