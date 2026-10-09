import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getAdminBucket } from '../lib/firebaseAdmin';

/** Decoded size cap for a checkout prescription upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** Parses `data:<mime>;base64,<data>`; null when the type is not allowed or the data is not base64. */
export function parseDataUrl(dataUrl: unknown): { mime: string; ext: string; bytes: Buffer } | null {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_TYPES[mime];
  if (!ext) return null;
  return { mime, ext, bytes: Buffer.from(match[2], 'base64') };
}

/**
 * POST /api/public/upload
 * Body: { dataUrl: "data:image/webp;base64,...", type?: "prescription" }
 * Stores a checkout prescription photo/PDF in Firebase Storage under `rx-uploads/` and returns a
 * download URL with an unguessable token (the bucket stays private). The URL is saved on the order.
 */
export const uploadPrescription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = parseDataUrl((req.body as { dataUrl?: unknown })?.dataUrl);
    if (!file) {
      res.status(400).json({ success: false, message: 'Send a JPG, PNG, WebP or PDF file.' });
      return;
    }
    if (file.bytes.length === 0 || file.bytes.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ success: false, message: 'File must be under 5 MB.' });
      return;
    }

    const bucket = getAdminBucket();
    if (!bucket) {
      res.status(503).json({ success: false, message: 'Uploads are unavailable right now.' });
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const path = `rx-uploads/${day}/${crypto.randomUUID()}.${file.ext}`;
    const downloadToken = crypto.randomUUID();
    await bucket.file(path).save(file.bytes, {
      contentType: file.mime,
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    res.json({ success: true, data: { url } });
  } catch (err) {
    next(err);
  }
};
