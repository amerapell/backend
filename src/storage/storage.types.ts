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

/** Server-side upload (customer exchange photos). */
export interface ImageUploader {
  isConfigured(): boolean;
  upload(file: { buffer: Buffer; mimetype: string; originalname?: string }, folder: string): Promise<{ url: string }>;
}
