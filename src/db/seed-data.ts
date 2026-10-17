/* Seed content drawn from docs/design/*.dc.html (Home, Shop, Product, Drop, Exchange, Checkout). */
import type { Colour, SizeGuide, ZoneCode } from '../common/contract';

export const C = {
  black: { name: 'Black', hex: '#16161a' },
  tan: { name: 'Tan', hex: '#b07a4a' },
  burgundy: { name: 'Burgundy', hex: '#6b1f2a' },
  ivory: { name: 'Ivory', hex: '#f3efe6' },
  navy: { name: 'Navy', hex: '#0b1c4f' },
  indigo: { name: 'Indigo', hex: '#1e3172' },
  gold: { name: 'Gold', hex: '#c9a45c' },
} satisfies Record<string, Colour>;

export const DROP_SLUG = 'drop-04-the-night-edit';

export interface SeedCollection {
  slug: string;
  name: string;
  description: string;
  isDrop?: boolean;
  heroPattern?: 'ADIRE' | 'ASOOKE' | null;
  exchangeable?: boolean;
  sortOrder: number;
  /** Design v3 §8: home hero panel order (drop first, then 1..4). */
  homeOrder?: number | null;
  heroImageUrl?: string | null;
  tagline?: string | null;
}

const heroImage = (label: string) => `https://placehold.co/1600x1000/cecdcb/000000/png?text=${encodeURIComponent(label)}`;

export const COLLECTIONS: SeedCollection[] = [
  { slug: 'women', name: 'Women', description: "Tailoring, silk and leather for evenings in Lagos. Every piece is a limited run; when it's gone, it's gone.", heroPattern: 'ADIRE', sortOrder: 1, homeOrder: 1, heroImageUrl: heroImage('Women') },
  { slug: 'men', name: 'Men', description: 'Tailoring, knitwear, leather.', sortOrder: 2, homeOrder: 2, heroImageUrl: heroImage('Men') },
  { slug: 'bags-accessories', name: 'Bags & Accessories', description: 'Structured leather, cut to carry a Lagos day into the night.', heroPattern: 'ASOOKE', sortOrder: 3, homeOrder: 3, heroImageUrl: heroImage('Bags & Accessories') },
  { slug: 'shoes', name: 'Shoes', description: 'Nappa and calf leather, sized EU.', sortOrder: 4, homeOrder: 4, heroImageUrl: heroImage('Shoes') },
  { slug: 'new-in', name: 'New In', description: 'This week at the studio.', sortOrder: 5 },
  { slug: 'sale', name: 'Sale', description: 'Last pieces, quietly reduced.', sortOrder: 6 },
  {
    slug: DROP_SLUG,
    name: 'Drop 04 / The Night Edit',
    description: 'Forty-eight pieces cut for Lagos evenings: tailoring, leather and silk in navy, ink and ivory. Limited runs. No restocks.',
    isDrop: true,
    heroPattern: 'ADIRE',
    sortOrder: 0,
    homeOrder: 0,
    heroImageUrl: heroImage('Drop 04'),
    tagline: 'Discover the drop',
  },
  { slug: 'jewellery', name: 'Jewellery', description: 'Finishing pieces. For hygiene reasons jewellery is not exchangeable.', exchangeable: false, sortOrder: 7 },
];

export interface SeedProduct {
  number: string;
  name: string;
  material: string;
  priceNaira: number;
  wasNaira?: number;
  colours: Colour[];
  sizes: string[];
  sizeGuide: SizeGuide;
  collections: string[];
  /** stock[colourIndex][sizeIndex] — or a single number for every variant. */
  stock: number[][] | number;
  daysOld: number;
  description: string;
  details?: string;
  care?: string;
  exchangeable?: boolean;
}

const CLOTHING = ['XS', 'S', 'M', 'L', 'XL'];
const SHOES = ['EU 36', 'EU 37', 'EU 38', 'EU 39', 'EU 40', 'EU 41'];

const LEATHER_CARE = 'Specialist leather clean only. Store on a wide hanger away from direct sun. Condition twice a year.';
const SILK_CARE = 'Dry clean or hand wash cold with silk detergent. Do not wring. Cool iron on the reverse.';

