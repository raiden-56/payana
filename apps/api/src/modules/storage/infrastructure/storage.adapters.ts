import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { API_PREFIX, ApiRoutes } from '@payana/contracts';
import { signPayload, verifyPayload } from '../../../common/crypto.js';
import type { AppConfig } from '../../../config/env.js';
import type { ObjectStorage } from '../application/storage.port.js';

export interface LocalUploadToken {
  k: string;
  ct: string;
  sz: number;
  op: 'put';
  exp: number;
}
export interface LocalDownloadToken {
  k: string;
  ct: string;
  op: 'get';
  exp: number;
}

/**
 * Development adapter: files live under STORAGE_LOCAL_DIR and are reached
 * through signed, expiring URLs served by this API. Behaves like the S3
 * adapter from the client's point of view (presign, PUT, signed GET).
 */
export class LocalDiskStorage implements ObjectStorage {
  constructor(private readonly config: AppConfig) {}

  async presignUpload(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }) {
    const token = signPayload(
      { k: input.key, ct: input.contentType, sz: input.sizeBytes, op: 'put', exp: Date.now() + input.expiresInSeconds * 1000 } satisfies LocalUploadToken,
      this.config.auth.signingSecret,
    );
    return {
      url: `${this.config.publicApiUrl}${API_PREFIX}${ApiRoutes.uploads.localPut(token)}`,
      headers: { 'Content-Type': input.contentType },
    };
  }

  async signedDownloadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const token = signPayload(
      { k: key, ct: contentType, op: 'get', exp: Date.now() + expiresInSeconds * 1000 } satisfies LocalDownloadToken,
      this.config.auth.signingSecret,
    );
    return `${this.config.publicApiUrl}${API_PREFIX}${ApiRoutes.uploads.file(token)}`;
  }

  async inspect(key: string, headBytes: number): Promise<{ sizeBytes: number; head: Buffer } | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      const handle = await open(path, 'r');
      try {
        const head = Buffer.alloc(Math.min(headBytes, info.size));
        await handle.read(head, 0, head.length, 0);
        return { sizeBytes: info.size, head };
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  // --- used by the local upload / download routes -------------------------------

  verifyUploadToken(token: string): LocalUploadToken | null {
    const p = verifyPayload<LocalUploadToken>(token, this.config.auth.signingSecret);
    return p && p.op === 'put' ? p : null;
  }

  verifyDownloadToken(token: string): LocalDownloadToken | null {
    const p = verifyPayload<LocalDownloadToken>(token, this.config.auth.signingSecret);
    return p && p.op === 'get' ? p : null;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(key: string): Promise<{ stream: Readable; sizeBytes: number } | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return { stream: createReadStream(path), sizeBytes: info.size };
    } catch {
      return null;
    }
  }

  /** Resolves a key inside the storage root and refuses anything that escapes it. */
  private pathFor(key: string): string {
    const root = resolve(this.config.storage.localDir);
    const path = resolve(join(root, key));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Invalid storage key');
    return path;
  }
}

/** S3 (or any S3-compatible service such as MinIO, R2, Spaces) through presigned URLs. */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const s3 = config.storage.s3;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region,
      ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
      forcePathStyle: s3.forcePathStyle,
      // With no explicit keys the SDK falls back to the task / instance role.
      ...(s3.accessKeyId && s3.secretAccessKey
        ? { credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey } }
        : {}),
    });
  }

  async presignUpload(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      ServerSideEncryption: 'AES256',
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': input.contentType, 'x-amz-server-side-encryption': 'AES256' } };
  }

  async signedDownloadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: 'inline',
    });
    return getSignedUrl(this.client, command, { expiresIn: Math.min(expiresInSeconds, 604_800) });
  }

  async inspect(key: string, headBytes: number): Promise<{ sizeBytes: number; head: Buffer } | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${headBytes - 1}` }),
      );
      const head = Buffer.from(await out.Body!.transformToByteArray());
      const total = out.ContentRange ? Number(out.ContentRange.split('/')[1]) : (out.ContentLength ?? head.length);
      return { sizeBytes: total, head };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 416) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
