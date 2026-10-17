export const STORAGE_SIGNER = Symbol('STORAGE_SIGNER');
export const IMAGE_UPLOADER = Symbol('IMAGE_UPLOADER');

export interface SignedUploadParams {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/** Signs direct browser→storage uploads (admin product images). */
export interface StorageSigner {
  isConfigured(): boolean;
  signUpload(folder: string): SignedUploadParams;
}

export interface UploadedImage {
  url: string;
  /** Pixel size of the stored (largest) image, when the backend reports it. */
  width?: number;
  height?: number;
}

/** Server-side upload (customer exchange photos, admin direct uploads). */
export interface ImageUploader {
  isConfigured(): boolean;
  upload(file: { buffer: Buffer; mimetype: string; originalname?: string }, folder: string): Promise<UploadedImage>;
}

/** How the admin browser should upload: straight to Cloudinary (signed) or to our API (`POST /admin/uploads/image`). */
export type UploadMode = ({ mode: 'cloudinary' } & SignedUploadParams | { mode: 'direct' }) & { backgroundRemoval?: boolean };
