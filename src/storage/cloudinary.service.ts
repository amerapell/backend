import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { AppConfig } from '../config/app-config';
import { signCloudinaryParams } from './cloudinary-signature';
import type { ImageUploader, SignedUploadParams, StorageSigner, UploadedImage } from './storage.types';

@Injectable()
export class CloudinaryStorage implements StorageSigner, ImageUploader {
  constructor(private readonly config: AppConfig) {
    const { cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret } = config.values;
    if (cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret) {
      cloudinary.config({ cloud_name: cloudinaryCloudName, api_key: cloudinaryApiKey, api_secret: cloudinaryApiSecret, secure: true });
    }
  }

  isConfigured(): boolean {
    const v = this.config.values;
    return !!(v.cloudinaryCloudName && v.cloudinaryApiKey && v.cloudinaryApiSecret);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new ServiceUnavailableException('Image storage is not configured');
  }

  signUpload(folder: string): SignedUploadParams {
    this.assertConfigured();
    const v = this.config.values;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams({ folder, timestamp }, v.cloudinaryApiSecret as string);
    return { cloudName: v.cloudinaryCloudName as string, apiKey: v.cloudinaryApiKey as string, timestamp, signature, folder };
  }

  upload(file: { buffer: Buffer; mimetype: string }, folder: string): Promise<UploadedImage> {
    this.assertConfigured();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (err?: unknown, res?: UploadApiResponse) => {
          if (err || !res) {
            // Cloudinary reports failures as plain objects ({ message, http_code }), not Errors — keep its reason.
            const reason = err instanceof Error ? err.message : (err as { message?: string } | undefined)?.message;
            return reject(new BadGatewayException(`Cloudinary refused the upload${reason ? `: ${reason}` : ''}`));
          }
          resolve({ url: res.secure_url, width: res.width, height: res.height });
        },
      );
      stream.end(file.buffer);
    });
  }
}
