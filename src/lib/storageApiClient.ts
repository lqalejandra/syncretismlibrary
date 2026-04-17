import type { Piece } from '../types';

type PresignUploadRequest = {
  fileName: string;
  contentType: string;
};

type PresignUploadResponse = {
  uploadUrl: string;
  key: string;
  publicUrl?: string;
  expiresInSeconds: number;
  headers?: Record<string, string>;
};

const storageApiBase = import.meta.env.VITE_STORAGE_API_BASE_URL?.replace(/\/$/, '');
const storageApiKey = import.meta.env.VITE_STORAGE_API_KEY;
const cloudfrontBase = import.meta.env.VITE_AWS_CLOUDFRONT_URL?.replace(/\/$/, '');
const s3PublicBase = import.meta.env.VITE_AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, '');

function getPublicBaseUrl(): string | undefined {
  return cloudfrontBase ?? s3PublicBase;
}

function buildApiUrl(path: string): string {
  if (!storageApiBase) {
    throw new Error('Missing VITE_STORAGE_API_BASE_URL');
  }
  return `${storageApiBase}${path}`;
}

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  };

  if (storageApiKey) {
    headers['x-storage-api-key'] = storageApiKey;
  }

  return headers;
}

function normalizeS3Key(rawKey: string): string {
  return rawKey.replace(/^\/+/, '');
}

export function getPublicUrlForKey(key: string): string | undefined {
  const base = getPublicBaseUrl();
  if (!base) return undefined;
  return `${base}/${normalizeS3Key(key)}`;
}

export function resolvePieceImageSource(piece: Piece): string | undefined {
  if (piece.inputImageDataURL) return piece.inputImageDataURL;
  if (piece.inputImageURL) return piece.inputImageURL;
  if (piece.inputImageStorageKey) {
    return getPublicUrlForKey(piece.inputImageStorageKey);
  }
  return undefined;
}

export async function uploadImageFile(file: File): Promise<{
  key: string;
  publicUrl?: string;
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are supported.');
  }

  const body: PresignUploadRequest = {
    fileName: file.name,
    contentType: file.type,
  };

  const presignRes = await fetch(buildApiUrl('/api/storage/upload-url'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (!presignRes.ok) {
    const message = await presignRes.text();
    throw new Error(
      `Failed to request upload URL (${presignRes.status}): ${message}`
    );
  }

  const presigned = (await presignRes.json()) as PresignUploadResponse;
  const uploadHeaders: Record<string, string> = {
    'Content-Type': file.type,
    ...(presigned.headers ?? {}),
  };

  const uploadRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: file,
  });

  if (!uploadRes.ok) {
    const message = await uploadRes.text();
    throw new Error(`S3 upload failed (${uploadRes.status}): ${message}`);
  }

  return {
    key: presigned.key,
    publicUrl: presigned.publicUrl ?? getPublicUrlForKey(presigned.key),
  };
}

export async function deleteImageByStorageKey(key: string): Promise<void> {
  if (!storageApiBase || !key) {
    return;
  }

  const res = await fetch(buildApiUrl('/api/storage/delete'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ key }),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`Failed to delete image from S3 (${res.status}): ${message}`);
  }
}
