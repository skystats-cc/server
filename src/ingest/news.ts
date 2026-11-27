import { config } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';
import { CircuitBreaker } from './breaker.js';

const breaker = new CircuitBreaker('SkyBlock news');

export interface NewsItem {
  id: string;
  title: string;
  publishedAt: Date | null;
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();

/** Minimal RSS reader: title, link and date of each <item>. */
export function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const body = m[1]!;
    const tag = (t: string) => body.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`))?.[1];
    const link = tag('link');
    const title = tag('title');
    if (!link || !title) continue;
    const date = tag('pubDate');
    const parsed = date ? new Date(decode(date)) : null;
    items.push({ id: decode(link), title: decode(title).slice(0, 300), publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null });
  }
  return items;
}

/** SkyBlock patch notes (Hypixel forums RSS by default). */
export async function fetchPatchNotes(): Promise<NewsItem[]> {
  if (!config.SKYBLOCK_NEWS_RSS_URL) return [];
  return breaker.run(async () => {
    const res = await fetch(config.SKYBLOCK_NEWS_RSS_URL, { headers: { 'User-Agent': 'skystats.cc' } });
    if (!res.ok) throw new UpstreamError(res.status, 'news rss');
    return parseRss(await res.text());
  });
}
