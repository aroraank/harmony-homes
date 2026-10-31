import { supabase, AppError, VIEW_ONLY_MESSAGE } from './supabase';
import { isViewingAs } from './viewAsState';

export const BUCKET = 'attachments';
// Receipts and payment proofs only need to be legible, not high-resolution — keeping uploads in the
// low hundreds of KB (instead of MB) means the free 1 GB Supabase storage bucket lasts for years of
// a 30-flat society's claims, concerns and expense proofs instead of filling up in months.
export const MAX_FILE_BYTES = 600 * 1024; // images, after on-device compression
export const MAX_PDF_BYTES = 1.5 * 1024 * 1024; // PDFs aren't compressed, so they get a bit more room
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export type UploadKind = 'claims' | 'concerns' | 'ledger' | 'notices' | 'settings' | 'events';

export function validateFile(f: File, opts: { imagesOnly?: boolean; maxBytes?: number } = {}): string | null {
  const isPdf = f.type === 'application/pdf';
  const max = opts.maxBytes ?? (isPdf ? MAX_PDF_BYTES : MAX_FILE_BYTES);
  const allowed = opts.imagesOnly ? ALLOWED.filter((t) => t.startsWith('image/')) : ALLOWED;
  if (!allowed.includes(f.type))
    return opts.imagesOnly ? 'Choose a JPG or PNG image.' : 'Choose an image (JPG/PNG) or a PDF.';
  if (f.size > max * 8 && f.type.startsWith('image/') && f.type !== 'image/heic' && f.type !== 'image/heif')
    return null; // will be compressed
  if (f.size > max) {
    const label =
      max >= 1024 * 1024 ? `${(max / 1024 / 1024).toFixed(1)} MB` : `${Math.round(max / 1024)} KB`;
    return isPdf
      ? `PDF is too large (max ${label}). Try a photo of the receipt instead — it compresses automatically.`
      : `File is too large (max ${label}).`;
  }
  return null;
}

/** Phone photos are often 4–8 MB; shrink to ≤1280px JPEG before upload to keep it in the low hundreds
 *  of KB — plenty to read a receipt, a tiny fraction of the storage a full-resolution photo would use. */
async function compressImage(f: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size < 250 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    // Re-encode at shrinking quality until it fits comfortably under the cap, or we run out of tries.
    let blob: Blob | null = null;
    for (const q of [0.78, 0.65, 0.5, 0.38]) {
      blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, f.type === 'image/png' ? 'image/png' : 'image/jpeg', q),
      );
      if (blob && blob.size <= MAX_FILE_BYTES) break;
    }
    return blob && blob.size < f.size ? blob : f;
  } catch {
    return f;
  }
}

/**
 * Upload under {society}/{kind}/{folder}/{uuid}.ext — folder rules are enforced by storage RLS:
 *  claims/{userId}, concerns/new-{userId} or concerns/{concernId}, ledger/…, notices/…, settings/…
 */
export async function uploadFile(
  societyId: string,
  kind: UploadKind,
  folder: string,
  file: File,
): Promise<string> {
  if (isViewingAs()) throw new AppError(VIEW_ONLY_MESSAGE, '42501');
  const err = validateFile(file);
  if (err) throw new AppError(err);
  const body = await compressImage(file);
  const bodyMax = body.type === 'application/pdf' ? MAX_PDF_BYTES : MAX_FILE_BYTES;
  if (body.size > bodyMax) {
    const label =
      bodyMax >= 1024 * 1024
        ? `${(bodyMax / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(bodyMax / 1024)} KB`;
    throw new AppError(`File is too large (max ${label}).`);
  }
  const ext =
    body.type === 'application/pdf'
      ? 'pdf'
      : body.type === 'image/png'
        ? 'png'
        : body.type.includes('heic') || body.type.includes('heif')
          ? 'heic'
          : body.type === 'image/webp'
            ? 'webp'
            : 'jpg';
  const path = `${societyId}/${kind}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: body.type, upsert: false });
  if (error)
    throw new AppError(
      error.message.includes('row-level security') ? 'You are not allowed to upload here.' : error.message,
    );
  return path;
}

const urlCache = new Map<string, { url: string; at: number }>();

export async function signedUrl(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new AppError('Could not open the file.');
  urlCache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

export async function openAttachment(path: string): Promise<void> {
  // open the tab synchronously (inside the tap) so pop-up blockers allow it, then point it at the signed URL
  const w = window.open('', '_blank');
  if (w) w.opener = null;
  try {
    const url = await signedUrl(path);
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}
