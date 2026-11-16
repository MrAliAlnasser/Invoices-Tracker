import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteInvoiceObjectAndClean } from "@/lib/supabase/storage";

function verifyBearerSecret(authHeader: string | null, expectedSecret: string | null): boolean {
  if (!authHeader || !expectedSecret) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1].trim(), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  let cronSecret: string | null = null;
  let storageBucket = "invoices";
  try {
    const env = getServerEnv();
    cronSecret = env.cronSecret;
    storageBucket = env.storageBucket;
  } catch {
    return NextResponse.json({ error: "Server configuration incomplete." }, { status: 503 });
  }

  if (!verifyBearerSecret(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized cron invocation." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for maintenance." },
      { status: 503 }
    );
  }

  // Lightweight DB keep-alive ping prevents Supabase Free Tier 7-day inactivity pause.
  const { data: settingsRows, error: pingErr } = await admin
    .from("user_settings")
    .select("user_id, auto_delete_days")
    .not("auto_delete_days", "is", null);

  if (pingErr) {
    return NextResponse.json({ error: pingErr.message }, { status: 500 });
  }

  let deletedInvoices = 0;
  let removedStoragePaths = 0;

  for (const setting of settingsRows ?? []) {
    const days = Number(setting.auto_delete_days);
    if (!Number.isFinite(days) || days <= 0) continue;

    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: expired } = await admin
      .from("invoices")
      .select("id, file_path")
      .eq("user_id", setting.user_id)
      .lt("created_at", cutoffIso);

    for (const inv of expired ?? []) {
      const storageRes = await deleteInvoiceObjectAndClean(
        admin,
        storageBucket,
        String(inv.file_path ?? "")
      );
      removedStoragePaths += storageRes.removedPaths.length;

      const { error: delErr } = await admin
        .from("invoices")
        .delete()
        .eq("id", inv.id)
        .eq("user_id", setting.user_id);

      if (!delErr) {
        deletedInvoices += 1;
      }
    }
  }

  return NextResponse.json({
    status: "ok",
    supabase_keep_alive: true,
    deleted_invoices: deletedInvoices,
    removed_storage_paths: removedStoragePaths,
  });
}
