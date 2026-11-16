import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { isGeminiSupportedInvoiceFile } from "@/lib/gemini/client";
import { sanitizeStorageFilename } from "@/lib/invoices/arabic-utils";
import { UploadSignRequestSchema } from "@/lib/invoices/schema";
import { requireApiUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const env = getServerEnv();

  const body: unknown = await request.json().catch(() => null);
  const parsed = UploadSignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "بيانات طلب الرفع غير صالحة." },
      { status: 400 }
    );
  }

  const { fileName, mimeType, fileSize } = parsed.data;
  if (fileSize > env.maxFileSizeBytes) {
    const limitMb = (env.maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    return NextResponse.json(
      { error: `حجم الملف يتجاوز الحد الأقصى (${limitMb} MB).` },
      { status: 413 }
    );
  }

  if (!isGeminiSupportedInvoiceFile(fileName, mimeType, fileSize, env.maxFileSizeBytes)) {
    return NextResponse.json(
      { error: "الصيغة المدعومة للفواتير هي صور (JPG/PNG/WEBP) أو مستندات PDF فقط." },
      { status: 400 }
    );
  }

  const safeName = sanitizeStorageFilename(fileName);
  const objectPath = `${user.id}/${randomUUID()}/${safeName}`;

  const { data, error } = await supabase.storage
    .from(env.storageBucket)
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    return NextResponse.json(
      { error: `تعذر إنشاء رابط الرفع الآمن: ${error?.message ?? "خطأ غير معروف"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    filePath: objectPath,
    bucket: env.storageBucket,
  });
}
