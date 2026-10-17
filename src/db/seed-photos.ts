/*
 * `npm run seed:photos` — loads the placeholder looks in `assets/placeholders` into the built-in image store
 * and adds them to the shop. Runs once per database: a marker row in store_settings stops it repeating, so
 * anything the admin later edits or deletes stays that way. Railway runs it on every start (cheap no-op after
 * the first run).
 *
 * Each look has two photos: `<slug>-stage.jpg` (background removed, on the stage colour — the shop tile) and
 * `<slug>-worn.jpg` (the original in-store photo — shown on hover and second on the product page).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { and, eq, isNull, like, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadConfig } from '../config/app-config';
import { slugify } from '../common/ids';
import { nairaToKobo } from '../common/money';
import type { Colour } from '../common/contract';
import { generateVariantMatrix } from '../catalogue/variant-matrix';
import { ImageProcessor } from '../storage/image-processor';
import { MEDIA_PATH } from '../storage/database-image.storage';
import { createPool } from './database.module';
import * as schema from './schema';
import { DROP_SLUG } from './seed-data';
import { DEFAULT_SETTINGS } from '../settings/settings.types';

const MARKER_ID = 'seed:placeholder-photos-v1';
const HIDE_MARKER_ID = 'seed:hide-photoless-v1';
const SIMPLIFY_MARKER_ID = 'seed:simplify-v1';
const STORE_DETAILS_MARKER_ID = 'seed:store-details-v1';
const WELCOME_MARKER_ID = 'seed:welcome-popup-v1';
const DAY = 86_400_000;
const CLOTHING = ['XS', 'S', 'M', 'L', 'XL'];
const MENS = ['S', 'M', 'L', 'XL', 'XXL'];

const black: Colour = { name: 'Black', hex: '#16161a' };
const lightWash: Colour = { name: 'Light wash', hex: '#9db8d9' };
const whiteGrey: Colour = { name: 'White / grey', hex: '#d9d9d6' };

interface Look {
  file: string;
  number: string;
  name: string;
  material: string;
  priceNaira: number;
  colour: Colour;
  sizes: string[];
  collections: string[];
  stock: number;
  daysOld: number;
  description: string;
  details: string;
}

export const LOOKS: Look[] = [
  {
    file: 'cargo-denim-set',
    number: 'No. 091',
    name: 'Cargo denim set',
    material: 'Denim · Two-piece',
    priceNaira: 120000,
    colour: lightWash,
    sizes: CLOTHING,
    collections: ['women', 'new-in'],
    stock: 4,
    daysOld: 1,
    description: 'A cropped denim jacket over a high-waist, wide-leg cargo jean, finished with long tie straps at the hem.',
    details: 'Cropped jacket with strap detailing; high-waist wide-leg jean with cargo pockets and hem ties. Sold as a set.',
  },
  {
    file: 'belted-suit',
    number: 'No. 092',
    name: 'Belted short-sleeve suit',
    material: 'Suiting · Two-piece',
    priceNaira: 145000,
    colour: black,
    sizes: CLOTHING,
    collections: ['women', 'new-in'],
    stock: 3,
    daysOld: 2,
    description: 'A cap-sleeve jacket with a hand-painted lapel, tied at the waist, over a fluid wide-leg trouser.',
    details: 'Single-button jacket with patch pockets and self-tie belt; high-rise wide-leg trouser. Sold as a set.',
  },
  {
    file: 'star-print-set',
    number: 'No. 093',
    name: 'Star-print tee and track trouser',
    material: 'Jersey · Two-piece',
    priceNaira: 98000,
    colour: black,
    sizes: CLOTHING,
    collections: ['women'],
    stock: 5,
    daysOld: 4,
    description: 'An oversized tee with an embellished star print, worn with a wide track trouser striped down the side.',
    details: 'Relaxed tee with crystal-edged print; wide-leg trouser with twin side stripes. Sold as a set. Bag not included.',
  },
  {
    file: 'chevron-track-set',
    number: 'No. 094',
    name: 'Chevron track set',
    material: 'Technical knit · Two-piece',
    priceNaira: 135000,
    colour: whiteGrey,
    sizes: MENS,
    collections: ['men', 'new-in'],
    stock: 4,
    daysOld: 1,
    description: 'A funnel-neck track jacket in white with grey chevrons, over a straight grey trouser.',
    details: 'Full-zip jacket with ribbed cuffs and hem; straight-leg trouser with the embroidered A mark. Sold as a set.',
  },
  {
    file: 'crystal-set',
    number: 'No. 095',
    name: 'Crystal-studded tee and trouser',
    material: 'Jersey · Two-piece',
    priceNaira: 150000,
    colour: black,
    sizes: MENS,
    collections: ['men', DROP_SLUG],
    stock: 3,
    daysOld: 3,
    description: 'A black tee and drawstring trouser scattered all over with small crystals — made for after dark.',
    details: 'Crew-neck tee and tapered drawstring trouser, both hand-set with crystals. Sold as a set.',
  },
];

/** Hero images for collection panels — only replace a missing or grey placeholder image. */
const HEROES: { slug: string; file: string }[] = [
  { slug: 'women', file: 'hero-women' },
  { slug: 'men', file: 'hero-men' },
  { slug: DROP_SLUG, file: 'hero-drop' },
];

