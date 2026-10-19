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
import { ABOUT_MARKDOWN, COLLECTIONS, DROP_SLUG, EXCHANGES_INTRO, EXCHANGES_TITLE, FAQ, HOME_INTRO, TICKER_TEXT } from './seed-data';
import { DEFAULT_SETTINGS } from '../settings/settings.types';

const MARKER_ID = 'seed:placeholder-photos-v1';
const HIDE_MARKER_ID = 'seed:hide-photoless-v1';
const SIMPLIFY_MARKER_ID = 'seed:simplify-v1';
const STORE_DETAILS_MARKER_ID = 'seed:store-details-v1';
const WELCOME_MARKER_ID = 'seed:welcome-popup-v1';
const CLIENT_COPY_MARKER_ID = 'seed:client-copy-v1';
const HOME_PHOTOS_MARKER_ID = 'seed:home-photos-v1';
const CATALOGUE_MARKER_ID = 'seed:catalogue-v2';
const IMAGE_SCALE_MARKER_ID = 'seed:image-scale-v1';
const WORDING_MARKER_ID = 'seed:wording-v1';
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

/** Puts one image file into the built-in media store (resized variants) and returns its public URL. */
async function storeImage(db: NodePgDatabase<typeof schema>, publicApiUrl: string, path: string): Promise<string> {
  const processed = await new ImageProcessor().process(readFileSync(path));
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.mediaFiles)
      .values({ ownerKind: 'product', originalFilename: path.split('/').pop() ?? 'image.jpg', width: processed.width, height: processed.height })
      .returning({ id: schema.mediaFiles.id });
    await tx.insert(schema.mediaVariants).values(
      processed.variants.map((v) => ({ mediaId: row.id, width: v.width, mime: v.mime, bytes: v.bytes, byteSize: v.bytes.length })),
    );
    return row.id;
  });
  return `${publicApiUrl.replace(/\/$/, '')}${MEDIA_PATH}${id}`;
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
    await clientCopy(db, log);
    await homePhotos(db, config.publicApiUrl, log);
    await catalogueV2(db, config.publicApiUrl, log);
    await imageScale(db, log);
    await wording(db, log);
    await pool.end();
    return;
  }
  const dir = assetsDir();
  if (!existsSync(dir)) {
    log(`no photos folder at ${dir} — skipping`);
    await pool.end();
    return;
  }

  const upload = (file: string): Promise<string> => storeImage(db, config.publicApiUrl, join(dir, `${file}.jpg`));

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
  await clientCopy(db, log);
  await homePhotos(db, config.publicApiUrl, log);
  await catalogueV2(db, config.publicApiUrl, log);
  await imageScale(db, log);
  await wording(db, log);
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
    data.tickerText = [TICKER_TEXT];
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

/** Text the old seed wrote, replaced below only where the admin has not changed it since. */
const OLD_COPY = {
  collections: {
    women: "Tailoring, silk and leather for evenings in Lagos. Every piece is a limited run; when it's gone, it's gone.",
    'new-in': 'This week at the studio.',
    [DROP_SLUG]: 'Forty-eight pieces cut for Lagos evenings: tailoring, leather and silk in navy, ink and ivory. Limited runs. No restocks.',
  } as Record<string, string>,
  faq: {
    'Are your products genuine?': 'Every piece is designed by Amerapelle and made in limited runs. We do not resell other brands.',
    'Do you restock?': 'Rarely. Drops are limited runs — when a piece is gone, it is gone.',
  } as Record<string, string>,
};

/**
 * Once per database: the client's brand copy — the home page introduction and the About page (both editable in
 * admin → Pages) — and the old "made in limited runs" wording swapped for the multi-brand positioning.
 */
