import { Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '@/core/constants';

const logger = new Logger('Storage');

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

  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    logger.error(`Supabase upload error: ${error.message}`, error.stack);
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

  const path = extractStoragePath(publicUrl);
  if (!path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error)
    logger.error(`Supabase delete error: ${error.message}`, error.stack);
}

/**
 * Generate a short-lived signed URL for a previously uploaded file.
 * Returns `null` if the URL doesn't look like one of our storage paths.
 *
 * `expiresInSec` defaults to 5 minutes — short enough to limit leak damage,
 * long enough for a browser to fetch and render an image or file preview.
 */
export async function createSignedUrl(
  publicUrl: string,
  expiresInSec = 300,
): Promise<string | null> {
  const supabase = getSupabase();
  const bucket = getBucket();

  const path = extractStoragePath(publicUrl);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSec);

  if (error || !data) {
    logger.error(
      `Supabase signed URL error: ${error?.message ?? 'no data returned'}`,
      error?.stack,
    );
    return null;
  }
  return data.signedUrl;
}

function extractStoragePath(publicUrl: string): string | null {
  const bucket = getBucket();
  // Public URL: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
  // Signed URL (for completeness): /storage/v1/object/sign/{bucket}/{path}
  const publicParts = publicUrl.split(`/storage/v1/object/public/${bucket}/`);
  if (publicParts.length === 2) return publicParts[1].split('?')[0];
  const signParts = publicUrl.split(`/storage/v1/object/sign/${bucket}/`);
  if (signParts.length === 2) return signParts[1].split('?')[0];
  return null;
}
