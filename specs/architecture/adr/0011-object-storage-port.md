# ADR-0011 — Object-storage port (local disk in development, S3 in production)

*Status: accepted · 2026-11-10 · Source: brief §4 ("S3-compatible object storage for vehicle photos, documents")*

## Context

Partners upload identity and vehicle documents (sensitive) and photos
(public once listed). Files should not pass through API memory on a weak
mobile connection, must be private by default, and administrators need
time-limited access to documents. Developers need this to work without cloud
credentials, and an extra S3-emulator container is one more moving part for
everyday development than the job requires.

## Decision

1. Define a **`FileStorage` port** in `platform`:
   `presignUpload(key, contentType, maxBytes, ttl)`,
   `presignDownload(key, ttl)`, `head(key)`, `read(key, range)`,
   `delete(key)`.
2. **S3 adapter** (production, staging): private bucket, SSE, versioning,
   public access blocked; clients `PUT` directly to a presigned URL and
   administrators read through presigned `GET` URLs (≤ 5 min).
3. **Local-disk adapter** (development default): files under
   `apps/api/.storage`; "presigned" URLs are HMAC-signed, expiring tokens
   served by the API itself (`PUT /uploads/local/{token}`,
   `GET /files/{token}`). The contract (`PresignUploadResponse`) is identical,
   so clients cannot tell the difference.
4. An optional MinIO service sits behind a Docker Compose profile for
   exercising the S3 adapter locally; it is not required.
5. Keys are server-generated, unguessable and namespaced by purpose and
   owner (`driver_document/<profileId>/<uuid>`). The client receives an
   opaque `fileKey`, bound to the requesting user and `UploadPurpose`.
6. Attaching a key (document, vehicle photo, profile photo) verifies
   ownership, existence, size ≤ `UPLOAD_MAX_BYTES`, declared type in
   `UPLOAD_ALLOWED_CONTENT_TYPES`, and magic bytes.
7. Public photos are exposed through a URL the API controls (signed with a
   long TTL or proxied via CDN) so a listing can be withdrawn; document files
   are **never** public.
8. Orphaned uploads (presigned but never attached) are purged daily.
9. Production start-up refuses the local-disk adapter.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Upload through the API (multipart) | Ties up API memory and time on slow links; larger attack surface; harder limits |
| Store files in PostgreSQL | Bloats backups and the primary database |
| MinIO mandatory for local development | An extra container (and image pin to maintain) for something a small adapter covers; kept as an optional profile |
| Public bucket with obscure URLs | Documents are sensitive personal data; obscurity is not access control |

## Consequences

- **Good**: one contract, two adapters; no cloud needed to develop; documents
  private end to end.
- **Cost**: the local adapter adds two routes that exist only in development
  (`uploads.localPut`, `uploads.file` in `ApiRoutes`); they are disabled when
  the S3 adapter is active.
- **Gap**: malware scanning of uploads is not in R1 (NFR-SEC-008); documents
  are opened only by staff in a browser viewer — scan-on-upload (for example
  with a Lambda) is an R1.1 item.
- **Privacy**: retention and deletion of document objects follow
  NFR-PRIV-003 and account erasure; bucket versioning needs a lifecycle rule
  so "deleted" really expires.
