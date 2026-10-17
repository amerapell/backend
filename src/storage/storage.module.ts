import { Global, Logger, Module } from '@nestjs/common';
import { CloudinaryStorage } from './cloudinary.service';
import { DatabaseImageStorage } from './database-image.storage';
import { ImageProcessor } from './image-processor';
import { MediaController } from './media.controller';
import { DrizzleMediaRepository, MEDIA_REPOSITORY } from './media.repository';
import { selectImageUploader } from './storage.selector';
import { IMAGE_UPLOADER, STORAGE_SIGNER } from './storage.types';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    CloudinaryStorage,
    ImageProcessor,
    DatabaseImageStorage,
    { provide: MEDIA_REPOSITORY, useClass: DrizzleMediaRepository },
    // Signing is Cloudinary-only; callers check isConfigured() and fall back to direct upload.
    { provide: STORAGE_SIGNER, useExisting: CloudinaryStorage },
    // Server-side uploads (admin direct upload, exchange photos): Cloudinary when configured, else built-in storage.
    {
      provide: IMAGE_UPLOADER,
      inject: [CloudinaryStorage, DatabaseImageStorage],
      useFactory: (cloudinary: CloudinaryStorage, builtIn: DatabaseImageStorage) => selectImageUploader(cloudinary, builtIn, new Logger('Storage')),
    },
  ],
  exports: [STORAGE_SIGNER, IMAGE_UPLOADER, MEDIA_REPOSITORY],
})
export class StorageModule {}
