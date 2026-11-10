import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import {
  ApiRoutes,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UPLOAD_MAX_BYTES,
  UploadPurpose,
  type PresignUploadRequest,
  type PresignUploadResponse,
} from '@payana/contracts';
import { IsEnum, IsIn, IsInt, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../../../common/auth/auth.types.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { OBJECT_STORAGE, matchesDeclaredType, type ObjectStorage } from '../application/storage.port.js';
import { UploadsService } from '../application/uploads.service.js';
import { LocalDiskStorage } from '../infrastructure/storage.adapters.js';

class PresignUploadDto implements PresignUploadRequest {
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;

  @IsIn([...UPLOAD_ALLOWED_CONTENT_TYPES])
  contentType!: (typeof UPLOAD_ALLOWED_CONTENT_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(UPLOAD_MAX_BYTES)
  sizeBytes!: number;
}

async function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) throw AppError.invalid('file', 'The file is larger than the size that was declared.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

@ApiTags('uploads')
@Controller()
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Post(ApiRoutes.uploads.presign)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Get a one-time URL to upload a file to', body: 'PresignUploadRequest', response: 'PresignUploadResponse' })
  presign(@CurrentUser() user: AuthUser, @Body() body: PresignUploadDto): Promise<PresignUploadResponse> {
    return this.uploads.presign(user.id, body);
  }

  /**
   * Local-disk adapter only. Authorised by the signed token in the URL (the
   * same model as an S3 presigned PUT), so it carries no bearer token.
   */
  @Public()
  @Put(r(ApiRoutes.uploads.localPut(':token')))
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async localPut(@Param('token') token: string, @Req() req: Request): Promise<void> {
    const local = this.local();
    const claim = local.verifyUploadToken(token);
    if (!claim) throw AppError.forbidden('This upload link is invalid or has expired.');
    if ((req.headers['content-type'] ?? '').split(';')[0]!.trim() !== claim.ct) {
      throw AppError.invalid('Content-Type', `Send the file with Content-Type: ${claim.ct}.`);
    }
    const data = await readBody(req, claim.sz);
    if (data.length === 0) throw AppError.invalid('file', 'The file is empty.');
    if (!matchesDeclaredType(claim.ct, data.subarray(0, 16))) {
      throw AppError.invalid('file', 'The file content does not match its declared type.');
    }
    await local.write(claim.k, data);
  }

  /** Local-disk adapter only. Serves a file to the holder of a signed, expiring link. */
  @Public()
  @Get(r(ApiRoutes.uploads.file(':token')))
  @ApiExcludeEndpoint()
  async file(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const local = this.local();
    const claim = local.verifyDownloadToken(token);
    if (!claim) throw AppError.forbidden('This file link is invalid or has expired.');
    const found = await local.read(claim.k);
    if (!found) throw AppError.notFound('File');
    res.setHeader('Content-Type', claim.ct);
    res.setHeader('Content-Length', String(found.sizeBytes));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Uploaded content is never allowed to run script or be framed by other origins.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    found.stream.pipe(res);
  }

  private local(): LocalDiskStorage {
    if (!(this.storage instanceof LocalDiskStorage)) throw AppError.notFound('Route');
    return this.storage;
  }
}
