import { Global, Module } from '@nestjs/common';
import { CloudinaryStorage } from './cloudinary.service';
import { IMAGE_UPLOADER, STORAGE_SIGNER } from './storage.types';

@Global()
@Module({
  providers: [
    CloudinaryStorage,
    { provide: STORAGE_SIGNER, useExisting: CloudinaryStorage },
    { provide: IMAGE_UPLOADER, useExisting: CloudinaryStorage },
  ],
  exports: [STORAGE_SIGNER, IMAGE_UPLOADER],
})
export class StorageModule {}
