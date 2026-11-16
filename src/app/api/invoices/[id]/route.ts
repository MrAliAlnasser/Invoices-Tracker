import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getUserInvoiceById } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";
import { deleteInvoiceObjectAndClean } from "@/lib/supabase/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const { id } = await context.params;
  const invoice = await getUserInvoiceById(supabase, user.id, id);

  if (!invoice) {
    return NextResponse.json({ error: "الفاتورة غير موجودة." }, { status: 404 });
  }

  return NextResponse.json({ invoice });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const { id } = await context.params;
  const env = getServerEnv();

  const existing = await getUserInvoiceById(supabase, user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "الفاتورة غير موجودة." }, { status: 404 });
  }

  const { error: delErr } = await supabase
    .from("invoices")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const storageResult = await deleteInvoiceObjectAndClean(
    supabase,
    env.storageBucket,
    existing.file_path
  );

  return NextResponse.json({
    status: "deleted",
    id,
    removedPaths: storageResult.removedPaths,
  });
}
