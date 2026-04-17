import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET;

const AWS_REGION = process.env.AWS_REGION;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_S3_PREFIX = (process.env.AWS_S3_PREFIX ?? 'uploads/migrated').replace(
  /^\/+|\/+$/g,
  ''
);
const AWS_S3_PUBLIC_BASE_URL = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
const AWS_CLOUDFRONT_URL = process.env.AWS_CLOUDFRONT_URL?.replace(/\/$/, '');
const OUTPUT_FILE = process.env.MIGRATION_OUTPUT_FILE ?? 's3-migration-map.json';
const APPLY_DB_UPDATES = process.argv.includes('--apply-db-updates');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (!AWS_REGION || !AWS_S3_BUCKET) {
  throw new Error('Missing AWS_REGION or AWS_S3_BUCKET');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const s3 = new S3Client({ region: AWS_REGION });

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  return {
    mimeType,
    buffer: Buffer.from(base64, 'base64'),
  };
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'bin';
}

function getPublicUrlForKey(key) {
  const base = AWS_CLOUDFRONT_URL || AWS_S3_PUBLIC_BASE_URL;
  return base ? `${base}/${key}` : null;
}

async function fetchBytesFromSupabasePath(path) {
  if (!SUPABASE_STORAGE_BUCKET) {
    throw new Error(
      'SUPABASE_STORAGE_BUCKET is required when migrating storage paths.'
    );
  }
  const { data, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Unable to create signed URL');
  }

  const response = await fetch(data.signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to download source object (${response.status})`);
  }
  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return {
    mimeType,
    buffer: Buffer.from(arrayBuffer),
  };
}

async function fetchBytesFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download source URL (${response.status})`);
  }
  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return {
    mimeType,
    buffer: Buffer.from(arrayBuffer),
  };
}

async function uploadToS3({ pieceId, mimeType, buffer }) {
  const extension = extensionFromMimeType(mimeType);
  const key = `${AWS_S3_PREFIX}/${pieceId}.${extension}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );
  return {
    key,
    publicUrl: getPublicUrlForKey(key),
  };
}

function deriveSource(payload) {
  if (typeof payload.inputImageDataURL === 'string' && payload.inputImageDataURL.startsWith('data:')) {
    return {
      type: 'data-url',
      value: payload.inputImageDataURL,
    };
  }

  if (typeof payload.inputImagePath === 'string' && payload.inputImagePath) {
    return {
      type: 'supabase-path',
      value: payload.inputImagePath,
    };
  }

  if (typeof payload.inputImageURL === 'string' && payload.inputImageURL.includes('supabase')) {
    return {
      type: 'supabase-url',
      value: payload.inputImageURL,
    };
  }

  return null;
}

async function run() {
  const { data, error } = await supabase
    .from('pieces')
    .select('id, payload')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const mappings = [];
  const failures = [];

  for (const row of data ?? []) {
    const pieceId = row.id;
    const payload = row.payload ?? {};
    const source = deriveSource(payload);
    if (!source) continue;

    try {
      let sourceObject;
      if (source.type === 'data-url') {
        sourceObject = parseDataUrl(source.value);
        if (!sourceObject) {
          throw new Error('Invalid data URL');
        }
      } else if (source.type === 'supabase-path') {
        sourceObject = await fetchBytesFromSupabasePath(source.value);
      } else {
        sourceObject = await fetchBytesFromUrl(source.value);
      }

      const uploaded = await uploadToS3({
        pieceId,
        mimeType: sourceObject.mimeType,
        buffer: sourceObject.buffer,
      });

      const mapping = {
        pieceId,
        sourceType: source.type,
        sourceValue: source.value,
        s3Key: uploaded.key,
        s3PublicUrl: uploaded.publicUrl,
      };
      mappings.push(mapping);

      if (APPLY_DB_UPDATES) {
        const nextPayload = {
          ...payload,
          inputImageStorageKey: uploaded.key,
          inputImageURL: uploaded.publicUrl ?? undefined,
          inputImageDataURL:
            source.type === 'data-url' ? undefined : payload.inputImageDataURL,
        };
        const { error: updateError } = await supabase
          .from('pieces')
          .update({ payload: nextPayload })
          .eq('id', pieceId);
        if (updateError) {
          throw new Error(updateError.message);
        }
      }
    } catch (migrationError) {
      failures.push({
        pieceId,
        sourceType: source.type,
        sourceValue: source.value,
        error:
          migrationError instanceof Error
            ? migrationError.message
            : String(migrationError),
      });
    }
  }

  const report = {
    totalRows: (data ?? []).length,
    migrated: mappings.length,
    failed: failures.length,
    applyDbUpdates: APPLY_DB_UPDATES,
    mappings,
    failures,
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Migration finished. Wrote report to ${OUTPUT_FILE}`);
  console.log(
    `Migrated: ${report.migrated}, Failed: ${report.failed}, Total rows: ${report.totalRows}`
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
