"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Mic, Receipt, Settings } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AiQuotaStatus } from "@/types/invoice";
import { AiQuotaControls } from "./AiQuotaControls";

interface NavbarProps {
  userEmail: string | null;
  requireLineReview: boolean;
  aiStatus?: AiQuotaStatus;
  checkingAi?: boolean;
  onCheckQuota?: () => void;
  onOpenAssistant?: () => void;
  activePage: "dashboard" | "settings";
}

export function Navbar({
  userEmail,
  requireLineReview,
  aiStatus,
  checkingAi = false,
  onCheckQuota,
  onOpenAssistant,
  activePage,
}: NavbarProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="glass-card rounded-3xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25"
          >
            <Receipt className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                فواتيري الذكية
              </h1>
              <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-medium text-indigo-200">
                Arabic Invoice OCR
              </span>
            </div>
            <p className="text-xs text-slate-400">
              رفع مباشر &bull; قراءة فواتير المشتريات العربية &bull; مراجعة الأرقام سطرًا بسطر
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenAssistant && (
            <button
              type="button"
              onClick={onOpenAssistant}
              className="btn-ai-ready inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition"
              title="فتح المحادثة النصية والصوتية مع المساعد الذكي حول الفواتير"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>محادثة وصوت AI</span>
            </button>
          )}

          {aiStatus && onCheckQuota && (
            <AiQuotaControls
              status={aiStatus}
              checking={checkingAi}
              onCheckQuota={onCheckQuota}
            />
          )}

          <Link
            href={activePage === "settings" ? "/" : "/settings"}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              activePage === "settings"
                ? "border-indigo-400/50 bg-indigo-500/20 text-white"
                : "border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            {activePage === "settings" ? (
              <span>العودة للوحة الفواتير</span>
            ) : (
              <span>
                الإعدادات ({requireLineReview ? "التأكيد سطر بسطر: مفعّل" : "حفظ مباشر"})
              </span>
            )}
          </Link>

          {userEmail && (
            <span className="hidden rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 font-mono text-[11px] text-slate-400 md:inline-block">
              {userEmail}
            </span>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            title="تسجيل الخروج"
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>خروج</span>
          </button>
        </div>
      </div>
    </header>
  );
}