async function clientCopy(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, CLIENT_COPY_MARKER_ID)).limit(1);
  if (done) return;
  await db
    .insert(schema.pages)
    .values({ slug: 'home', ...HOME_INTRO })
    .onConflictDoUpdate({ target: schema.pages.slug, set: { ...HOME_INTRO, updatedAt: new Date() } });
  await db
    .insert(schema.pages)
    .values({ slug: 'about', title: 'About Amerapelle', bodyMarkdown: ABOUT_MARKDOWN })
    .onConflictDoUpdate({ target: schema.pages.slug, set: { bodyMarkdown: ABOUT_MARKDOWN, updatedAt: new Date() } });
  for (const [slug, old] of Object.entries(OLD_COPY.collections)) {
    const next = COLLECTIONS.find((c) => c.slug === slug)?.description;
    if (next) await db.update(schema.collections).set({ description: next }).where(and(eq(schema.collections.slug, slug), eq(schema.collections.description, old)));
  }
  for (const [question, old] of Object.entries(OLD_COPY.faq)) {
    const next = FAQ.find((f) => f.question === question)?.answer;
    if (next) await db.update(schema.faqItems).set({ answer: next, updatedAt: new Date() }).where(and(eq(schema.faqItems.question, question), eq(schema.faqItems.answer, old)));
  }
  await db.insert(schema.storeSettings).values({ id: CLIENT_COPY_MARKER_ID, data: { appliedAt: new Date().toISOString() } }).onConflictDoNothing({ target: schema.storeSettings.id });
  log('client copy applied: home introduction, About page, FAQ and collection descriptions');
}

/**
 * Once per database: the home page campaign photos (assets/home) — opening image, slideshow and still image — and the
 * welcome pop-up picture, unless the admin has already set their own. All replaceable in admin → Settings.
 */
async function homePhotos(db: NodePgDatabase<typeof schema>, publicApiUrl: string, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, HOME_PHOTOS_MARKER_ID)).limit(1);
  if (done) return;
  const dir = join(__dirname, '..', '..', 'assets', 'home');
  const [row] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  if (!existsSync(dir) || !row) return;
  const data = row.data as Record<string, unknown>;
  const media = (data.homeMedia ?? DEFAULT_SETTINGS.homeMedia) as typeof DEFAULT_SETTINGS.homeMedia;
  const put = (file: string) => storeImage(db, publicApiUrl, join(dir, `${file}.jpg`));
  const right = 'right' as const;
  const next = {
    hero: { ...DEFAULT_SETTINGS.homeMedia.hero, ...media.hero },
    slides: { ...DEFAULT_SETTINGS.homeMedia.slides, ...media.slides },
    still: { ...DEFAULT_SETTINGS.homeMedia.still, ...media.still },
  };
  if (!next.hero.images?.length) next.hero.images = [{ url: await put('hero-suit'), focus: right }];
  if (!next.slides.images?.length) {
    next.slides.images = [];
    for (const f of ['slide-denim', 'slide-track', 'slide-black-set']) next.slides.images.push({ url: await put(f), focus: right });
  }
  if (!next.still.images?.length) next.still.images = [{ url: await put('still-bag'), focus: right }];
  // The welcome pop-up used the old drop banner (a cut-out on grey) — the still life suits it better.
  const welcome = { ...DEFAULT_SETTINGS.welcomePopup, ...((data.welcomePopup ?? {}) as Record<string, unknown>) };
  const [drop] = await db.select({ url: schema.collections.heroImageUrl }).from(schema.collections).where(eq(schema.collections.slug, DROP_SLUG)).limit(1);
  if (!welcome.imageUrl || welcome.imageUrl === drop?.url) welcome.imageUrl = next.still.images[0].url;
  await db.update(schema.storeSettings).set({ data: { ...data, homeMedia: next, welcomePopup: welcome }, updatedAt: new Date() }).where(eq(schema.storeSettings.id, 'default'));
  await db.insert(schema.storeSettings).values({ id: HOME_PHOTOS_MARKER_ID, data: { appliedAt: new Date().toISOString() } }).onConflictDoNothing({ target: schema.storeSettings.id });
  log('home photos set: opening image, 3 slides, still image');
}

/** The client's product photos (assets/catalogue), used as supplied — no background removal. */
interface CatalogueItem extends Omit<Look, 'file'> {
  files: string[];
}
const cream: Colour = { name: 'Cream', hex: '#efe8d8' };
const brownCheck: Colour = { name: 'Brown check', hex: '#7a6450' };
const pink: Colour = { name: 'Pink', hex: '#f2b8d0' };
const multi: Colour = { name: 'Multicolour', hex: '#e8505b' };
const white: Colour = { name: 'White', hex: '#f4f2ee' };
const blackWhite: Colour = { name: 'Black / white', hex: '#1c1c1c' };

/** Photos of a person in a real setting fill the frame; flat packshots on white sit smaller on the stage. */
const WORN_SHOTS = new Set(['crystal-jacket', 'leather-bomber', 'cream-hoodie-set', 'logo-sweatshirt-worn']);
export const PACKSHOT_SCALE = 78;
const scaleFor = (file: string) => (WORN_SHOTS.has(file) ? 100 : PACKSHOT_SCALE);

