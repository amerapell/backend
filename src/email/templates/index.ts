import type { Exchange, Order, StoreSettings } from '../../common/contract';
import { formatNaira } from '../../common/money';
import { esc, monoLabel, paragraph, renderLayout, rows, RenderedEmail, rule, toText, BRAND } from './layout';

export interface TemplateContext {
  frontendUrl: string;
  settings: Pick<StoreSettings, 'pickupAddress' | 'openingHours' | 'whatsappNumber' | 'contactEmail' | 'contactPhone' | 'exchangeWindowDays'>;
}

function itemsTable(order: Order): string {
  const lines = order.items
    .map(
      (i) => `<tr>
<td style="padding:12px 0;border-bottom:1px solid ${BRAND.hair};vertical-align:top;">
<div style="font-family:${BRAND.mono};font-size:10px;letter-spacing:.06em;color:${BRAND.muted};">${esc(i.number)}</div>
<div style="font-family:${BRAND.sans};font-size:14px;font-weight:500;color:${BRAND.ink};">${esc(i.name)}</div>
<div style="font-family:${BRAND.mono};font-size:11px;color:${BRAND.muted};">${esc([i.colour, i.size, `QTY ${i.quantity}`].filter(Boolean).join(' · ').toUpperCase())}</div>
</td>
<td align="right" style="padding:12px 0;border-bottom:1px solid ${BRAND.hair};vertical-align:top;font-family:${BRAND.sans};font-size:14px;color:${BRAND.ink};">${formatNaira(i.unitKobo * i.quantity)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid ${BRAND.ink};">${lines}</table>`;
}

function totals(order: Order): string {
  const r: [string, string][] = [['Subtotal', formatNaira(order.subtotalKobo)]];
  if (order.discountKobo) r.push(['Discount', '−' + formatNaira(order.discountKobo)]);
  r.push([`Delivery · ${order.delivery.name}`, order.deliveryKobo ? formatNaira(order.deliveryKobo) : 'Free']);
  if (order.creditAppliedKobo) r.push(['Exchange credit', '−' + formatNaira(order.creditAppliedKobo)]);
  r.push(['Total paid', `<strong style="font-family:${BRAND.serif};font-size:20px;font-weight:400;">${formatNaira(order.amountDueKobo)}</strong>`]);
  return rows(r);
}

function addressBlock(order: Order, ctx: TemplateContext): string {
  if (order.delivery.zone === 'PICKUP') {
    return paragraph(`${monoLabel('Collect from')}<br>${esc(ctx.settings.pickupAddress)}<br>${esc(ctx.settings.openingHours)}`);
  }
  const a = order.delivery.address;
  if (!a) return '';
  return paragraph(
    `${monoLabel('Delivering to')}<br>${esc(a.fullName)} · ${esc(a.phone)}<br>${esc(a.street)}, ${esc(a.area)}<br>${esc(a.lga)}, ${esc(a.state)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}`,
  );
}

export function orderConfirmationEmail(order: Order, ctx: TemplateContext): RenderedEmail {
  const pickup = order.delivery.zone === 'PICKUP';
  const next = pickup
    ? 'We will email you as soon as your order is ready to collect. Bring your order number.'
    : `We are preparing your pieces. You will get an email when your order is dispatched (${order.delivery.name}).`;
  return {
    subject: `Order ${order.number} confirmed — Amerapelle`,
    html: renderLayout({
      preheader: `Thank you. Order ${order.number} is confirmed.`,
      eyebrow: `Order ${order.number} · Confirmed`,
      headlineHtml: 'Thank you. It is <em>yours.</em>',
      bodyHtml:
        paragraph(next) +
        itemsTable(order) +
        totals(order) +
        rule() +
        addressBlock(order, ctx) +
        paragraph(
          `Our Exchange Promise: unworn pieces with tags can be exchanged for credit within ${ctx.settings.exchangeWindowDays} days of delivery. <a href="${esc(ctx.frontendUrl)}/policies/exchanges" style="color:${BRAND.navy};">Read the policy</a>.`,
        ),
      cta: { label: 'View your order', url: `${ctx.frontendUrl}/account/orders/${order.number}` },
    }),
    text: toText([
      `Order ${order.number} confirmed.`,
      ...order.items.map((i) => `- ${i.name} (${[i.colour, i.size].filter(Boolean).join(', ')}) x${i.quantity} ${formatNaira(i.unitKobo * i.quantity)}`),
      `Total paid: ${formatNaira(order.amountDueKobo)}`,
      next,
    ]),
  };
}

export function adminNewOrderEmail(order: Order, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `New order ${order.number} · ${formatNaira(order.totalKobo)} · ${order.payment?.provider ?? '—'}`,
    html: renderLayout({
      preheader: `New order ${order.number}`,
      eyebrow: 'Admin · New order',
      headlineHtml: `${esc(order.number)} — <em>${formatNaira(order.totalKobo)}</em>`,
      bodyHtml:
        rows([
          ['Customer', esc(order.email)],
          ['Phone', esc(order.phone)],
          ['Delivery', esc(order.delivery.name)],
          ['Paid via', esc(order.payment?.provider ?? '—')],
          ['Reference', esc(order.payment?.reference ?? '—')],
        ]) +
        rule() +
        itemsTable(order) +
        totals(order) +
        addressBlock(order, ctx),
      cta: { label: 'Open in admin', url: `${ctx.frontendUrl}/admin/orders/${order.id}` },
    }),
    text: toText([`New order ${order.number}`, `${order.email} ${order.phone}`, `Total ${formatNaira(order.totalKobo)}`]),
  };
}

