/* `npm run seed` — idempotent: creates what is missing, never clobbers admin edits or live stock. */
import * as bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadConfig } from '../config/app-config';
import { slugify } from '../common/ids';
import { nairaToKobo } from '../common/money';
import { generateVariantMatrix } from '../catalogue/variant-matrix';
import { DEFAULT_SETTINGS, StoredSettings } from '../settings/settings.types';
import { createPool } from './database.module';
import * as schema from './schema';
import { COLLECTIONS, DELIVERY_ZONES, DROP_SLUG, FAQ, PAGES, PRODUCTS } from './seed-data';

const DAY = 86_400_000;

function imageUrl(number: string, colour: string | null, view: number): string {
  const base = process.env.SEED_IMAGE_BASE ?? 'https://placehold.co/800x1000/f2f2ef/0a0a0f/png';
  const label = encodeURIComponent(`${number}${colour ? ` · ${colour}` : ''}${view > 1 ? ` · ${view}` : ''}`);
  return `${base}?text=${label}`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = drizzle(pool, { schema });
  const now = new Date();
  const log = (m: string) => console.log(`[seed] ${m}`);

  // `--if-empty` (used on Railway start): only seed a brand-new database, so admin deletions are never undone.
  if (process.argv.includes('--if-empty')) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.collections);
    if (count > 0) {
      log(`database already has ${count} collections — skipping (--if-empty)`);
      await pool.end();
      return;
    }
    log('empty database — loading starter data');
  }

  // ---------------------------------------------------------------- admin
  if (config.adminEmail && config.adminPassword) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, config.adminEmail)).limit(1);
    if (!existing) {
      await db.insert(schema.users).values({
        email: config.adminEmail,
        passwordHash: await bcrypt.hash(config.adminPassword, 12),
        firstName: 'Amerapelle',
        lastName: 'Admin',
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      });
      log(`admin created: ${config.adminEmail}`);
    } else {
      const patch: Partial<typeof schema.users.$inferInsert> = { role: 'ADMIN', emailVerifiedAt: existing.emailVerifiedAt ?? new Date() };
      if (process.env.SEED_RESET_ADMIN_PASSWORD === 'true') patch.passwordHash = await bcrypt.hash(config.adminPassword, 12);
      await db.update(schema.users).set(patch).where(eq(schema.users.id, existing.id));
      log(`admin exists: ${config.adminEmail}${patch.passwordHash ? ' (password reset)' : ''}`);
    }
  } else {
    log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user');
  }

  // ---------------------------------------------------------------- collections
  const dropGoLive = process.env.SEED_DROP_GO_LIVE ? new Date(process.env.SEED_DROP_GO_LIVE) : new Date(now.getTime() - 60 * 60_000);
  for (const c of COLLECTIONS) {
    await db
      .insert(schema.collections)
      .values({
        slug: c.slug,
        name: c.name,
        description: c.description,
        isDrop: c.isDrop ?? false,
        goLiveAt: c.isDrop ? dropGoLive : null,
        heroPattern: c.heroPattern ?? null,
        exchangeable: c.exchangeable ?? true,
        sortOrder: c.sortOrder,
        homeOrder: c.homeOrder ?? null,
        heroImageUrl: c.heroImageUrl ?? null,
        tagline: c.tagline ?? null,
      })
      .onConflictDoNothing({ target: schema.collections.slug });
  }
  const collectionRows = await db.select().from(schema.collections);
  const collectionId = new Map(collectionRows.map((c) => [c.slug, c.id]));
  log(`collections: ${collectionRows.length}`);

  // ---------------------------------------------------------------- products
  let created = 0;
  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    const [exists] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slug)).limit(1);
    if (exists) continue;
    const priceKobo = nairaToKobo(p.priceNaira);
    const compareAtKobo = p.wasNaira ? nairaToKobo(p.wasNaira) : null;
    const createdAt = new Date(now.getTime() - p.daysOld * DAY);
    const matrix = generateVariantMatrix({ productNumber: p.number, colours: p.colours, sizes: p.sizes, priceKobo, compareAtKobo });
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          slug,
          number: p.number,
          name: p.name,
          material: p.material,
          description: p.description,
          details: p.details ?? null,
          care: p.care ?? null,
          sizeGuide: p.sizeGuide,
          exchangeable: p.exchangeable ?? true,
          status: 'LIVE',
          options: { colours: p.colours, sizes: p.sizes },
          basePriceKobo: priceKobo,
          compareAtKobo,
          lowStockThreshold: 3,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: schema.products.id });
      const cols = p.collections.map((s) => collectionId.get(s)).filter((id): id is string => !!id);
      if (cols.length) await tx.insert(schema.productCollections).values(cols.map((cid) => ({ productId: row.id, collectionId: cid })));

      const images: (typeof schema.productImages.$inferInsert)[] = [];
      let order = 0;
      for (const colour of p.colours.length ? p.colours : [null]) {
        for (let view = 1; view <= (colour === p.colours[0] || !colour ? 3 : 1); view++) {
          images.push({
            productId: row.id,
            url: imageUrl(p.number, p.colours.length > 1 ? colour?.name ?? null : null, view),
            alt: `${p.name}${colour && p.colours.length > 1 ? ` in ${colour.name.toLowerCase()}` : ''}${view > 1 ? ` — view ${view}` : ''}`,
            colour: p.colours.length > 1 ? colour?.name ?? null : null,
            sortOrder: order++,
          });
        }
      }
      await tx.insert(schema.productImages).values(images.slice(0, 8));

      await tx.insert(schema.variants).values(
        matrix.map((v) => {
          const ci = Math.max(0, p.colours.findIndex((c) => c.name === v.colour));
          const si = Math.max(0, p.sizes.indexOf(v.size ?? ''));
          const stock = typeof p.stock === 'number' ? p.stock : p.stock[ci]?.[si] ?? 0;
          return { ...v, productId: row.id, stock };
        }),
      );
    });
    created++;
  }
  log(`products created: ${created} (of ${PRODUCTS.length})`);

  // ---------------------------------------------------------------- delivery zones
  for (const z of DELIVERY_ZONES) {
    await db
      .insert(schema.deliveryZones)
      .values({ code: z.code, name: z.name, etaText: z.etaText, feeKobo: nairaToKobo(z.feeNaira), active: true, sortOrder: z.sortOrder })
      .onConflictDoNothing({ target: schema.deliveryZones.code });
  }
  log('delivery zones ok');

  // ---------------------------------------------------------------- FAQ & pages
  const [{ n: faqCount }] = await db.select({ n: sql<number>`COUNT(*)::int` }).from(schema.faqItems);
  if (Number(faqCount) === 0) {
    await db.insert(schema.faqItems).values(FAQ.map((f, i) => ({ ...f, sortOrder: i })));
    log(`faq items: ${FAQ.length}`);
  }
  for (const pg of PAGES) {
    await db.insert(schema.pages).values(pg).onConflictDoNothing({ target: schema.pages.slug });
  }
  log('pages ok');

  // ---------------------------------------------------------------- settings
  const [settingsRow] = await db.select().from(schema.storeSettings).where(eq(schema.storeSettings.id, 'default')).limit(1);
  if (!settingsRow) {
    const settings: StoredSettings = {
      ...DEFAULT_SETTINGS,
      pickupAddress: process.env.SEED_STORE_ADDRESS ?? '[Store address], Victoria Island, Lagos',
      contactEmail: config.adminNotifyEmail ?? DEFAULT_SETTINGS.contactEmail,
      drop: { title: 'The Night Edit', collectionSlug: DROP_SLUG, goLiveAt: dropGoLive.toISOString(), firstRunTotal: 48 },
    };
    await db.insert(schema.storeSettings).values({ id: 'default', data: settings });
    log('settings created');
  }

  // ---------------------------------------------------------------- sample promo
  await db
    .insert(schema.discounts)
    .values({ code: 'WELCOME10', type: 'PERCENT', value: 10, active: true, minSubtotalKobo: nairaToKobo(50000) })
    .onConflictDoNothing({ target: schema.discounts.code });

  await pool.end();
  log('done');
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
