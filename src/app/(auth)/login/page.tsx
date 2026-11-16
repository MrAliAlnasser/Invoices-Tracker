"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Receipt, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function translateAuthError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }
  if (lower.includes("email not confirmed")) {
    return "البريد الإلكتروني غير مؤكد بعد — افتح رابط التفعيل في بريدك أو فعّل المستخدم من لوحة Supabase.";
  }
  if (lower.includes("user already registered")) {
    return "هذا البريد الإلكتروني مسجّل مسبقًا؛ اختر تبويب تسجيل الدخول.";
  }
  if (lower.includes("password should be at least")) {
    return "كلمة المرور يجب أن تتكون من 6 أحرف أو أرقام على الأقل.";
  }
  if (lower.includes("rate limit")) {
    return "تم إرسال محاولات كثيرة مؤقتًا — انتظر قليلًا ثم أعد المحاولة.";
  }
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setInfoMsg(
            "تم إنشاء الحساب! يرجى فتح بريدك الإلكتروني وتأكيد رابط التفعيل ثم تسجيل الدخول."
          );
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "تعذر إتمام العملية.";
      setErrorMsg(translateAuthError(raw));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass-card w-full max-w-md rounded-3xl p-7 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/30">
            <Receipt className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">فواتيري الذكية</h1>
          <p className="mt-1 text-xs text-slate-400">
            منصة OCR لقراءة فواتير المشتريات العربية ومراجعتها سطرًا بسطر
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              mode === "signin"
                ? "bg-indigo-500 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              mode === "signup"
                ? "bg-indigo-500 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            حساب جديد
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="email-input">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="email-input"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2 pr-10 pl-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="password-input">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="password-input"
                type="password"
                required
                minLength={6}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2 pr-10 pl-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          </div>

          {errorMsg && (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {errorMsg}
            </p>
          )}
          {infoMsg && (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {infoMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-ai-ready flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>
              {loading
                ? "جاري المعالجة..."
                : mode === "signin"
                  ? "دخول إلى لوحة الفواتير"
                  : "إنشاء حساب مجاني"}
            </span>
          </button>
        </form>
      </div>
    </main>
  );
}
