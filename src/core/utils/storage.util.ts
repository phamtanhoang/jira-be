import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '@/core/constants';

let _supabase: SupabaseClient | null = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}

function getBucket() {
  return ENV.SUPABASE_STORAGE_BUCKET;
}

/**
 * Upload file to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const supabase = getSupabase();
  const bucket = getBucket();

  // Sanitize filename: remove special chars, keep extension
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete file from Supabase Storage by extracting path from public URL.
 */
export async function deleteFile(publicUrl: string): Promise<void> {
  const supabase = getSupabase();
  const bucket = getBucket();

  // URL format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
  const parts = publicUrl.split(`/storage/v1/object/public/${bucket}/`);
  if (parts.length < 2) return;

  const path = parts[1];
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.error('Supabase delete error:', error);
}