function assetsDir(): string {
  // dist/db/seed-photos.js and src/db/seed-photos.ts both sit two levels below the package root.
  return join(__dirname, '..', '..', 'assets', 'placeholders');
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = drizzle(pool, { schema });
  const log = (m: string) => console.log(`[seed:photos] ${m}`);
  const force = process.argv.includes('--force');

  const [marker] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, MARKER_ID)).limit(1);
  if (marker && !force) {
    log('already loaded — skipping');
    await hidePhotoless(db, log);
    await simplify(db, log);
    await storeDetails(db, log);
    await welcomePicture(db, log);
    await pool.end();
    return;
  }
  const dir = assetsDir();
  if (!existsSync(dir)) {
    log(`no photos folder at ${dir} — skipping`);
    await pool.end();
    return;
  }

  const processor = new ImageProcessor();
  const base = config.publicApiUrl.replace(/\/$/, '');
  const upload = async (file: string): Promise<string> => {
    const processed = await processor.process(readFileSync(join(dir, `${file}.jpg`)));
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.mediaFiles)
        .values({ ownerKind: 'product', originalFilename: `${file}.jpg`, width: processed.width, height: processed.height })
        .returning({ id: schema.mediaFiles.id });
      await tx.insert(schema.mediaVariants).values(
        processed.variants.map((v) => ({ mediaId: row.id, width: v.width, mime: v.mime, bytes: v.bytes, byteSize: v.bytes.length })),
      );
      return row.id;
    });
    return `${base}${MEDIA_PATH}${id}`;
  };

  const collectionRows = await db.select().from(schema.collections);
  const collectionId = new Map(collectionRows.map((c) => [c.slug, c.id]));
  const now = Date.now();

  let added = 0;
  for (const look of LOOKS) {
    const slug = slugify(look.name);
    const [exists] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slug)).limit(1);
    if (exists) continue;
    const [stageUrl, wornUrl] = [await upload(`${look.file}-stage`), await upload(`${look.file}-worn`)];
    const priceKobo = nairaToKobo(look.priceNaira);
    const createdAt = new Date(now - look.daysOld * DAY);
    const matrix = generateVariantMatrix({ productNumber: look.number, colours: [look.colour], sizes: look.sizes, priceKobo, compareAtKobo: null });
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          slug,
          number: look.number,
          name: look.name,
          material: look.material,
          description: look.description,
          details: look.details,
          care: 'Follow the care label inside the garment.',
          sizeGuide: 'CLOTHING',
          exchangeable: true,
          status: 'LIVE',
          options: { colours: [look.colour], sizes: look.sizes },
          basePriceKobo: priceKobo,
          compareAtKobo: null,
          lowStockThreshold: 3,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: schema.products.id });
      const cols = look.collections.map((s) => collectionId.get(s)).filter((id): id is string => !!id);
      if (cols.length) await tx.insert(schema.productCollections).values(cols.map((cid) => ({ productId: row.id, collectionId: cid })));
      await tx.insert(schema.productImages).values([
        { productId: row.id, url: stageUrl, alt: `${look.name} — front`, colour: null, sortOrder: 0 },
        { productId: row.id, url: wornUrl, alt: `${look.name} — in the store`, colour: null, sortOrder: 1 },
      ]);
      await tx.insert(schema.variants).values(matrix.map((v) => ({ ...v, productId: row.id, stock: look.stock })));
    });
    added++;
  }
  log(`looks added: ${added} (of ${LOOKS.length})`);

  for (const h of HEROES) {
    const id = collectionId.get(h.slug);
    if (!id) continue;
    const [col] = await db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(and(eq(schema.collections.id, id), or(isNull(schema.collections.heroImageUrl), like(schema.collections.heroImageUrl, '%placehold.co%'))))
      .limit(1);
    if (!col) continue;
    const url = await upload(h.file);
    await db.update(schema.collections).set({ heroImageUrl: url }).where(eq(schema.collections.id, id));
    log(`hero image set: ${h.slug}`);
  }

  await db
    .insert(schema.storeSettings)
    .values({ id: MARKER_ID, data: { appliedAt: new Date().toISOString() } })
    .onConflictDoUpdate({ target: schema.storeSettings.id, set: { data: { appliedAt: new Date().toISOString() } } });
  await hidePhotoless(db, log);
  await simplify(db, log);
  await storeDetails(db, log);
  await welcomePicture(db, log);
  await pool.end();
  log('done');
}

/**
 * Once per database: starter products that only have grey placehold.co images move to DRAFT (off the shop, still in
 * admin — add photos and set them LIVE again), and placehold.co banner images are cleared so empty panels are hidden.
 */