export function orderStatusEmail(order: Order, ctx: TemplateContext, extra: { creditReturnedKobo?: number } = {}): RenderedEmail | null {
  const url = `${ctx.frontendUrl}/account/orders/${order.number}`;
  switch (order.status) {
    case 'PROCESSING':
      return {
        subject: `We're preparing order ${order.number}`,
        html: renderLayout({
          preheader: `Your order ${order.number} is being prepared.`,
          eyebrow: `Order ${order.number} · Preparing`,
          headlineHtml: 'Being <em>prepared.</em>',
          bodyHtml:
            paragraph(order.delivery.zone === 'PICKUP' ? "We're getting your pieces ready. We'll email you as soon as they're ready to collect." : "We're getting your pieces ready. We'll email you again when your order is on its way.") +
            itemsTable(order),
          cta: { label: 'View order', url },
        }),
        text: toText([`We're preparing order ${order.number}.`, url]),
      };
    case 'CANCELLED': {
      const credit = extra.creditReturnedKobo ?? 0;
      return {
        subject: `Order ${order.number} cancelled`,
        html: renderLayout({
          preheader: credit ? `${formatNaira(credit)} has been added to your account as credit.` : `Your order ${order.number} has been cancelled.`,
          eyebrow: `Order ${order.number} · Cancelled`,
          headlineHtml: "We're <em>sorry.</em>",
          bodyHtml:
            paragraph("We couldn't fulfil your order, so we've cancelled it.") +
            itemsTable(order) +
            (credit
              ? rows([['Credit added', formatNaira(credit)]]) +
                paragraph('The full amount is now exchange credit on your account. It is applied automatically at checkout, so you can choose another piece. Credit cannot be paid out as cash.')
              : '') +
            paragraph(`Questions? Message us on WhatsApp (${esc(ctx.settings.whatsappNumber)}) with your order number.`),
          cta: credit ? { label: 'Choose another piece', url: `${ctx.frontendUrl}/c/new-in` } : { label: 'View order', url },
        }),
        text: toText([`Order ${order.number} cancelled.`, credit ? `${formatNaira(credit)} added as exchange credit.` : '']),
      };
    }
    case 'DISPATCHED':
      return {
        subject: `Order ${order.number} is on its way`,
        html: renderLayout({
          preheader: `Your order ${order.number} has been dispatched.`,
          eyebrow: `Order ${order.number} · Dispatched`,
          headlineHtml: 'On its <em>way.</em>',
          bodyHtml:
            paragraph(`Your order is on its way. Expected: ${esc(order.delivery.name)}. Our rider will call the number on your order before delivery.`) +
            itemsTable(order) +
            addressBlock(order, ctx),
          cta: { label: 'Track your order', url },
        }),
        text: toText([`Order ${order.number} is on its way.`, url]),
      };
    case 'READY_FOR_PICKUP':
      return {
        subject: `Order ${order.number} is ready to collect`,
        html: renderLayout({
          preheader: `Your order ${order.number} is ready for pickup.`,
          eyebrow: `Order ${order.number} · Ready for pickup`,
          headlineHtml: 'Ready when <em>you are.</em>',
          bodyHtml:
            paragraph('Your pieces are wrapped and waiting. Bring your order number (and ID if someone collects for you).') +
            rows([
              ['Store', esc(ctx.settings.pickupAddress)],
              ['Hours', esc(ctx.settings.openingHours)],
            ]) +
            itemsTable(order),
          cta: { label: 'View order', url },
        }),
        text: toText([`Order ${order.number} is ready to collect at ${ctx.settings.pickupAddress}.`, ctx.settings.openingHours]),
      };
    case 'DELIVERED':
      return {
        subject: `Order ${order.number} delivered`,
        html: renderLayout({
          preheader: `Your order ${order.number} has been delivered.`,
          eyebrow: `Order ${order.number} · Delivered`,
          headlineHtml: 'Wear it <em>well.</em>',
          bodyHtml:
            paragraph('Your order has been delivered. We hope you love it.') +
            paragraph(
              `Not quite right? Exchange any unworn piece with its tags for credit until ${order.exchangeableUntil ? esc(new Date(order.exchangeableUntil).toDateString()) : `${ctx.settings.exchangeWindowDays} days after delivery`}. No refunds — exchange credit only.`,
            ),
          cta: { label: 'Request an exchange', url },
        }),
        text: toText([`Order ${order.number} delivered.`, url]),
      };
    default:
      return null;
  }
}

