"use client";

import { Calculator, CheckCircle2, Clock, ReceiptText } from "lucide-react";
import type { DashboardKpis } from "@/types/invoice";
import { formatMoney } from "@/lib/invoices/kpis";

interface KpiCardsProps {
  kpis: DashboardKpis;
  currency: string;
}

export function KpiCards({ kpis, currency }: KpiCardsProps) {
  const cards = [
    {
      label: "إجمالي المشتريات",
      value: formatMoney(kpis.total_spend, currency),
      sub: `من أصل ${kpis.total_invoices} فاتورة مسجلة`,
      icon: ReceiptText,
      accent: "from-blue-500/20 to-indigo-500/10 border-blue-400/25 text-blue-300",
    },
    {
      label: "ضريبة القيمة المضافة VAT",
      value: formatMoney(kpis.total_vat, currency),
      sub: "إجمالي الضرائب المستخلصة",
      icon: Calculator,
      accent: "from-violet-500/20 to-fuchsia-500/10 border-violet-400/25 text-violet-300",
    },
    {
      label: "فواتير معتمدة",
      value: String(kpis.verified_count),
      sub: "مؤكدة سطرًا بسطر أو محفوظة",
      icon: CheckCircle2,
      accent: "from-emerald-500/20 to-teal-500/10 border-emerald-400/25 text-emerald-300",
    },
    {
      label: "بانتظار المراجعة / التحليل",
      value: String(kpis.pending_review_count),
      sub:
        kpis.pending_ai_count > 0
          ? `${kpis.pending_ai_count} فاتورة بانتظار توفر رصيد AI`
          : "جاهزة لتدقيق السطور",
      icon: Clock,
      accent: "from-amber-500/20 to-orange-500/10 border-amber-400/25 text-amber-300",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="glass-card rounded-2xl p-4 transition duration-200 hover:border-slate-600/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">{card.label}</p>
                <p className="mt-2 font-mono text-xl font-bold tracking-tight text-white tabular-nums">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-slate-400">{card.sub}</p>
              </div>
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br ${card.accent}`}
              >
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