export const PRODUCTS: SeedProduct[] = [
  {
    number: 'No. 014',
    name: 'Cropped leather jacket',
    material: 'Lamb leather · Outerwear',
    priceNaira: 185000,
    colours: [C.black, C.tan, C.burgundy],
    sizes: CLOTHING,
    sizeGuide: 'CLOTHING',
    collections: ['women', 'new-in'],
    stock: [
      [3, 4, 4, 2, 0],
      [2, 3, 3, 2, 0],
      [2, 2, 3, 2, 0],
    ],
    daysOld: 2,
    description: 'A boxy, cropped jacket in buttery lamb leather — the piece that makes a plain dress an entrance.',
    details: 'Cut, fit and finish: boxy cropped shape, dropped shoulder, two-way zip, Adire-print silk lining dyed in Abeokuta. Model is 1.78 m and wears M. Fits true to size.',
    care: `Lamb leather; lining 100% silk. ${LEATHER_CARE}`,
  },
  {
    number: 'No. 022',
    name: 'Silk camp-collar shirt',
    material: 'Mulberry silk · Shirts',
    priceNaira: 62500,
    wasNaira: 78000,
    colours: [C.ivory, C.navy],
    sizes: ['S', 'M', 'L', 'XL'],
    sizeGuide: 'CLOTHING',
    collections: ['men', 'sale'],
    stock: [
      [3, 4, 3, 2],
      [2, 3, 3, 1],
    ],
    daysOld: 75,
    description: 'Relaxed camp-collar shirt in heavy mulberry silk. Worn open over a vest or buttoned to the top.',
    details: 'Relaxed fit, camp collar, mother-of-pearl buttons, straight hem with side vents.',
    care: `100% mulberry silk. ${SILK_CARE}`,
  },
  {
    number: 'No. 031',
    name: 'Structured tote',
    material: 'Calf leather · Bags',
    priceNaira: 240000,
    colours: [C.tan],
    sizes: [],
    sizeGuide: 'NONE',
    collections: ['bags-accessories'],
    stock: 2,
    daysOld: 60,
    description: 'A tall, structured tote in vegetable-tanned calf leather that softens and darkens with every year.',
    details: 'Fits a 14" laptop. Two flat handles (22 cm drop), magnetic closure, interior zip pocket, brass feet.',
    care: `Full-grain calf leather. ${LEATHER_CARE}`,
  },
  {
    number: 'No. 040',
    name: 'Satin slip dress',
    material: 'Silk satin · Dresses',
    priceNaira: 120000,
    colours: [C.navy, C.black],
    sizes: CLOTHING,
    sizeGuide: 'CLOTHING',
    collections: ['women', DROP_SLUG],
    stock: [
      [2, 3, 3, 2, 1],
      [2, 3, 3, 2, 1],
    ],
    daysOld: 3,
    description: 'Bias-cut slip dress in liquid silk satin, falling just above the ankle.',
    details: 'Bias cut, adjustable spaghetti straps, cowl neckline, midi-to-maxi length.',
    care: `100% silk satin. ${SILK_CARE}`,
  },
  {
    number: 'No. 043',
    name: 'Tailored linen blazer',
    material: 'Irish linen · Tailoring',
    priceNaira: 150000,
    colours: [C.ivory, C.black],
    sizes: CLOTHING,
    sizeGuide: 'CLOTHING',
    collections: ['men', 'women'],
    stock: [
      [1, 2, 3, 2, 1],
      [1, 2, 2, 2, 1],
    ],
    daysOld: 90,
    description: 'Single-breasted blazer in breathable Irish linen — tailoring that survives a Lagos afternoon.',
    details: 'Half-canvassed, natural shoulder, two-button front, patch pockets, single vent.',
    care: '100% linen; half lining in cupro. Dry clean. Steam rather than iron.',
  },
  {
    number: 'No. 047',
    name: 'Leather mule',
    material: 'Nappa · Shoes',
    priceNaira: 88000,
    colours: [C.black, C.tan],
    sizes: SHOES,
    sizeGuide: 'SHOES',
    collections: ['shoes', 'women', 'new-in'],
    stock: [
      [1, 2, 3, 3, 2, 1],
      [1, 2, 2, 2, 1, 1],
    ],
    daysOld: 4,
    description: 'A square-toe mule in soft nappa on a low stacked heel.',
    details: '4 cm stacked leather heel, leather lining and sole, padded footbed. Runs true to size.',
    care: `Nappa leather. Wipe clean; use a shoe tree. ${LEATHER_CARE}`,
  },
  {
    number: 'No. 051',
    name: 'Pleated wide-leg trouser',
    material: 'Wool crepe · Trousers',
    priceNaira: 95000,
    colours: [C.navy, C.black],
    sizes: CLOTHING,
    sizeGuide: 'CLOTHING',
    collections: ['women'],
    stock: [
      [1, 3, 3, 2, 1],
      [1, 2, 3, 2, 1],
    ],
    daysOld: 70,
    description: 'High-rise, double-pleated trousers in fluid wool crepe with a full, floor-skimming leg.',
    details: 'High rise, double front pleats, side slant pockets, hook-and-bar closure, pressed crease.',
    care: 'Wool crepe. Dry clean only.',
  },
  {
    number: 'No. 055',
    name: 'Ribbed knit top',
    material: 'Merino · Knitwear',
    priceNaira: 45000,
    colours: [C.ivory, C.burgundy, C.black],
    sizes: ['XS', 'S', 'M', 'L'],
    sizeGuide: 'CLOTHING',
    collections: ['women'],
    stock: [
      [2, 3, 3, 2],
      [1, 2, 2, 1],
      [2, 3, 3, 2],
    ],
    daysOld: 80,
    description: 'Fine-gauge rib top in extra-fine merino. Close fitting, high neck, long sleeve.',
    details: 'Slim fit, mock neck, 2x2 rib throughout.',
    care: 'Extra-fine merino. Hand wash cold, dry flat.',
  },
  {
    number: 'No. 058',
    name: 'Quilted shoulder bag',
    material: 'Lamb leather · Bags',
    priceNaira: 175000,
    colours: [C.black],
    sizes: [],
    sizeGuide: 'NONE',
    collections: ['bags-accessories'],
    stock: 0,
    daysOld: 100,
    description: 'Diamond-quilted lamb leather shoulder bag on a sliding leather-and-chain strap.',
    details: 'Flap with turn-lock, one interior slip pocket, 55 cm adjustable strap.',
    care: `Lamb leather. ${LEATHER_CARE}`,
  },
  {
    number: 'No. 060',
    name: 'High-waist denim',
    material: 'Japanese denim · Trousers',
    priceNaira: 70000,
    wasNaira: 85000,
    colours: [C.indigo],
    sizes: ['24', '26', '28', '30', '32'],
    sizeGuide: 'CLOTHING',
    collections: ['women', 'sale'],
    stock: [[2, 3, 3, 2, 1]],
    daysOld: 95,
    description: 'Straight-leg, high-waist jeans in rigid 13.5 oz Japanese selvedge denim.',
    details: 'High rise, straight leg, button fly, selvedge outseam. Waist sizes in inches.',
    care: '100% cotton. Wash rarely, inside out, cold. Line dry.',
  },
  {
    number: 'No. 063',
    name: 'Draped midi skirt',
    material: 'Silk crepe · Skirts',
    priceNaira: 78000,
    colours: [C.navy],
    sizes: CLOTHING,
    sizeGuide: 'CLOTHING',
    collections: ['women'],
    stock: [[1, 2, 3, 2, 1]],
    daysOld: 65,
    description: 'A side-draped midi skirt in silk crepe that moves with you.',
    details: 'Wrap-effect drape at the hip, concealed side zip, midi length.',
    care: `Silk crepe. ${SILK_CARE}`,
  },
  {
    number: 'No. 066',
    name: 'Block-heel sandal',
    material: 'Calf leather · Shoes',
    priceNaira: 92000,
    colours: [C.black],
    sizes: SHOES,
    sizeGuide: 'SHOES',
    collections: ['shoes', 'women'],
    stock: [[0, 1, 1, 0, 0, 0]],
    daysOld: 85,
    description: 'Two-strap sandal on a 6 cm block heel. Steady enough for a Lagos night out.',
    details: '6 cm block heel, adjustable ankle strap, leather sole.',
    care: `Calf leather. ${LEATHER_CARE}`,
  },
  // Drop 04 — The Night Edit (DropLaunchV2 stock counters: 12, 8, 5, 9)
  {
    number: 'No. 071',
    name: 'Velvet blazer',
    material: 'Silk velvet · Tailoring',
    priceNaira: 210000,
    colours: [C.navy],
    sizes: ['S', 'M', 'L'],
    sizeGuide: 'CLOTHING',
    collections: [DROP_SLUG, 'women', 'men'],
    stock: [[4, 5, 3]],
    daysOld: 1,
    description: 'A shawl-collar evening blazer in midnight silk velvet.',
    details: 'Shawl collar, single button, jetted pockets, Adire-print silk lining.',
    care: 'Silk velvet. Dry clean only. Steam from the reverse; never press the pile.',
  },
  {
    number: 'No. 072',
    name: 'Silk evening shirt',
    material: 'Silk charmeuse · Shirts',
    priceNaira: 85000,
    colours: [C.black],
    sizes: ['S', 'M', 'L'],
    sizeGuide: 'CLOTHING',
    collections: [DROP_SLUG, 'men'],
    stock: [[2, 3, 3]],
    daysOld: 1,
    description: 'A fluid charmeuse shirt with a concealed placket for after dark.',
    details: 'Relaxed fit, concealed placket, French cuffs.',
    care: `Silk charmeuse. ${SILK_CARE}`,
  },
  {
    number: 'No. 073',
    name: 'Leather clutch',
    material: 'Nappa · Bags',
    priceNaira: 140000,
    colours: [C.black],
    sizes: [],
    sizeGuide: 'NONE',
    collections: [DROP_SLUG, 'bags-accessories'],
    stock: 5,
    daysOld: 1,
    description: 'A soft envelope clutch in nappa with a hidden wrist strap.',
    details: 'Magnetic flap, detachable wrist strap, fits a phone and cardholder.',
    care: `Nappa. ${LEATHER_CARE}`,
  },
  {
    number: 'No. 074',
    name: 'Satin wide-leg trouser',
    material: 'Silk satin · Trousers',
    priceNaira: 98000,
    colours: [C.navy],
    sizes: ['XS', 'S', 'M', 'L'],
    sizeGuide: 'CLOTHING',
    collections: [DROP_SLUG, 'women'],
    stock: [[2, 3, 2, 2]],
    daysOld: 1,
    description: 'Wide-leg trousers in heavy silk satin with a soft elasticated back waist.',
    details: 'High rise, wide leg, side pockets, satin waistband.',
    care: `Silk satin. ${SILK_CARE}`,
  },
  {
    number: 'No. 080',
    name: 'Gold-tone hoop set',
    material: 'Gold-plated brass · Jewellery',
    priceNaira: 35000,
    colours: [C.gold],
    sizes: [],
    sizeGuide: 'NONE',
    collections: ['jewellery', 'bags-accessories'],
    stock: 10,
    daysOld: 50,
    description: 'Three sculpted hoops — small, medium, large — in 18k gold-plated brass.',
    details: 'Hinged closures. Set of three pairs. Not exchangeable (jewellery).',
    care: 'Avoid perfume and water. Store in the pouch provided.',
    exchangeable: false,
  },
];