function exchangeItems(ex: Exchange): string {
  return rows(ex.items.map((i) => [`${i.name} × ${i.quantity}`, formatNaira(i.valueKobo)] as [string, string]));
}

export function exchangeRequestedAdminEmail(ex: Exchange, customerEmail: string, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Exchange ${ex.number} requested on ${ex.orderNumber}`,
    html: renderLayout({
      preheader: `New exchange request ${ex.number}`,
      eyebrow: 'Admin · Exchange requested',
      headlineHtml: `${esc(ex.number)} — <em>${esc(ex.reason)}</em>`,
      bodyHtml:
        rows([
          ['Order', esc(ex.orderNumber)],
          ['Customer', esc(customerEmail)],
          ['Value', formatNaira(ex.items.reduce((n, i) => n + i.valueKobo, 0))],
        ]) +
        rule() +
        exchangeItems(ex) +
        (ex.note ? paragraph(`${monoLabel('Note')}<br>${esc(ex.note)}`) : '') +
        (ex.photoUrls.length ? paragraph(ex.photoUrls.map((u, n) => `<a href="${esc(u)}" style="color:${BRAND.navy};">Photo ${n + 1}</a>`).join(' · ')) : ''),
      cta: { label: 'Review in admin', url: `${ctx.frontendUrl}/admin/exchanges/${ex.id}` },
    }),
    text: toText([`Exchange ${ex.number} requested on ${ex.orderNumber} by ${customerEmail}. Reason: ${ex.reason}`]),
  };
}

export function exchangeApprovedEmail(ex: Exchange, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Exchange ${ex.number} approved — how to return your piece`,
    html: renderLayout({
      preheader: 'Your exchange is approved. Here is how to return your piece.',
      eyebrow: `Exchange ${ex.number} · Approved`,
      headlineHtml: 'Approved. <em>Send it back.</em>',
      bodyHtml:
        paragraph('Good news — your exchange request is approved. Please return the piece unworn, with its tags and original packaging, within 7 days.') +
        exchangeItems(ex) +
        rule() +
        paragraph(`${monoLabel('Return to')}<br>${esc(ctx.settings.pickupAddress)}<br>${esc(ctx.settings.openingHours)}`) +
        paragraph(
          `Drop it off in person or send it with a rider. Write <strong>${esc(ex.number)}</strong> on the package. Once we receive and check it, the full value is added to your account as exchange credit to spend on something new.`,
        ) +
        (ex.history.at(-1)?.note ? paragraph(`${monoLabel('Note from Amerapelle')}<br>${esc(ex.history.at(-1)?.note)}`) : ''),
      cta: { label: 'Track your exchange', url: `${ctx.frontendUrl}/account/exchanges` },
    }),
    text: toText([
      `Exchange ${ex.number} approved.`,
      `Return the piece unworn with tags to: ${ctx.settings.pickupAddress} (${ctx.settings.openingHours}). Write ${ex.number} on the package.`,
    ]),
  };
}

