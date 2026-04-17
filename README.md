# Syn·cre·tism Library

A single-page gallery for converting images or text into ASCII art or bitmap art, then storing them as browsable cards.

## Tech stack

- React + TypeScript
- Vite
- Tailwind CSS
- Supabase (database persistence)
- Amazon S3 (image object storage via presigned upload URLs)

## Environment setup

1) Copy `.env.example` to `.env` for client settings.  
2) Copy `.env.server.example` to `.env.server` for server-only settings.

Important: keep AWS credentials server-side only. Do not prefix AWS secret values with `VITE_`.

## Run locally

Terminal 1 (storage API):

```bash
npm run storage-api
```

Terminal 2 (frontend):

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` (or the URL Vite prints).

## Build

```bash
npm run build
```

## S3 upload flow

- Frontend requests a short-lived presigned URL from `POST /api/storage/upload-url`
- Browser uploads the file directly to S3 via `PUT`
- App stores `inputImageStorageKey` and optional `inputImageURL` in the piece payload
- Existing legacy records with `inputImageDataURL` still render
- Deletions call `POST /api/storage/delete` to remove S3 objects server-side

## One-time migration script

```bash
npm run migrate:supabase-images-to-s3
```

This uploads migratable image sources to S3 and writes a mapping report to `s3-migration-map.json` (or `MIGRATION_OUTPUT_FILE`).

To also write migrated keys/URLs back into Supabase payloads:

```bash
npm run migrate:supabase-images-to-s3 -- --apply-db-updates
```

## S3 checklist (beyond CORS)

1) Keep Block Public Access enabled on the bucket.  
2) Create an IAM policy for your storage API with scoped permissions:
   - `s3:PutObject`
   - `s3:DeleteObject`
   - optional `s3:GetObject` if you fetch from S3 directly
   - Resource: `arn:aws:s3:::<your-bucket>/<prefix>/*`
3) If using direct S3 URLs in the app, set `AWS_S3_PUBLIC_BASE_URL`/`VITE_AWS_S3_PUBLIC_BASE_URL`.
   If using CloudFront, set `AWS_CLOUDFRONT_URL`/`VITE_AWS_CLOUDFRONT_URL` instead.
4) Set lifecycle rule(s) if desired (for old uploads cleanup).
5) Verify uploads:
   - frontend `POST /api/storage/upload-url` returns `200`
   - browser `PUT` to signed URL returns `200`
   - object appears in S3 under `AWS_S3_PREFIX`
