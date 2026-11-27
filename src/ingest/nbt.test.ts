import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { skyblockItem } from './nbt.js';

// Build NBT by hand: root compound { i: list<compound>[ { Count: byte 3, tag: { ExtraAttributes: { id: "HYPERION" } } } ] }
function str(s: string) { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }
function named(type: number, name: string, payload: Buffer) { return Buffer.concat([Buffer.from([type]), str(name), payload]); }
const end = Buffer.from([0]);
const extra = named(10, 'ExtraAttributes', Buffer.concat([named(8, 'id', str('HYPERION')), end]));
const tag = named(10, 'tag', Buffer.concat([extra, end]));
const entry = Buffer.concat([named(1, 'Count', Buffer.from([3])), tag, end]);
const listHeader = Buffer.alloc(5); listHeader.writeUInt8(10, 0); listHeader.writeInt32BE(1, 1);
const root = named(10, '', Buffer.concat([named(9, 'i', Buffer.concat([listHeader, entry])), end]));

describe('skyblockItem', () => {
  it('reads the SkyBlock id and count', () => {
    expect(skyblockItem(gzipSync(root).toString('base64'))).toEqual({ id: 'HYPERION', count: 3 });
  });
  it('returns null for junk', () => expect(skyblockItem('bm90IG5idA==')).toBeNull());
});