export function exchangeDeclinedEmail(ex: Exchange, ctx: TemplateContext): RenderedEmail {
  const note = ex.history.at(-1)?.note;
  return {
    subject: `Exchange ${ex.number} — update on your request`,
    html: renderLayout({
      preheader: 'An update on your exchange request.',
      eyebrow: `Exchange ${ex.number} · Declined`,
      headlineHtml: 'We could not approve <em>this one.</em>',
      bodyHtml:
        paragraph('We are sorry — we are unable to accept this exchange request.') +
        (note ? paragraph(`${monoLabel('Reason')}<br>${esc(note)}`) : '') +
        paragraph(`If you think this is a mistake, message us on WhatsApp (${esc(ctx.settings.whatsappNumber)}) with your exchange number.`),
      cta: { label: 'Read the exchange policy', url: `${ctx.frontendUrl}/policies/exchanges` },
    }),
    text: toText([`Exchange ${ex.number} declined.`, note ?? '']),
  };
}

export function creditIssuedEmail(ex: Exchange, balanceKobo: number, expiresAt: Date | null, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `${formatNaira(ex.creditKobo)} exchange credit added`,
    html: renderLayout({
      preheader: `${formatNaira(ex.creditKobo)} has been added to your account.`,
      eyebrow: `Exchange ${ex.number} · Credit issued`,
      headlineHtml: `<em>${formatNaira(ex.creditKobo)}</em> to spend.`,
      bodyHtml:
        paragraph('We received your piece. The full value is now exchange credit on your account — it is applied automatically at checkout.') +
        rows([
          ['Credit added', formatNaira(ex.creditKobo)],
          ['Balance', formatNaira(balanceKobo)],
          ['Expires', expiresAt ? esc(expiresAt.toDateString()) : 'Never'],
        ]) +
        paragraph('Credit cannot be paid out as cash. If your next order costs more, pay the difference; if less, the rest stays as credit.'),
      cta: { label: 'Shop new in', url: `${ctx.frontendUrl}/c/new-in` },
    }),
    text: toText([`${formatNaira(ex.creditKobo)} exchange credit added. Balance ${formatNaira(balanceKobo)}.`]),
  };
}

export function passwordResetEmail(firstName: string, link: string): RenderedEmail {
  return {
    subject: 'Reset your Amerapelle password',
    html: renderLayout({
      preheader: 'Reset your password — link valid for 1 hour.',
      eyebrow: 'Account · Password reset',
      headlineHtml: 'A new <em>password.</em>',
      bodyHtml:
        paragraph(`Hi ${esc(firstName || 'there')}, we received a request to reset your password. The link below is valid for 1 hour.`) +
        paragraph('If you did not ask for this, you can ignore this email — your password will not change.'),
      cta: { label: 'Reset password', url: link },
    }),
    text: toText(['Reset your Amerapelle password (valid 1 hour):', link]),
  };
}

export function verifyEmailEmail(firstName: string, link: string): RenderedEmail {
  return {
    subject: 'Confirm your email',
    html: renderLayout({
      preheader: 'Confirm your email to use exchange credit and see past orders.',
      eyebrow: 'Account · Confirm your email',
      headlineHtml: 'One last <em>step.</em>',
      bodyHtml:
        paragraph(`Hi ${esc(firstName || 'there')}, welcome to Amerapelle. Confirm this is your email address so we can link your exchange credit and past orders to your account.`) +
        paragraph('The link below is valid for 24 hours. If you did not create an account, you can ignore this email.'),
      cta: { label: 'Confirm email', url: link },
    }),
    text: toText(['Confirm your Amerapelle email (valid 24 hours):', link]),
  };
}

