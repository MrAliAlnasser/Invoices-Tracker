import { Database, KeyRound, Rocket, Terminal } from "lucide-react";

export function SetupNotice() {
  const steps = [
    {
      icon: Database,
      title: "1. إنشاء مشروع Supabase وتطبيق الجداول",
      desc: "أنشئ مشروعًا مجانيًا في Supabase ثم نفّذ محتوى supabase/schema.sql داخل SQL Editor لإنشاء جداول الفواتير وباكت التخزين وسياسات الحماية.",
    },
    {
      icon: KeyRound,
      title: "2. إعداد المفاتيح في .env.local أو Vercel",
      desc: "أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY و SUPABASE_SERVICE_ROLE_KEY ومفتاح GEMINI_API_KEY من Google AI Studio.",
    },
    {
      icon: Rocket,
      title: "3. النشر على Vercel والبدء بالرفع",
      desc: "ارفع مجلد v2-invoices-app إلى مستودع GitHub واربطه بمشروع جديد على Vercel لتعمل المنصة مجانًا بالكامل.",
    },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
      <div className="glass-card w-full rounded-3xl p-7 sm:p-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-indigo-300">جاهز للتهيئة الأولية</span>
            <h1 className="text-xl font-bold text-white sm:text-2xl">
              فواتيري الذكية — ربط Supabase و Google AI Studio
            </h1>
          </div>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-slate-300">
          البنية البرمجية للمشروع جاهزة، وينقصها فقط إضافة مفاتيح الاتصال الخاصة بمشروعك المجاني في ملف{" "}
          <code className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs text-indigo-300">
            .env.local
          </code>{" "}
          (نسخًا من <code className="font-mono text-xs text-slate-400">.env.example</code>).
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="glass-surface rounded-2xl p-4">
                <Icon className="mb-2.5 h-5 w-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">{step.title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
