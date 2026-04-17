import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PORT = Number(process.env.PORT ?? 8787);
const AWS_REGION = process.env.AWS_REGION;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_S3_PREFIX = (process.env.AWS_S3_PREFIX ?? 'uploads').replace(/^\/+|\/+$/g, '');
const AWS_S3_PUBLIC_BASE_URL = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
const AWS_CLOUDFRONT_URL = process.env.AWS_CLOUDFRONT_URL?.replace(/\/$/, '');
const STORAGE_API_KEY = process.env.STORAGE_API_KEY;
const PRESIGN_EXPIRES_SECONDS = Number(process.env.AWS_PRESIGN_EXPIRES_SECONDS ?? 60);
const allowedOriginsEnv =
  process.env.STORAGE_API_ALLOWED_ORIGINS ??
  process.env.STORAGE_API_ALLOWED_ORIGIN ??
  '*';
const ALLOWED_ORIGINS = allowedOriginsEnv
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS.includes('*');

if (!AWS_REGION || !AWS_S3_BUCKET) {
  throw new Error('Missing required env vars: AWS_REGION and AWS_S3_BUCKET');
}

const s3 = new S3Client({ region: AWS_REGION });

function resolveResponseOrigin(req) {
  if (ALLOW_ALL_ORIGINS) return '*';
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin === 'string' && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return ALLOWED_ORIGINS[0] ?? null;
}

function toJson(req, res, statusCode, payload) {
  const responseOrigin = resolveResponseOrigin(req);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'content-type,x-storage-api-key',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    Vary: 'Origin',
  };
  if (responseOrigin) {
    headers['Access-Control-Allow-Origin'] = responseOrigin;
  }

  res.writeHead(statusCode, {
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

function createObjectKey(fileName) {
  const safeName = sanitizeFileName(fileName || 'upload.bin');
  const dateSegment = new Date().toISOString().slice(0, 10);
  return `${AWS_S3_PREFIX}/${dateSegment}/${randomUUID()}-${safeName}`;
}

function getPublicUrlForKey(key) {
  const base = AWS_CLOUDFRONT_URL || AWS_S3_PUBLIC_BASE_URL;
  if (!base) return undefined;
  return `${base}/${key.replace(/^\/+/, '')}`;
}

function verifyApiKey(req, res) {
  if (!STORAGE_API_KEY) return true;
  const provided = req.headers['x-storage-api-key'];
  if (provided !== STORAGE_API_KEY) {
    toJson(req, res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      toJson(req, res, 204, {});
      return;
    }

    if (!verifyApiKey(req, res)) {
      return;
    }

    if (req.method === 'POST' && req.url === '/api/storage/upload-url') {
      const body = await parseJsonBody(req);
      const fileName = String(body.fileName ?? '');
      const contentType = String(body.contentType ?? '');

      if (!fileName || !contentType || !contentType.startsWith('image/')) {
        toJson(req, res, 400, {
          error: 'fileName and image/* contentType are required.',
        });
        return;
      }

      const key = createObjectKey(fileName);
      const putCommand = new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: key,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(s3, putCommand, {
        expiresIn: PRESIGN_EXPIRES_SECONDS,
      });

      toJson(req, res, 200, {
        uploadUrl,
        key,
        publicUrl: getPublicUrlForKey(key),
        expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/storage/delete') {
      const body = await parseJsonBody(req);
      const key = String(body.key ?? '').replace(/^\/+/, '');

      if (!key) {
        toJson(req, res, 400, { error: 'key is required.' });
        return;
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: AWS_S3_BUCKET,
          Key: key,
        })
      );

      toJson(req, res, 200, { ok: true });
      return;
    }

    toJson(req, res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toJson(req, res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Storage API listening on http://localhost:${PORT}`);
});
