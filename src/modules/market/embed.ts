/** Server-rendered SVG price chart for embeds (forums, READMEs). Pure, no dependencies. */
export function priceSvg(title: string, points: { t: number; v: number }[], w = 480, h = 160) {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(1));
  const pad = { l: 8, r: 8, t: 28, b: 18 };
  let path = '';
  let last = '';
  if (points.length > 1) {
    const ts = points.map((p) => p.t);
    const vs = points.map((p) => p.v);
    const [t0, t1, v0, v1] = [Math.min(...ts), Math.max(...ts), Math.min(...vs), Math.max(...vs)];
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
    const y = (v: number) => h - pad.b - ((v - v0) / (v1 - v0 || 1)) * (h - pad.t - pad.b);
    path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    last = fmt(vs[vs.length - 1]!);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)} price chart">
<rect width="100%" height="100%" rx="10" fill="#121826"/>
<text x="10" y="19" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#e6e9ef">${esc(title)}</text>
<text x="${w - 10}" y="19" text-anchor="end" font-family="system-ui,sans-serif" font-size="13" fill="#f5b942">${last}</text>
${path ? `<path d="${path}" fill="none" stroke="#f5b942" stroke-width="2" stroke-linejoin="round"/>` : `<text x="10" y="${h / 2}" font-family="system-ui,sans-serif" font-size="12" fill="#8a93a6">No data yet</text>`}
<text x="${w - 10}" y="${h - 5}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#8a93a6">skystats.cc</text>
</svg>`;
}