export const CATALOGUE: CatalogueItem[] = [
  { files: ['check-blazer'], number: 'No. 101', name: 'Brown check blazer', material: 'Wool blend · Jackets', priceNaira: 185000, colour: brownCheck, sizes: MENS, collections: ['men', 'new-in'], stock: 4, daysOld: 0, description: 'A softly tailored two-button blazer in a brown check with blue and caramel lines.', details: 'Notch lapels, flap pockets, working cuff buttons and a satin lining.' },
  { files: ['black-suit'], number: 'No. 102', name: 'Black two-piece suit', material: 'Suiting · Suits', priceNaira: 320000, colour: black, sizes: MENS, collections: ['men', 'new-in'], stock: 3, daysOld: 0, description: 'A sharp black suit with a peak lapel, finished with a burgundy pocket square and lapel pin.', details: 'Single-breasted jacket and flat-front trouser. Sold as a set.' },
  { files: ['crystal-jacket'], number: 'No. 103', name: 'Crystal velvet bomber', material: 'Velvet with crystals · Jackets', priceNaira: 450000, colour: black, sizes: MENS, collections: ['men', 'new-in'], stock: 2, daysOld: 0, description: 'A black velvet zip bomber scattered with hand-set crystals — made for after dark.', details: 'Point collar, full zip, ribbed cuffs.' },
  { files: ['leather-bomber'], number: 'No. 104', name: 'Black leather bomber', material: 'Leather · Jackets', priceNaira: 260000, colour: black, sizes: MENS, collections: ['men', 'new-in'], stock: 3, daysOld: 1, description: 'A supple black leather bomber with a ribbed collar and gold-tone badge.', details: 'Full zip, zip sleeve pocket, ribbed cuffs and hem.' },
  { files: ['varsity-jacket'], number: 'No. 105', name: 'Black and white varsity jacket', material: 'Wool blend · Jackets', priceNaira: 280000, colour: blackWhite, sizes: MENS, collections: ['men', 'new-in'], stock: 3, daysOld: 1, description: 'A classic varsity jacket: black body, white sleeves and striped ribbing.', details: 'Press-stud front, welt pockets, embroidered chest patch.' },
  { files: ['logo-sweatshirt', 'logo-sweatshirt-worn'], number: 'No. 106', name: 'White logo sweatshirt', material: 'Cotton fleece · Sweatshirts & hoodies', priceNaira: 175000, colour: white, sizes: MENS, collections: ['men', 'new-in'], stock: 4, daysOld: 1, description: 'A relaxed white crew-neck sweatshirt with a raised chenille logo.', details: 'Dropped shoulders, ribbed collar, cuffs and hem.' },
  { files: ['cream-overshirt'], number: 'No. 107', name: 'Cream short-sleeve overshirt', material: 'Cotton twill · Shirts', priceNaira: 145000, colour: cream, sizes: MENS, collections: ['men', 'new-in'], stock: 5, daysOld: 2, description: 'A clean cream overshirt with steel snaps and a leather-patch chest pocket.', details: 'Point collar, short sleeves, straight hem.' },
  { files: ['windbreaker'], number: 'No. 108', name: 'Black panelled windbreaker', material: 'Nylon · Jackets', priceNaira: 120000, colour: blackWhite, sizes: MENS, collections: ['men', 'new-in'], stock: 5, daysOld: 2, description: 'A lightweight hooded windbreaker in black with white contrast panels.', details: 'Two-way zip, zip pockets, elasticated cuffs and hem.' },
  { files: ['pink-camo-hoodie'], number: 'No. 109', name: 'Pink camo hoodie', material: 'Cotton fleece · Sweatshirts & hoodies', priceNaira: 140000, colour: pink, sizes: MENS, collections: ['men', 'new-in'], stock: 4, daysOld: 2, description: 'A pink camouflage pullover hoodie with graphic print and sleeve badges.', details: 'Drawstring hood, kangaroo pocket, ribbed cuffs and hem.' },
  { files: ['black-hoodie-set'], number: 'No. 110', name: 'Black zip hoodie and jogger set', material: 'Cotton fleece · Sets', priceNaira: 165000, colour: black, sizes: CLOTHING, collections: ['women', 'new-in'], stock: 4, daysOld: 0, description: 'An easy black zip hoodie with a matching wide-leg jogger.', details: 'Drawstring hood and waist, front pockets. Sold as a set.' },
  { files: ['cream-hoodie-set'], number: 'No. 111', name: 'Cream hoodie and wide-leg set', material: 'Cotton fleece · Sets', priceNaira: 165000, colour: cream, sizes: CLOTHING, collections: ['women', 'new-in'], stock: 4, daysOld: 1, description: 'A cream cropped zip hoodie with relaxed wide-leg trousers.', details: 'Elasticated waist with drawstring. Sold as a set.' },
  { files: ['crop-skirt-set'], number: 'No. 112', name: 'Black sweatshirt and skort set', material: 'Jersey · Sets', priceNaira: 130000, colour: black, sizes: CLOTHING, collections: ['women', 'new-in'], stock: 4, daysOld: 1, description: 'A cropped black sweatshirt with a flounced, lined skort.', details: 'Ribbed cuffs and hem; high-rise skort with built-in shorts. Sold as a set.' },
  { files: ['print-set'], number: 'No. 113', name: 'Swirl print top and flare set', material: 'Stretch jersey · Sets', priceNaira: 95000, colour: multi, sizes: CLOTHING, collections: ['women', 'new-in'], stock: 5, daysOld: 2, description: 'A bold swirl-print racer crop top with matching flared trousers.', details: 'Soft stretch fabric, elasticated waist. Sold as a set.' },
];

