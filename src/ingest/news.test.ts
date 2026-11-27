import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/config.js', () => ({ config: { SKYBLOCK_NEWS_RSS_URL: '' } }));
const { parseRss } = await import('./news.js');

describe('parseRss', () => {
  it('reads items with CDATA and entities', () => {
    const xml = `<rss><channel><item><title><![CDATA[SkyBlock v0.24 &amp; Fixes]]></title><link>https://hypixel.net/threads/1/</link><pubDate>Fri, 27 Nov 2026 12:00:00 +0000</pubDate></item><item><title>No link</title></item></channel></rss>`;
    expect(parseRss(xml)).toEqual([{ id: 'https://hypixel.net/threads/1/', title: 'SkyBlock v0.24 & Fixes', publishedAt: new Date('2026-11-27T12:00:00Z') }]);
  });
});