export const DELIVERY_ZONES: { code: ZoneCode; name: string; etaText: string; feeNaira: number; sortOrder: number }[] = [
  { code: 'LAGOS_ISLAND', name: 'Lagos Island', etaText: '1–2 working days', feeNaira: 5000, sortOrder: 1 },
  { code: 'LAGOS_MAINLAND', name: 'Lagos Mainland', etaText: '1–3 working days', feeNaira: 4000, sortOrder: 2 },
  { code: 'LEKKI_AJAH', name: 'Lekki – Ajah', etaText: '1–2 working days', feeNaira: 4500, sortOrder: 3 },
  { code: 'OTHER_STATES', name: 'Other states', etaText: '3–5 working days', feeNaira: 9500, sortOrder: 4 },
  { code: 'PICKUP', name: 'Collect from the store', etaText: 'Ready same day', feeNaira: 0, sortOrder: 5 },
];

export const FAQ: { group: string; question: string; answer: string }[] = [
  { group: 'Orders', question: 'Can I check out as a guest?', answer: 'Yes. You only need an email and phone number. Create an account any time to see your orders, save addresses and use exchange credit.' },
  { group: 'Orders', question: 'How do I find my order?', answer: 'Use your order number (AP-xxxxx) and the email you checked out with on the order lookup page, or sign in to see your full history.' },
  { group: 'Orders', question: 'Can I change or cancel my order?', answer: 'Message us on WhatsApp as soon as possible. Once an order has been dispatched it cannot be changed.' },
  { group: 'Delivery', question: 'Where do you deliver?', answer: 'Across Nigeria. Lagos Island and Lekki–Ajah in 1–2 working days, Lagos Mainland in 1–3, other states in 3–5. Fees are shown at checkout.' },
  { group: 'Delivery', question: 'Can I collect from the store?', answer: 'Yes — choose “Collect from the store” at checkout. It is free and usually ready the same day; we email you when it is ready.' },
  { group: 'Delivery', question: 'Is delivery ever free?', answer: 'Delivery is free on orders over the threshold shown in your bag.' },
  { group: 'Payments', question: 'How can I pay?', answer: 'Paystack for naira cards, bank transfer and USSD. Bachs if you are paying from abroad — cards in your own currency, bank transfer or USDT / USDC. Both settle in naira.' },
  { group: 'Payments', question: 'Is my card information safe?', answer: 'We never see or store your card details. Payment happens on Paystack’s or Bachs’ secure hosted pages.' },
  { group: 'Payments', question: 'My payment went through but I did not get a confirmation.', answer: 'Bank transfers can take a few minutes to confirm. We confirm every payment directly with the provider; if it succeeded you will get an email. Contact us with your order number if not.' },
  { group: 'Exchanges', question: 'Do you offer refunds?', answer: 'No. We offer exchanges only. Return an unworn piece with its tags within 7 days of delivery and we add its full value to your account as exchange credit.' },
  { group: 'Exchanges', question: 'How do I request an exchange?', answer: 'From your account (or the order lookup page), choose the piece, tell us why, and add photos if it helps. We email you return instructions once approved.' },
  { group: 'Exchanges', question: 'How does exchange credit work?', answer: 'Credit is applied automatically at checkout. If your new order costs more, pay the difference; if less, the rest stays on your account. Credit cannot be paid out as cash.' },
  { group: 'Exchanges', question: 'Is everything exchangeable?', answer: 'Almost. Jewellery and pieces marked “not exchangeable” on the product page cannot be exchanged.' },
  { group: 'Sizing', question: 'How do your clothes fit?', answer: 'Most pieces fit true to size; each product page has fit notes and a size guide. Not sure? Ask a stylist on WhatsApp — we answer fast.' },
  { group: 'Sizing', question: 'Which shoe sizes do you use?', answer: 'EU sizing. The size guide on shoe pages converts EU to UK and US.' },
  { group: 'Authenticity', question: 'Are your products genuine?', answer: 'Every piece is designed by Amerapelle and made in limited runs. We do not resell other brands.' },
  { group: 'Authenticity', question: 'Do you restock?', answer: 'Rarely. Drops are limited runs — when a piece is gone, it is gone.' },
];

