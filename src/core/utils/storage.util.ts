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

/**
 * Upload one piece of an in-progress chunked upload to a temporary path.
 * The path is namespaced by sessionId so abandoned uploads can be swept
 * by deleting the whole prefix.
 */
export async function uploadChunkObject(
  sessionId: string,
  chunkIndex: number,
  buffer: Buffer,
): Promise<void> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const path = chunkObjectPath(sessionId, chunkIndex);

  // Retry the write a few times — Supabase free tier occasionally returns a
  // success response that doesn't actually persist the object, leaving the
  // subsequent `complete` step with a phantom "Object not found" error on
  // /complete despite each chunk POST returning 201. Three attempts with
  // verification after each is enough to absorb transient consistency
  // issues without dragging out the happy path materially.
  const MAX_ATTEMPTS = 3;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    if (error) {
      lastError = error.message;
      logger.warn(
        `Supabase chunk upload attempt ${attempt}/${MAX_ATTEMPTS} failed (${path}): ${error.message}`,
      );
    } else {
      // Verify the object actually landed before reporting success. Without
      // this we trust Supabase's 200 and only learn it lied minutes later
      // when /complete tries to download.
      const verified = await chunkObjectExists(sessionId, chunkIndex);
      if (verified) return;
      lastError = 'upload reported success but object not retrievable';
      logger.warn(
        `Supabase chunk upload attempt ${attempt}/${MAX_ATTEMPTS} unverified (${path})`,
      );
    }
    // Small backoff between attempts. 100ms · 2 · attempt is enough for
    // Supabase's edge cache to settle on retry without piling latency.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }

  logger.error(
    `Supabase chunk upload exhausted retries (${path}): ${lastError}`,
  );
  throw new Error(`Chunk upload failed: ${lastError}`);
}

/**
 * HEAD-style probe — does the chunk exist on the bucket?
 * Used by `uploadChunkObject` to verify writes that returned success.
 */
async function chunkObjectExists(
  sessionId: string,
  chunkIndex: number,
): Promise<boolean> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const path = chunkObjectPath(sessionId, chunkIndex);
  // `list` with a prefix is the cheapest "does this object exist" query
  // Supabase exposes — no body transfer, just a directory lookup.
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(`temp/${sessionId}`, {
      limit: 1,
      search: path.split('/').pop()!,
    });
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Authoritative list of chunk indices that are actually persisted on
 * Supabase under this session's temp folder. Used by `complete` as a
 * self-healing check before assembling — if the BE session bookkeeping
 * thinks all chunks are received but Supabase silently dropped one, we
 * can hand the missing indices back to the FE for re-upload.
 */
export async function listChunkIndices(sessionId: string): Promise<number[]> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(`temp/${sessionId}`, { limit: 1000 });
  if (error || !data) return [];
  const indices: number[] = [];
  for (const obj of data) {
    const m = obj.name.match(/^chunk-(\d{6})$/);
    if (m) indices.push(parseInt(m[1], 10));
  }
  return indices;
}

/**
 * Download a previously uploaded chunk back into memory.
 * Used during `complete` to assemble the final file.
 *
 * Supabase Storage occasionally returns "Object not found" on a download
 * for an object that was successfully uploaded seconds earlier — list and
 * download endpoints sit behind slightly different caches, so a chunk can
 * appear in `list()` (our upload-time verify) yet still 404 on `download()`
 * during the same request lifecycle. The retry loop here absorbs that
 * window without surfacing the failure to the user.
 */
export async function downloadChunkObject(
  sessionId: string,
  chunkIndex: number,
): Promise<Buffer> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const path = chunkObjectPath(sessionId, chunkIndex);

  const MAX_ATTEMPTS = 6;
  let lastErrorMessage = 'no data';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (data && !error) {
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    lastErrorMessage = error?.message ?? 'no data';
    logger.warn(
      `Supabase chunk download attempt ${attempt}/${MAX_ATTEMPTS} failed (${path}): ${lastErrorMessage}`,
    );
    if (attempt < MAX_ATTEMPTS) {
      // Exponential-ish backoff. Free-tier Supabase consistency window
      // can be up to ~5s; total backoff here is ~12s before giving up.
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  throw new Error(`Chunk download failed (${path}): ${lastErrorMessage}`);
}

/**
 * Best-effort cleanup of every chunk written under a session. Called both
 * on successful `complete` and on `abort` / TTL expiry. Errors are logged
 * but never thrown — leftover bytes are wasted storage, not a data bug.
 */
export async function deleteChunkObjects(
  sessionId: string,
  chunkCount: number,
): Promise<void> {
  if (chunkCount <= 0) return;
  const supabase = getSupabase();
  const bucket = getBucket();
  const paths = Array.from({ length: chunkCount }, (_, i) =>
    chunkObjectPath(sessionId, i),
  );
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error)
    logger.error(
      `Supabase chunk cleanup error (${sessionId}): ${error.message}`,
      error.stack,
    );
}

function chunkObjectPath(sessionId: string, chunkIndex: number): string {
  return `temp/${sessionId}/chunk-${String(chunkIndex).padStart(6, '0')}`;
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