export interface ContactMessageInput {
  name: string;
  email: string;
  phone?: string | null;
  subject: string;
  message: string;
}

export function contactFormEmail(msg: ContactMessageInput): RenderedEmail {
  return {
    subject: `Contact form: ${msg.subject}`,
    html: renderLayout({
      preheader: `Message from ${msg.name}`,
      eyebrow: 'Admin · Contact form',
      headlineHtml: esc(msg.subject),
      bodyHtml:
        rows([
          ['Name', esc(msg.name)],
          ['Email', esc(msg.email)],
          ['Phone', esc(msg.phone ?? '—')],
        ]) +
        rule() +
        paragraph(esc(msg.message).replace(/\n/g, '<br>')),
      footerNote: 'Reply to this email to answer the customer directly.',
    }),
    text: toText([`From: ${msg.name} <${msg.email}> ${msg.phone ?? ''}`, `Subject: ${msg.subject}`, '', msg.message]),
  };
}

export function orderNotCompletedEmail(order: Order, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Order ${order.number} wasn't completed`,
    html: renderLayout({
      preheader: 'We did not receive payment in time. Your bag is still saved.',
      eyebrow: `Order ${order.number} · Not completed`,
      headlineHtml: 'Payment <em>not received.</em>',
      bodyHtml:
        paragraph("We didn't receive payment for this order in time, so it has been closed and the pieces released. Nothing has been charged.") +
        itemsTable(order) +
        paragraph('Your bag is still saved if you would like to try again.'),
      cta: { label: 'Back to your bag', url: `${ctx.frontendUrl}/bag` },
    }),
    text: toText([`Order ${order.number} wasn't completed — payment was not received in time. Nothing has been charged.`, `${ctx.frontendUrl}/bag`]),
  };
}

export function exchangeRequestedCustomerEmail(ex: Exchange, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `We received your exchange request ${ex.number}`,
    html: renderLayout({
      preheader: 'We will review your exchange request and reply by email.',
      eyebrow: `Exchange ${ex.number} · Received`,
      headlineHtml: 'Request <em>received.</em>',
      bodyHtml:
        paragraph(`Thank you. We've received your exchange request for order ${esc(ex.orderNumber)} and will reply by email, usually within one working day. Please keep the piece unworn, with its tags.`) +
        exchangeItems(ex),
      cta: { label: 'Track your exchange', url: `${ctx.frontendUrl}/account/exchanges` },
    }),
    text: toText([`We received your exchange request ${ex.number} for order ${ex.orderNumber}.`]),
  };
}

export function exchangeCompletedEmail(ex: Exchange, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Exchange ${ex.number} complete`,
    html: renderLayout({
      preheader: 'Your exchange is complete.',
      eyebrow: `Exchange ${ex.number} · Complete`,
      headlineHtml: 'All <em>done.</em>',
      bodyHtml: paragraph('Your exchange is complete. Thank you for shopping with Amerapelle.') + exchangeItems(ex),
      cta: { label: 'View your exchanges', url: `${ctx.frontendUrl}/account/exchanges` },
    }),
    text: toText([`Exchange ${ex.number} complete.`]),
  };
}

export function passwordChangedEmail(firstName: string, ctx: TemplateContext): RenderedEmail {
  return {
    subject: 'Your Amerapelle password was changed',
    html: renderLayout({
      preheader: 'Your password was changed.',
      eyebrow: 'Account · Security',
      headlineHtml: 'Password <em>changed.</em>',
      bodyHtml:
        paragraph(`Hi ${esc(firstName || 'there')}, the password for your Amerapelle account was just changed and you've been signed out on other devices.`) +
        paragraph(`If this wasn't you, reset your password straight away and message us on WhatsApp (${esc(ctx.settings.whatsappNumber)}).`),
      cta: { label: 'Reset password', url: `${ctx.frontendUrl}/account?view=forgot` },
    }),
    text: toText(['Your Amerapelle password was changed. If this was not you, reset it and contact us.']),
  };
}