export const PAGES: { slug: string; title: string; bodyMarkdown: string }[] = [
  {
    slug: 'about',
    title: 'About Amerapelle',
    bodyMarkdown: `# Cut in Lagos for the evenings that matter.

Amerapelle is a Lagos fashion house making tailoring, leather and silk in small, numbered runs. Every piece carries a number — **No. 014**, **No. 022** — and when a run sells out, it is gone.

We work with Adire dyers in Abeokuta and Aso-oke weavers, and we put that cloth where you will feel it: in linings, bands and details.

## Our promises
- **Delivered across Nigeria.** Lagos in 1–3 working days.
- **Exchange, not refund.** Swap any unworn piece for credit.
- **Pay your way.** Paystack in naira, Bachs from abroad.
- **A stylist on WhatsApp.** Fit and sizing, answered fast.`,
  },
  {
    slug: 'delivery',
    title: 'Delivery',
    bodyMarkdown: `# Delivery

| Method | Time | Fee |
| --- | --- | --- |
| Lagos Island | 1–2 working days | Shown at checkout |
| Lagos Mainland | 1–3 working days | Shown at checkout |
| Lekki – Ajah | 1–2 working days | Shown at checkout |
| Other states | 3–5 working days | Flat fee, shown at checkout |
| Collect from the store | Ready same day | Free |

- Orders placed before 2 pm on a working day are usually dispatched the same day.
- Our rider will call the phone number on your order before delivery. Please add a nearest landmark — it helps.
- Delivery is free above the threshold shown in your bag.
- For pickup, we email you when your order is ready. Bring your order number.`,
  },
  {
    slug: 'exchanges',
    title: 'Exchanges — no refunds',
    bodyMarkdown: `# Exchange, not refund

**We do not offer refunds.** Instead, every eligible piece can be exchanged for credit.

## How it works
1. Request an exchange within **7 days of delivery** from your account or the order lookup page.
2. We review it and email you return instructions with our store address.
3. Return the piece **unworn, with its tags and packaging**.
4. When we receive and check it, the **full amount you paid** for it is added to your account as exchange credit.
5. Spend it on something new — credit is applied automatically at checkout.

## Good to know
- If your next order costs more, pay the difference. If it costs less, the rest stays as credit.
- Credit is never paid out as cash.
- Jewellery and pieces marked “not exchangeable” cannot be exchanged.
- If we cannot fulfil an order you have paid for, we will contact you to swap it for another piece or add the full amount to your account as exchange credit.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy policy',
    bodyMarkdown: `# Privacy policy

Amerapelle processes personal data in line with the **Nigeria Data Protection Act 2023 (NDPA)**.

## What we collect
- **Order data:** name, email, phone, delivery address, items purchased.
- **Account data:** name, email, phone, saved addresses, wishlist, exchange credit.
- **Marketing:** your email, only if you tick the marketing consent box.
- **Analytics:** where you came from (e.g. Instagram, TikTok, WhatsApp) so we know which channels work.

We never see or store card details — payments happen on Paystack’s and Bachs’ hosted pages.

## Why
To fulfil and deliver your orders, handle exchanges, answer your messages and (with consent) tell you about drops.

## Who we share it with
Payment providers (Paystack, Bachs), our email provider (Resend), image hosting (Cloudinary) and delivery partners — only what each needs.

## Your rights
You can download all your data from your account (**Data export**) or delete your account at any time (**Delete account**). Order records are kept in de-identified form where the law requires it. Contact us to exercise any other right.`,
  },
  {
    slug: 'terms',
    title: 'Terms of sale',
    bodyMarkdown: `# Terms of sale

1. **Prices** are in Nigerian naira (₦) and include VAT where applicable. Delivery is charged separately unless stated.
2. **Orders** are confirmed only when payment is verified with our payment provider. Stock is held for 15 minutes while you pay.
3. **Payment** is processed by Paystack or Bachs. We do not store card details.
4. **Delivery** times are estimates in working days.
5. **Exchanges, not refunds.** See our Exchanges policy. Exchange credit has no cash value.
6. **Unfulfillable orders:** if we cannot supply a piece you have paid for, we will offer you another piece or add the full amount paid to your account as exchange credit. We do not issue cash refunds.
7. These terms are governed by the laws of the Federal Republic of Nigeria.`,
  },
];
