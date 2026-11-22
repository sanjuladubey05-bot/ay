import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseAdapter } from '../database/pool';
import { detectImageExtensionFromMagicBytes } from './pricing';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), '.data', 'uploads');

export function getMediaUploadDir(): string {
  return process.env.LPS_MEDIA_UPLOAD_DIR
    ? path.resolve(process.env.LPS_MEDIA_UPLOAD_DIR)
    : DEFAULT_UPLOAD_DIR;
}

export async function ensureMediaUploadDir(): Promise<string> {
  const dir = getMediaUploadDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function saveUploadedImageFile(params: {
  base64Data: string;
  mimeType: string;
  originalFileName: string;
}): Promise<
  | {
      ok: true;
      storagePath: string;
      publicUrl: string;
      mimeType: string;
      byteSize: number;
    }
  | { ok: false; error: string }
> {
  // Strip optional data URL prefix safely if client sends it
  const cleanedBase64 = params.base64Data.replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleanedBase64) {
    return { ok: false, error: 'Image file data is required.' };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleanedBase64, 'base64');
  } catch {
    return { ok: false, error: 'Invalid base64 image encoding.' };
  }

  const verified = detectImageExtensionFromMagicBytes(buffer, params.mimeType);
  if (!verified.valid || !verified.ext || !verified.mime) {
    return { ok: false, error: verified.error || 'Invalid image file.' };
  }

  const uploadDir = path.resolve(await ensureMediaUploadDir());
  const safeId = crypto.randomUUID();
  const filename = `${safeId}.${verified.ext}`;
  const fullPath = path.resolve(uploadDir, filename);
  if (!fullPath.startsWith(`${uploadDir}${path.sep}`)) {
    return { ok: false, error: 'Invalid upload destination path.' };
  }

  await fs.writeFile(fullPath, buffer);

  return {
    ok: true,
    storagePath: filename,
    publicUrl: `/media/${filename}`,
    mimeType: verified.mime,
    byteSize: buffer.byteLength,
  };
}

export async function deleteUploadedImageFile(storagePath: string): Promise<void> {
  // Only delete files matching strict UUID.ext pattern inside upload directory
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(storagePath)) {
    return;
  }
  const uploadDir = path.resolve(getMediaUploadDir());
  const fullPath = path.resolve(uploadDir, path.basename(storagePath));
  if (!fullPath.startsWith(`${uploadDir}${path.sep}`)) {
    return;
  }
  try {
    await fs.unlink(fullPath);
  } catch {
    // Ignore missing file on disk so DB cleanup stays idempotent
  }
}

export async function findMediaReferences(
  db: DatabaseAdapter,
  mediaId: string,
  publicUrl: string | null
): Promise<string[]> {
  const refs: string[] = [];

  const gamesRes = await db.query<{ title: string }>(
    `SELECT title FROM public.games
     WHERE cover_media_id = $1 OR ($2::text IS NOT NULL AND cover_image_url = $2)`,
    [mediaId, publicUrl]
  );
  for (const row of gamesRes.rows) {
    refs.push(`Game: ${row.title}`);
  }

  const currenciesRes = await db.query<{ name: string }>(
    `SELECT name FROM public.currencies
     WHERE media_id = $1 OR ($2::text IS NOT NULL AND image_url = $2)`,
    [mediaId, publicUrl]
  );
  for (const row of currenciesRes.rows) {
    refs.push(`Currency: ${row.name}`);
  }

  const packagesRes = await db.query<{ name: string }>(
    `SELECT name FROM public.packages
     WHERE media_id = $1 OR ($2::text IS NOT NULL AND image_url = $2)`,
    [mediaId, publicUrl]
  );
  for (const row of packagesRes.rows) {
    refs.push(`Package: ${row.name}`);
  }

  const settingsRes = await db.query<{ setting_value: { storeLogoUrl?: string } | null }>(
    `SELECT setting_value FROM public.website_settings WHERE setting_key = 'storefront_identity' LIMIT 1`
  );
  const logoUrl = settingsRes.rows[0]?.setting_value?.storeLogoUrl;
  if (publicUrl && logoUrl && logoUrl === publicUrl) {
    refs.push('Website Settings: Store Logo');
  }

  return refs;
}