async function hidePhotoless(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, HIDE_MARKER_ID)).limit(1);
  if (done) return;
  const drafted = await db
    .update(schema.products)
    .set({ status: 'DRAFT', updatedAt: new Date() })
    .where(
      and(
        eq(schema.products.status, 'LIVE'),
        sql`not exists (select 1 from product_images pi where pi.product_id = ${schema.products.id} and pi.url not like '%placehold.co%')`,
      ),
    )
    .returning({ name: schema.products.name });
  const cleared = await db
    .update(schema.collections)
    .set({ heroImageUrl: null })
    .where(like(schema.collections.heroImageUrl, '%placehold.co%'))
    .returning({ slug: schema.collections.slug });
  await db
    .insert(schema.storeSettings)
    .values({ id: HIDE_MARKER_ID, data: { appliedAt: new Date().toISOString(), drafted: drafted.map((d) => d.name) } })
    .onConflictDoNothing({ target: schema.storeSettings.id });
  log(`products without photos moved to draft: ${drafted.length}${drafted.length ? ` (${drafted.map((d) => d.name).join(', ')})` : ''}`);
  log(`placeholder banner images cleared: ${cleared.length}`);
}

/**
 * Once per database — right-size the shop for launch: no featured drop (the drop collection becomes a normal
 * collection called "The Night Edit"), the starter WELCOME10 code off, Bachs off (Paystack only; tick it back on in
 * Settings), and a calm one-line top bar. Everything stays editable in admin afterwards.
 */
async function simplify(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, SIMPLIFY_MARKER_ID)).limit(1);
  if (done) return;
  const [row] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  if (row) {
    const data = { ...(row.data as Record<string, unknown>) };
    data.drop = null;
    data.bachsEnabled = false;
    data.tickerText = ['Delivery across Nigeria · Exchange, never a refund'];
    await db.update(schema.storeSettings).set({ data, updatedAt: new Date() }).where(eq(schema.storeSettings.id, 'default'));
  }
  const drops = await db
    .update(schema.collections)
    .set({ isDrop: false, goLiveAt: null })
    .where(eq(schema.collections.isDrop, true))
    .returning({ slug: schema.collections.slug, name: schema.collections.name });
  for (const d of drops) {
    const plain = d.name.replace(/^Drop\s*\d+\s*[—/-]\s*/i, '').trim();
    if (plain && plain !== d.name) await db.update(schema.collections).set({ name: plain }).where(eq(schema.collections.slug, d.slug));
  }
  await db.update(schema.discounts).set({ active: false }).where(eq(schema.discounts.code, 'WELCOME10'));
  await db
    .insert(schema.storeSettings)
    .values({ id: SIMPLIFY_MARKER_ID, data: { appliedAt: new Date().toISOString() } })
    .onConflictDoNothing({ target: schema.storeSettings.id });
  log(`simplified: drop off (${drops.map((d) => d.slug).join(', ') || 'none'}), WELCOME10 off, Bachs off, top bar reset`);
}

/** Once per database: the real store details from the client (still editable in admin → Settings). */
async function storeDetails(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, STORE_DETAILS_MARKER_ID)).limit(1);
  if (done) return;
  const [row] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  if (row) {
    const data = {
      ...(row.data as Record<string, unknown>),
      pickupAddress: 'Shop N01, Novare Mall, Sangotedo, Lagos',
      openingHours: 'Mon–Sat 9am–9pm · Sun 12pm–9pm',
      whatsappNumber: '+2349046762972',
      contactPhone: '+234 904 676 2972',
    };
    await db.update(schema.storeSettings).set({ data, updatedAt: new Date() }).where(eq(schema.storeSettings.id, 'default'));
  }
  await db
    .insert(schema.storeSettings)
    .values({ id: STORE_DETAILS_MARKER_ID, data: { appliedAt: new Date().toISOString() } })
    .onConflictDoNothing({ target: schema.storeSettings.id });
  log('store details set: Novare Mall, Sangotedo');
}

/** Once per database: give the welcome pop-up a picture (The Night Edit banner) if it has none. */
async function welcomePicture(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, WELCOME_MARKER_ID)).limit(1);
  if (done) return;
  const [row] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  const [col] = await db.select({ url: schema.collections.heroImageUrl }).from(schema.collections).where(eq(schema.collections.slug, DROP_SLUG)).limit(1);
  if (row && col?.url && !col.url.includes('placehold.co')) {
    const data = row.data as Record<string, unknown>;
    const current = (data.welcomePopup ?? {}) as Record<string, unknown>;
    if (!current.imageUrl) {
      await db
        .update(schema.storeSettings)
        .set({ data: { ...data, welcomePopup: { ...DEFAULT_SETTINGS.welcomePopup, ...current, imageUrl: col.url } }, updatedAt: new Date() })
        .where(eq(schema.storeSettings.id, 'default'));
      log('welcome pop-up picture set');
    }
  }
  // drops are off: the old drop banner link text goes back to the default "Discover the collection"
  await db.update(schema.collections).set({ tagline: null }).where(eq(schema.collections.tagline, 'Discover the drop'));
  await db.insert(schema.storeSettings).values({ id: WELCOME_MARKER_ID, data: { appliedAt: new Date().toISOString() } }).onConflictDoNothing({ target: schema.storeSettings.id });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed:photos] failed', err);
    process.exit(1);
  });
}
