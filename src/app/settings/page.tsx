import { redirect } from "next/navigation";
import { SettingsView } from "@/components/SettingsView";
import {
  buildServerAiAnalyzer,
  getOrCreateUserSettings,
} from "@/lib/invoices/repository";
import { createSupabaseServerClient, getOptionalServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { configured, user } = await getOptionalServerUser();

  if (!configured) {
    redirect("/");
  }
  if (!user) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const analyzer = await buildServerAiAnalyzer(supabase, user.id);
  const [settings, aiStatus] = await Promise.all([
    getOrCreateUserSettings(supabase, user.id),
    analyzer.getStatus(),
  ]);

  return (
    <SettingsView
      initialSettings={settings}
      initialAiStatus={aiStatus}
      userEmail={user.email ?? null}
    />
  );
}
