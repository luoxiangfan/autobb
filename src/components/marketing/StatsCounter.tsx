"use client";

import { useEffect, useState, useRef } from "react";
import CountUp from "react-countup";
import { Clock, DollarSign, TrendingUp, Globe } from "lucide-react";

interface StatItem {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  suffix: string;
  label: string;
  color: string;
}

const stats: StatItem[] = [
  {
    icon: Clock,
    value: 10,
    suffix: "分钟",
    label: "搞定投放",
    color: "text-blue-400",
  },
  {
    icon: DollarSign,
    value: 75,
    suffix: "%",
    label: "测试成本降低",
    color: "text-emerald-400",
  },
  {
    icon: TrendingUp,
    value: 40,
    suffix: "%",
    label: "ROI提升",
    color: "text-purple-400",
  },
  {
    icon: Globe,
    value: 20,
    suffix: "+国家",
    label: "一键覆盖",
    color: "text-orange-400",
  },
];

export function StatsCounter() {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="w-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 py-8 border-y border-slate-700/50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <div
              key={index}
              className="flex flex-col items-center text-center group"
            >
              <div className={`mb-3 ${stat.color} transition-transform group-hover:scale-110 duration-300`}>
                <stat.icon className="w-8 h-8" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl md:text-4xl font-bold text-white">
                  {isVisible ? (
                    <CountUp
                      end={stat.value}
                      duration={2}
                      delay={index * 0.2}
                    />
                  ) : (
                    "0"
                  )}
                </span>
                <span className={`text-lg md:text-xl font-semibold ${stat.color}`}>
                  {stat.suffix}
                </span>
              </div>
              <span className="mt-1 text-sm text-slate-400 font-medium">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
