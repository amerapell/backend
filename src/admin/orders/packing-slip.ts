import type { Order, StoreSettings } from '../../common/contract';
import { escapeHtml as esc } from '../../common/html';
import { formatNaira } from '../../common/money';

/** ADM-3 packing slip: printable HTML, brand-styled, no prices for the gift-friendly section. */
export function renderPackingSlip(order: Order, notes: { body: string }[], settings: Pick<StoreSettings, 'storeName' | 'pickupAddress' | 'contactPhone'>): string {
  const a = order.delivery.address;
  const rows = order.items
    .map(
      (i) =>
        `<tr><td class="mono">${esc(i.number)}</td><td>${esc(i.name)}</td><td>${esc(i.colour ?? '—')}</td><td>${esc(i.size ?? '—')}</td><td class="r">${i.quantity}</td><td class="box"></td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing slip ${esc(order.number)}</title>
<style>
@page{size:A4;margin:16mm}
body{font-family:Inter,Helvetica,Arial,sans-serif;color:#0a0a0f;margin:0;font-size:13px}
.brand{font-family:'Instrument Serif',Georgia,serif;font-size:32px;letter-spacing:-.01em}
.mono{font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;letter-spacing:.06em;color:#6a6b75;text-transform:uppercase}
.bar{height:6px;background:#0b1c4f;margin-bottom:16px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #0a0a0f;padding-bottom:12px}
h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:28px;margin:0}
.cols{display:flex;gap:32px;margin:20px 0}.cols>div{flex:1}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #ececea}
th{font-family:'IBM Plex Mono',Menlo,monospace;font-size:10px;letter-spacing:.06em;color:#6a6b75;text-transform:uppercase}
.r{text-align:right}.box{width:28px}.box:after{content:'';display:inline-block;width:14px;height:14px;border:1px solid #0a0a0f}
.note{border:1px solid #e3e3df;padding:10px;margin-top:16px}
footer{margin-top:28px;border-top:1px solid #0a0a0f;padding-top:10px}
@media print{.noprint{display:none}}
</style></head><body>
<div class="bar"></div>
<header><div><div class="brand">${esc(settings.storeName)}</div><div class="mono">Packing slip</div></div>
<div style="text-align:right"><h1>${esc(order.number)}</h1><div class="mono">${esc(new Date(order.createdAt).toDateString())} · ${esc(order.status)}</div></div></header>
<div class="cols">
<div><div class="mono">${order.delivery.zone === 'PICKUP' ? 'Collect from store' : 'Deliver to'}</div>
${
  a
    ? `<p><strong>${esc(a.fullName)}</strong><br>${esc(a.phone)}<br>${esc(a.street)}<br>${esc(a.area)}, ${esc(a.lga)}<br>${esc(a.state)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}${a.note ? `<br><em>${esc(a.note)}</em>` : ''}</p>`
    : `<p>${esc(settings.pickupAddress)}<br>${esc(order.phone)}</p>`
}</div>
<div><div class="mono">Delivery</div><p>${esc(order.delivery.name)}<br>${esc(order.email)}<br>${esc(order.phone)}</p></div>
<div><div class="mono">Payment</div><p>${esc(order.payment?.provider ?? '—')}<br>${esc(order.payment?.reference ?? '')}<br>Total ${formatNaira(order.totalKobo)}</p></div>
</div>
<table><thead><tr><th>No.</th><th>Piece</th><th>Colour</th><th>Size</th><th class="r">Qty</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
${notes.length ? `<div class="note"><div class="mono">Notes</div>${notes.map((n) => `<p>${esc(n.body)}</p>`).join('')}</div>` : ''}
<footer><div class="mono">Our Exchange Promise · Unworn pieces with tags may be exchanged for credit · ${esc(settings.contactPhone)}</div></footer>
<p class="noprint" style="margin-top:24px"><button onclick="window.print()">Print</button></p>
</body></html>`;
}
