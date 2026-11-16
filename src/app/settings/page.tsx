import { redirect } from "next/navigation";
import { SettingsView } from "@/components/SettingsView";
import { getOrCreateUserSettings } from "@/lib/invoices/repository";
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
  const settings = await getOrCreateUserSettings(supabase, user.id);

  return <SettingsView initialSettings={settings} userEmail={user.email ?? null} />;
}
