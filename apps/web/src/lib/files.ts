import { supabase, AppError, VIEW_ONLY_MESSAGE } from './supabase';
import { isViewingAs } from './viewAsState';

export const BUCKET = 'attachments';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export type UploadKind = 'claims' | 'concerns' | 'ledger' | 'notices' | 'settings';

export function validateFile(f: File, opts: { imagesOnly?: boolean; maxBytes?: number } = {}): string | null {
  const max = opts.maxBytes ?? MAX_FILE_BYTES;
  const allowed = opts.imagesOnly ? ALLOWED.filter((t) => t.startsWith('image/')) : ALLOWED;
  if (!allowed.includes(f.type)) return opts.imagesOnly ? 'Choose a JPG or PNG image.' : 'Choose an image (JPG/PNG) or a PDF.';
  if (f.size > max * 3 && f.type.startsWith('image/') && f.type !== 'image/heic' && f.type !== 'image/heif') return null; // will be compressed
  if (f.size > max) return `File is too large (max ${Math.round(max / 1024 / 1024)} MB).`;
  return null;
}

/** Phone photos are often 4–8 MB; shrink to ≤1600px JPEG before upload to save data. */
async function compressImage(f: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size < 600 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.82));
    return blob && blob.size < f.size ? blob : f;
  } catch {
    return f;
  }
}

/**
 * Upload under {society}/{kind}/{folder}/{uuid}.ext — folder rules are enforced by storage RLS:
 *  claims/{userId}, concerns/new-{userId} or concerns/{concernId}, ledger/…, notices/…, settings/…
 */
export async function uploadFile(societyId: string, kind: UploadKind, folder: string, file: File): Promise<string> {
  if (isViewingAs()) throw new AppError(VIEW_ONLY_MESSAGE, '42501');
  const err = validateFile(file);
  if (err) throw new AppError(err);
  const body = await compressImage(file);
  if (body.size > MAX_FILE_BYTES) throw new AppError('File is too large (max 5 MB).');
  const ext = body.type === 'application/pdf' ? 'pdf' : body.type === 'image/png' ? 'png' : body.type.includes('heic') || body.type.includes('heif') ? 'heic' : body.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${societyId}/${kind}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: body.type, upsert: false });
  if (error) throw new AppError(error.message.includes('row-level security') ? 'You are not allowed to upload here.' : error.message);
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