/**
 * Once per database: the client's real product photos replace the starter looks. Starter products are archived (kept
 * for order history, gone from the shop), the cut-out collection banners made by the old seed are cleared, and the
 * new pieces go live — photos exactly as supplied. Everything stays editable in admin → Products.
 */
async function catalogueV2(db: NodePgDatabase<typeof schema>, publicApiUrl: string, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, CATALOGUE_MARKER_ID)).limit(1);
  if (done) return;
  const dir = join(__dirname, '..', '..', 'assets', 'catalogue');
  if (!existsSync(dir)) return;

  const oldSlugs = LOOKS.map((l) => slugify(l.name));
  const archived = await db
    .update(schema.products)
    .set({ status: 'ARCHIVED', updatedAt: new Date() })
    .where(sql`${schema.products.slug} in (${sql.join(oldSlugs.map((x) => sql`${x}`), sql`, `)}) and ${schema.products.status} <> 'ARCHIVED'`)
    .returning({ name: schema.products.name });
  // Cut-out banners from the starter photos (built-in media); a banner the admin uploaded since is left alone.
  const cleared = await db
    .update(schema.collections)
    .set({ heroImageUrl: null })
    .where(like(schema.collections.heroImageUrl, `%${MEDIA_PATH}%`))
    .returning({ slug: schema.collections.slug });

  const collectionRows = await db.select().from(schema.collections);
  const collectionId = new Map(collectionRows.map((c) => [c.slug, c.id]));
  const now = Date.now();
  let added = 0;
  for (const item of CATALOGUE) {
    const slug = slugify(item.name);
    const [exists] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slug)).limit(1);
    if (exists) continue;
    const urls: string[] = [];
    for (const f of item.files) urls.push(await storeImage(db, publicApiUrl, join(dir, `${f}.jpg`)));
    const priceKobo = nairaToKobo(item.priceNaira);
    const createdAt = new Date(now - item.daysOld * DAY);
    const matrix = generateVariantMatrix({ productNumber: item.number, colours: [item.colour], sizes: item.sizes, priceKobo, compareAtKobo: null });
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          slug,
          number: item.number,
          name: item.name,
          material: item.material,
          description: item.description,
          details: item.details,
          care: 'Follow the care label inside the garment.',
          sizeGuide: 'CLOTHING',
          exchangeable: true,
          status: 'LIVE',
          options: { colours: [item.colour], sizes: item.sizes },
          basePriceKobo: priceKobo,
          compareAtKobo: null,
          lowStockThreshold: 2,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: schema.products.id });
      const cols = item.collections.map((c) => collectionId.get(c)).filter((id): id is string => !!id);
      if (cols.length) await tx.insert(schema.productCollections).values(cols.map((cid) => ({ productId: row.id, collectionId: cid })));
      await tx.insert(schema.productImages).values(urls.map((url, i) => ({ productId: row.id, url, alt: i === 0 ? item.name : `${item.name} — worn`, colour: null, sortOrder: i, scale: scaleFor(item.files[i]) })));
      await tx.insert(schema.variants).values(matrix.map((v) => ({ ...v, productId: row.id, stock: item.stock })));
    });
    added++;
  }
  await db.insert(schema.storeSettings).values({ id: CATALOGUE_MARKER_ID, data: { appliedAt: new Date().toISOString(), added, archived: archived.map((a) => a.name) } }).onConflictDoNothing({ target: schema.storeSettings.id });
  log(`catalogue: ${added} new products live; starter products archived: ${archived.length}; cut-out banners cleared: ${cleared.length}`);
}

