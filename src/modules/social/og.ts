import { Resvg } from '@resvg/resvg-js';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 1200x630 share card as PNG (Discord, X, etc. don't accept SVG previews) */
export function shareCard(title: string, subtitle: string, stat: string, statLabel: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b0f17"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="#121826" stroke="#1f2737" stroke-width="2"/>
  <text x="100" y="170" font-family="DejaVu Sans, sans-serif" font-size="64" font-weight="bold" fill="#e6e9ef">${esc(title).slice(0, 40)}</text>
  <text x="100" y="230" font-family="DejaVu Sans, sans-serif" font-size="30" fill="#8a93a6">${esc(subtitle).slice(0, 70)}</text>
  <text x="100" y="400" font-family="DejaVu Sans, sans-serif" font-size="96" font-weight="bold" fill="#f5b942">${esc(stat).slice(0, 20)}</text>
  <text x="100" y="450" font-family="DejaVu Sans, sans-serif" font-size="28" fill="#8a93a6">${esc(statLabel).slice(0, 60)}</text>
  <text x="1100" y="550" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold" fill="#e6e9ef">SkyStats<tspan fill="#8a93a6">.cc</tspan></text>
</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

/** Minimal HTML with Open Graph tags, served to link-preview crawlers only (Caddy routes them here) */
export function ogPage(o: { title: string; description: string; image: string; url: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${esc(o.image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(o.url)}"><meta property="og:site_name" content="SkyStats.cc"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f5b942"></head><body><a href="${esc(o.url)}">${esc(o.title)}</a></body></html>`;
}
