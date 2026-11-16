import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getUserInvoiceById } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const { id } = await context.params;
  const env = getServerEnv();

  const invoice = await getUserInvoiceById(supabase, user.id, id);
  if (!invoice) {
    return NextResponse.json({ error: "الفاتورة غير موجودة." }, { status: 404 });
  }

  const downloadMode = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUrl(invoice.file_path, 3600, {
      download: downloadMode ? invoice.file_name : false,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "تعذر إنشاء رابط معاينة الملف." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: data.signedUrl,
    fileName: invoice.file_name,
    mimeType: invoice.mime_type,
  });
}
