import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  type PresignUploadRequest,
  type PresignUploadResponse,
  type UploadPurpose,
} from '@payana/contracts';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { EXTENSIONS, OBJECT_STORAGE, matchesDeclaredType, type ObjectStorage } from './storage.port.js';

const UPLOAD_URL_TTL_SECONDS = 600;
/** Photos are public content; their links are long-lived so clients can cache them. */
const PUBLIC_URL_TTL_SECONDS = 7 * 86_400;
/** Verification documents are sensitive; their links expire quickly. */
const PRIVATE_URL_TTL_SECONDS = 300;

interface UploadRow {
  file_key: string;
  user_id: string;
  purpose: UploadPurpose;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date | null;
}

/**
 * Two-step uploads: the client asks for a slot (`presign`), PUTs the bytes
 * straight to storage, then names the `fileKey` in the request that attaches
 * the file. `claim` is where the server verifies the file really is what the
 * client said it would be.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly db: Db,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async presign(userId: string, input: PresignUploadRequest): Promise<PresignUploadResponse> {
    if (!(UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
      throw AppError.invalid('contentType', 'Only JPEG, PNG, WebP images and PDF files can be uploaded.');
    }
    if (input.sizeBytes > UPLOAD_MAX_BYTES) {
      throw AppError.invalid('sizeBytes', `Files can be at most ${Math.floor(UPLOAD_MAX_BYTES / 1_048_576)} MB.`);
    }
    const fileKey = `${input.purpose}/${userId}/${randomUUID()}.${EXTENSIONS[input.contentType]}`;
    await this.db.insert('uploads', {
      file_key: fileKey,
      user_id: userId,
      purpose: input.purpose,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
    });
    const { url, headers } = await this.storage.presignUpload({
      key: fileKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      fileKey,
      uploadUrl: url,
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Confirms that `fileKey` was issued to this user for this purpose and that
   * the uploaded bytes exist, fit the size limit and match the declared type.
   */
  async claim(userId: string, fileKey: string, purpose: UploadPurpose, field: string): Promise<{ contentType: string }> {
    const row = await this.db.one<UploadRow>(`SELECT * FROM uploads WHERE file_key = $1`, [fileKey]);
    if (!row || row.user_id !== userId || row.purpose !== purpose) {
      throw AppError.invalid(field, 'This file reference is not valid. Upload the file again.');
    }
    if (!row.uploaded_at) {
      const found = await this.storage.inspect(fileKey, 16);
      if (!found) throw AppError.invalid(field, 'The file has not finished uploading. Upload it again.');
      if (found.sizeBytes > UPLOAD_MAX_BYTES || !matchesDeclaredType(row.content_type, found.head)) {
        await this.storage.delete(fileKey).catch(() => undefined);
        await this.db.exec(`DELETE FROM uploads WHERE file_key = $1`, [fileKey]);
        throw AppError.invalid(field, 'The uploaded file is not a valid image or PDF.');
      }
      await this.db.exec(`UPDATE uploads SET uploaded_at = now(), size_bytes = $2 WHERE file_key = $1`, [
        fileKey,
        found.sizeBytes,
      ]);
    }
    return { contentType: row.content_type };
  }

  /** Long-lived link for public content (vehicle and profile photos). */
  async publicUrl(fileKey: string | null | undefined): Promise<string | null> {
    if (!fileKey) return null;
    return this.storage.signedDownloadUrl(fileKey, contentTypeOf(fileKey), PUBLIC_URL_TTL_SECONDS);
  }

  async publicUrls(fileKeys: string[]): Promise<string[]> {
    return Promise.all(fileKeys.map((k) => this.storage.signedDownloadUrl(k, contentTypeOf(k), PUBLIC_URL_TTL_SECONDS)));
  }

  /** Short-lived link for sensitive content (verification documents). */
  async privateUrl(fileKey: string, contentType: string): Promise<string> {
    return this.storage.signedDownloadUrl(fileKey, contentType, PRIVATE_URL_TTL_SECONDS);
  }

  async remove(fileKey: string): Promise<void> {
    await this.storage.delete(fileKey).catch(() => undefined);
    await this.db.exec(`DELETE FROM uploads WHERE file_key = $1`, [fileKey]);
  }
}

function contentTypeOf(fileKey: string): string {
  const ext = fileKey.slice(fileKey.lastIndexOf('.') + 1);
  return Object.entries(EXTENSIONS).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
}
