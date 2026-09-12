import fs from 'node:fs';
import type { EmailAttachment } from './emailSender.js';
import { escapeHtml } from './htmlEscape.js';
import { t } from './i18n/index.js';
import type { Locale } from './i18n/core.js';

const HEADER_CONTENT_ID = '12wy-weekly-header';
let cachedHeader: EmailAttachment | null = null;

export function brandedEmailHeader(): { contentId: string; attachment: EmailAttachment } {
  if (!cachedHeader) {
    cachedHeader = {
      name: '12wy-weekly.jpg',
      contentType: 'image/jpeg',
      contentInBase64: fs
        .readFileSync(new URL('../assets/12wy-email-header.jpg', import.meta.url))
        .toString('base64'),
      contentId: HEADER_CONTENT_ID,
    };
  }
  return { contentId: HEADER_CONTENT_ID, attachment: cachedHeader };
}

export interface BrandedEmailContent {
  subject: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  preheader?: string;
  callout?: { title: string; text: string };
  /** An optional two-column scoreboard rendered between the paragraphs and the callout.
   *  Plain data only — every cell is escaped at this boundary like everything else here, and
   *  the layout is table-based with inline styles so it survives Outlook and Gmail alike.
   *  `highlightRow` marks one row (by index) as the one the email is really about. */
  table?: { caption?: string; rows: { label: string; value: string }[]; highlightRow?: number };
  cta: { label: string; url: string };
  footer: string;
}

export interface BrandedEmail {
  subject: string;
  html: string;
  plainText: string;
  attachments: EmailAttachment[];
}

/** One email-safe shell for every delivery channel. Content stays plain text until this
 * boundary: all text and attributes are escaped here, including configured CTA URLs.
 * The same content generates the text alternative; no scripts, external images or fonts. */
export function renderBrandedEmail(content: BrandedEmailContent, locale: Locale = 'en'): BrandedEmail {
  let protocol: string;
  try { protocol = new URL(content.cta.url).protocol; } catch { protocol = ''; }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error('Email action URL must use absolute HTTP or HTTPS');
  }
  const { contentId, attachment } = brandedEmailHeader();
  // The shell has to follow the recipient's language: an English email laid out right-to-left
  // and right-aligned reads as broken. Only `dir`/alignment change — the palette and structure
  // stay identical in both languages.
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const ctaArrow = dir === 'rtl' ? '←' : '→';
  const paragraphs = content.paragraphs.map((paragraph) =>
    `<p style="margin:0 0 16px;color:#514b60;font-size:16px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(paragraph)}</p>`
  ).join('\n');
  const tableRows = (content.table?.rows ?? []).map((row, index) => {
    const highlighted = index === content.table?.highlightRow;
    const weight = highlighted ? '700' : '400';
    const background = highlighted ? '#f5f0ff' : '#ffffff';
    return `<tr style="background:${background};">
          <td align="${align}" style="padding:9px 14px;border-top:1px solid #eee9f6;color:#514b60;font-size:15px;font-weight:${weight};overflow-wrap:anywhere;">${escapeHtml(row.label)}</td>
          <td align="${align === 'right' ? 'left' : 'right'}" style="padding:9px 14px;border-top:1px solid #eee9f6;color:#24134f;font-size:15px;font-weight:${weight};white-space:nowrap;">${escapeHtml(row.value)}</td>
        </tr>`;
  }).join('\n');
  const scoreTable = content.table && content.table.rows.length > 0
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${dir}" style="margin:4px 0 20px;border:1px solid #e2daf0;border-radius:10px;border-collapse:separate;overflow:hidden;">
        ${content.table.caption ? `<tr><td colspan="2" align="${align}" style="padding:12px 14px;background:#faf7ff;color:#51406c;font-size:13px;font-weight:700;">${escapeHtml(content.table.caption)}</td></tr>` : ''}
        ${tableRows}
      </table>`
    : '';
  const callout = content.callout
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px;background:#faf7ff;border:1px solid #e2daf0;border-radius:10px;">
        <tr><td align="${align}" style="padding:16px 18px;color:#51406c;font-size:15px;line-height:1.8;overflow-wrap:anywhere;">
          <strong style="display:block;margin-bottom:4px;">${escapeHtml(content.callout.title)}</strong>
          ${escapeHtml(content.callout.text)}
        </td></tr>
      </table>`
    : '';
  const plainText = [
    '12WY',
    content.eyebrow,
    '',
    content.title,
    '',
    ...content.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(content.table && content.table.rows.length > 0
      ? [
          ...(content.table.caption ? [content.table.caption] : []),
          ...content.table.rows.map((row) => `${row.label}: ${row.value}`),
          '',
        ]
      : []),
    ...(content.callout ? [content.callout.title, content.callout.text, ''] : []),
    `${content.cta.label}: ${content.cta.url}`,
    '',
    content.footer,
  ].join('\n');
  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(content.subject)}</title>
  <style>@media only screen and (max-width:480px){.email-content{padding:24px 20px!important}.email-title{font-size:24px!important}.email-outer{padding:12px 8px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f1fa;color:#241f33;font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;-webkit-text-size-adjust:100%;">
  <div aria-hidden="true" style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(content.preheader ?? content.title)}</div>
  <table role="presentation" dir="${dir}" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f1fa;">
    <tr><td class="email-outer" align="center" style="padding:28px 12px;">
      <!--[if mso]><table role="presentation" width="620" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid #e7e1f2;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:0;">
          <img src="cid:${escapeHtml(contentId)}" width="620" alt="12WY" style="display:block;width:100%;max-width:620px;height:auto;border:0;">
        </td></tr>
        <tr><td class="email-content" dir="${dir}" align="${align}" style="padding:30px 32px 32px;text-align:${align};">
          <span style="display:inline-block;padding:5px 10px;background:#ede9fe;color:#5b21b6;border-radius:6px;font-size:12px;font-weight:700;">${escapeHtml(content.eyebrow)}</span>
          <h1 class="email-title" style="margin:18px 0 16px;color:#24134f;font-size:28px;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(content.title)}</h1>
          ${paragraphs}
          ${scoreTable}
          ${callout}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">
            <tr><td align="center" bgcolor="#6d42d8" style="background:#6d42d8;border-radius:10px;mso-padding-alt:14px 24px;">
              <a href="${escapeHtml(content.cta.url)}" style="display:inline-block;padding:14px 24px;min-height:20px;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">${escapeHtml(content.cta.label)} ${ctaArrow}</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#676071;font-size:12px;line-height:1.7;">${escapeHtml(t(locale, 'emails.branding.copyLinkText'))}<br>
            <span dir="ltr" style="display:inline-block;max-width:100%;direction:ltr;unicode-bidi:embed;overflow-wrap:anywhere;word-break:break-all;">${escapeHtml(content.cta.url)}</span>
          </p>
        </td></tr>
        <tr><td dir="${dir}" align="center" style="padding:20px 24px;background:#faf9fd;border-top:1px solid #eee9f6;color:#676071;font-size:12px;line-height:1.8;white-space:pre-line;">${escapeHtml(content.footer)}</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
  return { subject: content.subject, html, plainText, attachments: [attachment] };
}
