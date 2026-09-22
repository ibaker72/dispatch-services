/**
 * Email layout. Every message renders to HTML and to an equivalent plain-text
 * body. All dynamic values are HTML-escaped; links are restricted to http(s).
 */
export interface EmailContent {
  subject: string;
  preheader?: string;
  heading: string;
  paragraphs: string[];
  details?: Array<[label: string, value: string]>;
  cta?: { label: string; url: string };
  footnote?: string;
}

export interface EmailBrand {
  brandName: string;
  legalEntity: string;
  address: string;
  supportEmail: string;
  phone: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHref(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "#";
  } catch {
    return "#";
  }
}

const COLORS = { navy: "#0f1f33", ink: "#1b2733", muted: "#4a5a6a", paper: "#faf8f5", line: "#e3ded6", accent: "#f2a900" };

export function renderEmail(content: EmailContent, brand: EmailBrand): { subject: string; html: string; text: string } {
  const details = content.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border-collapse:collapse">${content.details
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;width:40%">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;color:${COLORS.ink}">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const cta = content.cta
    ? `<p style="margin:0 0 24px"><a href="${escapeHtml(safeHref(content.cta.url))}" style="display:inline-block;background:${COLORS.navy};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;font-size:15px">${escapeHtml(content.cta.label)}</a></p>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.paper};font-family:Arial,Helvetica,sans-serif;color:${COLORS.ink}">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.preheader ?? content.paragraphs[0] ?? "")}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:8px">
<tr><td style="background:${COLORS.navy};padding:18px 24px;border-radius:8px 8px 0 0;border-bottom:4px solid ${COLORS.accent}"><span style="color:#ffffff;font-size:17px;font-weight:bold">${escapeHtml(brand.brandName)}</span></td></tr>
<tr><td style="padding:28px 24px 8px">
<h1 style="font-size:21px;line-height:1.3;margin:0 0 16px;color:${COLORS.navy}">${escapeHtml(content.heading)}</h1>
${content.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 16px">${escapeHtml(p)}</p>`).join("\n")}
${details}${cta}
${content.cta ? `<p style="font-size:13px;line-height:1.5;color:${COLORS.muted};margin:0 0 16px">If the button does not work, copy this link into your browser:<br>${escapeHtml(safeHref(content.cta.url))}</p>` : ""}
${content.footnote ? `<p style="font-size:13px;line-height:1.5;color:${COLORS.muted};margin:0 0 16px">${escapeHtml(content.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${COLORS.line};font-size:12px;line-height:1.5;color:${COLORS.muted}">
${escapeHtml(brand.legalEntity)} · ${escapeHtml(brand.address)}<br>
Questions? ${escapeHtml(brand.supportEmail)} · ${escapeHtml(brand.phone)}<br>
${escapeHtml(brand.brandName)} provides dispatch services to motor carriers that hold their own operating authority. We are not a freight broker or motor carrier.
</td></tr></table></td></tr></table></body></html>`;

  const textLines = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.details?.length ? [...content.details.map(([l, v]) => `${l}: ${v}`), ""] : []),
    ...(content.cta ? [`${content.cta.label}: ${safeHref(content.cta.url)}`, ""] : []),
    ...(content.footnote ? [content.footnote, ""] : []),
    "--",
    `${brand.brandName} — ${brand.legalEntity}`,
    brand.address,
    `${brand.supportEmail} · ${brand.phone}`,
    "We provide dispatch services to motor carriers that hold their own operating authority. We are not a freight broker or motor carrier.",
  ];
  return { subject: content.subject, html, text: textLines.join("\n") };
}