/** Once per database: catalogue packshots (added before image sizes existed) sit smaller in their frame. */
async function imageScale(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, IMAGE_SCALE_MARKER_ID)).limit(1);
  if (done) return;
  let changed = 0;
  for (const item of CATALOGUE) {
    const [p] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slugify(item.name))).limit(1);
    if (!p) continue;
    for (const [i, file] of item.files.entries()) {
      if (scaleFor(file) === 100) continue;
      const rows = await db
        .update(schema.productImages)
        .set({ scale: scaleFor(file) })
        .where(and(eq(schema.productImages.productId, p.id), eq(schema.productImages.sortOrder, i), eq(schema.productImages.scale, 100)))
        .returning({ id: schema.productImages.id });
      changed += rows.length;
    }
  }
  await db.insert(schema.storeSettings).values({ id: IMAGE_SCALE_MARKER_ID, data: { appliedAt: new Date().toISOString(), changed } }).onConflictDoNothing({ target: schema.storeSettings.id });
  log(`product packshots set to ${PACKSHOT_SCALE}% of their frame: ${changed}`);
}

/**
 * Once per database: the client's softer wording — "Your satisfaction, our priority" and "Our Exchange Promise" in
 * place of "Exchange, never a refund" / "no refunds". Only text still exactly as the old seed wrote it is changed.
 */
async function wording(db: NodePgDatabase<typeof schema>, log: (m: string) => void): Promise<void> {
  const [done] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, WORDING_MARKER_ID)).limit(1);
  if (done) return;
  const changed: string[] = [];
  const [row] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  const ticker = (row?.data as { tickerText?: string[] } | undefined)?.tickerText ?? [];
  if (row && ticker.length === 1 && ticker[0] === 'Delivery across Nigeria · Exchange, never a refund') {
    await db.update(schema.storeSettings).set({ data: { ...(row.data as Record<string, unknown>), tickerText: [TICKER_TEXT] }, updatedAt: new Date() }).where(eq(schema.storeSettings.id, 'default'));
    changed.push('top bar');
  }
  const oldIntro = '# Exchange, not refund\n\n**We do not offer refunds.** Instead, every eligible piece can be exchanged for credit.';
  const [ex] = await db.select().from(schema.pages).where(eq(schema.pages.slug, 'exchanges')).limit(1);
  if (ex) {
    const title = ex.title === 'Exchanges — no refunds' ? EXCHANGES_TITLE : ex.title;
    const body = ex.bodyMarkdown.replace(/\r\n/g, '\n').replace(oldIntro, EXCHANGES_INTRO);
    if (title !== ex.title || body !== ex.bodyMarkdown) {
      await db.update(schema.pages).set({ title, bodyMarkdown: body, updatedAt: new Date() }).where(eq(schema.pages.slug, 'exchanges'));
      changed.push('exchanges page');
    }
  }
  const [terms] = await db.select().from(schema.pages).where(eq(schema.pages.slug, 'terms')).limit(1);
  if (terms?.bodyMarkdown.includes('**Exchanges, not refunds.**')) {
    await db.update(schema.pages).set({ bodyMarkdown: terms.bodyMarkdown.replace('**Exchanges, not refunds.**', '**Our Exchange Promise.**'), updatedAt: new Date() }).where(eq(schema.pages.slug, 'terms'));
    changed.push('terms');
  }
  await db.insert(schema.storeSettings).values({ id: WORDING_MARKER_ID, data: { appliedAt: new Date().toISOString(), changed } }).onConflictDoNothing({ target: schema.storeSettings.id });
  log(`wording updated: ${changed.join(', ') || 'nothing to change'}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed:photos] failed', err);
    process.exit(1);
  });
}
