/** Object storage for uploads. Local disk in development, any S3-compatible bucket otherwise. */
export interface ObjectStorage {
  /** Where and how the client should PUT the bytes for `key`. */
  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  /** A time-limited URL from which the object can be read. */
  signedDownloadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Size in bytes and the first bytes of the object, or null when it has not been uploaded. */
  inspect(key: string, headBytes: number): Promise<{ sizeBytes: number; head: Buffer } | null>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'application/pdf': (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
};

/** True when the file's leading bytes are what its declared content type says they should be. */
export function matchesDeclaredType(contentType: string, head: Buffer): boolean {
  const check = SIGNATURES[contentType];
  return check ? check(head) : false;
}

export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
