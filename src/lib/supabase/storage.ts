import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Delete a stored invoice object and prune empty placeholder files left in parent folders.
 */
export async function deleteInvoiceObjectAndClean(
  supabase: SupabaseClient,
  bucket: string,
  filePath: string
): Promise<{ removedPaths: string[] }> {
  const removedPaths: string[] = [];
  if (!filePath) return { removedPaths };

  const { error: removeErr } = await supabase.storage.from(bucket).remove([filePath]);
  if (!removeErr) {
    removedPaths.push(filePath);
  }

  const segments = filePath.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const folderPrefix = segments.slice(0, i).join("/");
    const { data: listed } = await supabase.storage.from(bucket).list(folderPrefix, {
      limit: 10,
    });
    if (!listed || listed.length === 0) {
      continue;
    }
    const onlyPlaceholder =
      listed.length === 1 && listed[0].name === ".emptyFolderPlaceholder";
    if (onlyPlaceholder) {
      const placeholderPath = `${folderPrefix}/.emptyFolderPlaceholder`;
      const { error: phErr } = await supabase.storage.from(bucket).remove([placeholderPath]);
      if (!phErr) {
        removedPaths.push(placeholderPath);
      }
    } else {
      break;
    }
  }

  return { removedPaths };
}
