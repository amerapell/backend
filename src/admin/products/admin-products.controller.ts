import { BadRequestException, Body, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { ProductStatus } from '../../common/contract';
import { parsePage } from '../../common/pagination';
import { BackgroundRemover, CutoutLayout } from '../../storage/background-remover';
import { MAX_UPLOAD_BYTES } from '../../storage/image-processor';
import { IMAGE_UPLOADER, ImageUploader, STORAGE_SIGNER, StorageSigner, UploadMode } from '../../storage/storage.types';
import { AdminController } from '../admin-controller.decorator';
import { AdminProductsService } from './admin-products.service';
import { CollectionDto, CreateProductDto, UpdateCollectionDto, UpdateProductDto, UpdateVariantDto } from './admin-products.dto';

const STATUSES: ProductStatus[] = ['DRAFT', 'LIVE', 'ARCHIVED'];

@AdminController('products')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    if (status && !STATUSES.includes(status as ProductStatus)) throw new BadRequestException('Invalid status');
    const p = parsePage(page, pageSize, 50, 200);
    return this.products.list(q?.trim() || undefined, status as ProductStatus | undefined, p.page, p.pageSize);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  /** DELETE = archive (order history keeps referencing the product). */
  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.products.archive(id);
  }
}

@AdminController('variants')
export class AdminVariantsController {
  constructor(private readonly products: AdminProductsService) {}

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }
}

@AdminController('stock')
export class AdminStockController {
  constructor(private readonly products: AdminProductsService) {}

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="amerapelle-stock-${new Date().toISOString().slice(0, 10)}.csv"`);
    return this.products.exportStockCsv();
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach a CSV as "file"');
    return this.products.importStockCsv(file.buffer.toString('utf8'));
  }
}

@AdminController('uploads')
export class AdminUploadsController {
  constructor(
    @Inject(STORAGE_SIGNER) private readonly signer: StorageSigner,
    @Inject(IMAGE_UPLOADER) private readonly uploader: ImageUploader,
    private readonly remover: BackgroundRemover,
  ) {}

  /**
   * How the browser should upload a product image. Cloudinary configured → `{ mode: 'cloudinary', ...signed params }`
   * for a direct browser→Cloudinary upload into amerapelle/products; otherwise `{ mode: 'direct' }` → POST /admin/uploads/image.
   */
  @Post('sign')
  @HttpCode(200)
  sign(): UploadMode {
    if (!this.signer.isConfigured()) return { mode: 'direct', backgroundRemoval: this.remover.isAvailable() };
    return { mode: 'cloudinary', ...this.signer.signUpload('amerapelle/products'), backgroundRemoval: this.remover.isAvailable() };
  }

  /**
   * Server-side product image upload (multipart field `file`) → `{ url, width, height }`.
   * `removeBackground=true` stores the cut-out on the stage ground instead (`layout` portrait 4:5 | landscape 3:2);
   * add `keepOriginal=true` to also store the untouched photo → `originalUrl`.
   */
  @Post('image')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1 } }))
  async image(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('removeBackground') removeBackground?: string,
    @Body('layout') layout?: string,
    @Body('keepOriginal') keepOriginal?: string,
  ) {
    if (!file) throw new BadRequestException('Attach an image as "file"');
    if (removeBackground !== 'true') {
      const { url, width, height } = await this.uploader.upload(file, 'amerapelle/products');
      return { url, width: width ?? null, height: height ?? null };
    }
    const shape: CutoutLayout = layout === 'landscape' ? 'landscape' : 'portrait';
    const cut = await this.remover.cutout(file.buffer, shape);
    const base = (file.originalname || 'photo').replace(/\.\w+$/, '');
    const stored = await this.uploader.upload({ buffer: cut, mimetype: 'image/jpeg', originalname: `${base}-cutout.jpg` }, 'amerapelle/products');
    const original = keepOriginal === 'true' ? await this.uploader.upload(file, 'amerapelle/products') : null;
    return { url: stored.url, width: stored.width ?? null, height: stored.height ?? null, originalUrl: original?.url ?? null };
  }
}

@AdminController('collections')
export class AdminCollectionsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  list() {
    return this.products.collections();
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CollectionDto) {
    return this.products.createCollection(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const all = await this.products.collections();
    const c = all.find((x) => x.id === id);
    if (!c) throw new NotFoundException('Collection not found');
    return c;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.products.updateCollection(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.deleteCollection(id);
  }
}
