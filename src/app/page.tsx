import { redirect } from "next/navigation";
import { InvoiceDashboard } from "@/components/InvoiceDashboard";
import { SetupNotice } from "@/components/SetupNotice";
import {
  buildServerAiAnalyzer,
  getOrCreateUserSettings,
  listUserInvoices,
} from "@/lib/invoices/repository";
import { createSupabaseServerClient, getOptionalServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { configured, user } = await getOptionalServerUser();

  if (!configured) {
    return <SetupNotice />;
  }

  if (!user) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const analyzer = await buildServerAiAnalyzer(supabase, user.id);

  const [invoices, settings, aiStatus] = await Promise.all([
    listUserInvoices(supabase, user.id),
    getOrCreateUserSettings(supabase, user.id),
    analyzer.getStatus(),
  ]);

  return (
    <InvoiceDashboard
      initialInvoices={invoices}
      initialSettings={settings}
      initialAiStatus={aiStatus}
      userEmail={user.email ?? null}
    />
  );
}