/** After a customer confirms their email (or first signs in with Google). */
export function welcomeEmail(firstName: string, ctx: TemplateContext): RenderedEmail {
  return {
    subject: 'Welcome to Amerapelle',
    html: renderLayout({
      preheader: 'Your account is ready.',
      eyebrow: 'Welcome',
      headlineHtml: 'Welcome to <em>Amerapelle.</em>',
      bodyHtml:
        paragraph(`Hi ${esc(firstName || 'there')}, your account is ready.`) +
        paragraph('AMERAPELLE is a luxury multi-brand fashion house — fashion, statement handbags, footwear and accessories, curated for those who dress with intention.') +
        paragraph('From your account you can track orders, save pieces to your wishlist and request exchanges.') +
        paragraph(`Need help with sizing or styling? Message a stylist on WhatsApp (${esc(ctx.settings.whatsappNumber)})${ctx.settings.pickupAddress ? `, or visit us at ${esc(ctx.settings.pickupAddress)}` : ''}.`),
      cta: { label: 'Discover New In', url: `${ctx.frontendUrl}/c/new-in` },
    }),
    text: toText([`Welcome to Amerapelle, ${firstName || 'there'}. Your account is ready.`, `Discover New In: ${ctx.frontendUrl}/c/new-in`]),
  };
}

/** Footer / welcome pop-up newsletter sign-up. */
export function newsletterWelcomeEmail(ctx: TemplateContext): RenderedEmail {
  return {
    subject: "You're on the Amerapelle list",
    html: renderLayout({
      preheader: 'Thank you for signing up.',
      eyebrow: 'Amerapelle News',
      headlineHtml: "You're on the <em>list.</em>",
      bodyHtml:
        paragraph('Thank you for signing up. You will be the first to hear about new arrivals, private sales and events at our Lagos store.') +
        paragraph('Changed your mind? Reply to this email with "unsubscribe", or untick the newsletter in your account, and we will take you off the list.'),
      cta: { label: 'Discover New In', url: `${ctx.frontendUrl}/c/new-in` },
    }),
    text: toText(["You're on the Amerapelle list.", `Discover New In: ${ctx.frontendUrl}/c/new-in`, 'Reply "unsubscribe" to stop.']),
  };
}

export interface BackInStockItem {
  productName: string;
  productSlug: string;
  colour: string | null;
  size: string | null;
  priceKobo: number;
  imageUrl: string | null;
}

/** "Notify me when available" — the size the customer asked for is back. */
export function backInStockEmail(item: BackInStockItem, ctx: TemplateContext): RenderedEmail {
  const url = `${ctx.frontendUrl}/p/${encodeURIComponent(item.productSlug)}`;
  const option = [item.colour, item.size ? `Size ${item.size}` : null].filter(Boolean).join(' · ');
  const image = item.imageUrl
    ? `<p style="margin:0 0 20px;"><a href="${esc(url)}"><img src="${esc(item.imageUrl)}${item.imageUrl.includes('?') ? '&' : '?'}w=480" alt="${esc(item.productName)}" width="240" style="display:block;width:240px;max-width:100%;height:auto;border:0;background:${BRAND.hair};"></a></p>`
    : '';
  return {
    subject: `Back in stock: ${item.productName}`,
    html: renderLayout({
      preheader: `${item.productName}${item.size ? ` in ${item.size}` : ''} is available again.`,
      eyebrow: 'Back in stock',
      headlineHtml: 'It is <em>back.</em>',
      bodyHtml:
        image +
        paragraph(`<strong>${esc(item.productName)}</strong>${option ? `<br>${esc(option)}` : ''}<br>${formatNaira(item.priceKobo)}`) +
        paragraph('You asked us to tell you when this was available again. Pieces are in small numbers, so it may not stay long.'),
      cta: { label: 'Shop it now', url },
    }),
    text: toText([`Back in stock: ${item.productName}${option ? ` (${option})` : ''} — ${formatNaira(item.priceKobo)}`, url]),
  };
}
