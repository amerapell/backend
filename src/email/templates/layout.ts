import { escapeHtml } from '../../common/html';

export const BRAND = {
  ink: '#0a0a0f',
  ink2: '#3a3b45',
  muted: '#6a6b75',
  hair: '#ececea',
  navy: '#0b1c4f',
  red: '#d3262c',
  serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  sans: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  preheader: string;
  eyebrow: string;
  /** Headline HTML — may include one <em> word rendered navy italic. */
  headlineHtml: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}

export const esc = escapeHtml;

export function monoLabel(text: string): string {
  return `<span style="font-family:${BRAND.mono};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};">${esc(text)}</span>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${BRAND.sans};font-size:15px;line-height:24px;color:${BRAND.ink2};">${html}</p>`;
}

export function rule(): string {
  return `<div style="height:1px;background:${BRAND.ink};margin:24px 0;line-height:1px;font-size:1px;">&nbsp;</div>`;
}

/** Key/value rows (mono label left, value right). */
export function rows(items: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid ${BRAND.hair};">${monoLabel(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${BRAND.hair};font-family:${BRAND.sans};font-size:14px;color:${BRAND.ink};">${v}</td></tr>`,
    )
    .join('')}</table>`;
}

export function renderLayout(input: LayoutInput): string {
  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr><td style="background:${BRAND.ink};"><a href="${esc(input.cta.url)}" style="display:inline-block;padding:16px 28px;font-family:${BRAND.sans};font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">${esc(input.cta.label)} &rarr;</a></td></tr></table>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Amerapelle</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="height:6px;background:${BRAND.navy};line-height:6px;font-size:6px;">&nbsp;</td></tr>
<tr><td style="padding:28px 0 20px;border-bottom:1px solid ${BRAND.hair};">
<span style="font-family:${BRAND.serif};font-size:30px;letter-spacing:-0.01em;color:${BRAND.ink};">Amerapelle</span>
</td></tr>
<tr><td style="padding:32px 0 8px;">${monoLabel(input.eyebrow)}</td></tr>
<tr><td style="padding:0 0 24px;font-family:${BRAND.serif};font-weight:400;font-size:40px;line-height:44px;letter-spacing:-0.02em;color:${BRAND.ink};">${input.headlineHtml.replace(/<em>/g, `<em style="color:${BRAND.navy};font-style:italic;">`)}</td></tr>
<tr><td>${input.bodyHtml}${cta}</td></tr>
<tr><td style="padding:32px 0 40px;">${rule()}
<p style="margin:0 0 6px;font-family:${BRAND.mono};font-size:11px;letter-spacing:.06em;color:${BRAND.muted};">EXCHANGE, NOT REFUND · LAGOS</p>
<p style="margin:0;font-family:${BRAND.sans};font-size:12px;line-height:18px;color:${BRAND.muted};">${esc(input.footerNote ?? 'Questions? Reply to this email or message a stylist on WhatsApp.')}</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function toText(lines: (string | null | undefined | false)[]): string {
  return lines.filter((l): l is string => typeof l === 'string').join('\n');
}
