import { gunzipSync } from 'node:zlib';

// Minimal reader for Minecraft NBT (big-endian), as used in auction item_bytes.
type Nbt = number | bigint | string | Nbt[] | { [k: string]: Nbt } | number[];

class Reader {
  o = 0;
  constructor(private b: Buffer) {}
  byte() { return this.b.readInt8(this.o++); }
  ubyte() { return this.b.readUInt8(this.o++); }
  short() { const v = this.b.readInt16BE(this.o); this.o += 2; return v; }
  int() { const v = this.b.readInt32BE(this.o); this.o += 4; return v; }
  long() { const v = this.b.readBigInt64BE(this.o); this.o += 8; return v; }
  float() { const v = this.b.readFloatBE(this.o); this.o += 4; return v; }
  double() { const v = this.b.readDoubleBE(this.o); this.o += 8; return v; }
  str() { const n = this.b.readUInt16BE(this.o); this.o += 2; const s = this.b.toString('utf8', this.o, this.o + n); this.o += n; return s; }
  payload(type: number): Nbt {
    switch (type) {
      case 1: return this.byte();
      case 2: return this.short();
      case 3: return this.int();
      case 4: return this.long();
      case 5: return this.float();
      case 6: return this.double();
      case 7: { const n = this.int(); const a: number[] = []; for (let i = 0; i < n; i++) a.push(this.byte()); return a; }
      case 8: return this.str();
      case 9: { const t = this.ubyte(); const n = this.int(); const a: Nbt[] = []; for (let i = 0; i < n; i++) a.push(this.payload(t)); return a; }
      case 10: { const obj: Record<string, Nbt> = {}; for (;;) { const t = this.ubyte(); if (t === 0) return obj; const name = this.str(); obj[name] = this.payload(t); } }
      case 11: { const n = this.int(); const a: number[] = []; for (let i = 0; i < n; i++) a.push(this.int()); return a; }
      case 12: { const n = this.int(); const a: Nbt[] = []; for (let i = 0; i < n; i++) a.push(this.long()); return a; }
      default: throw new Error(`bad NBT tag ${type}`);
    }
  }
  root(): Nbt {
    const t = this.ubyte();
    this.str();
    return this.payload(t);
  }
}

export function readNbt(buf: Buffer): Nbt {
  return new Reader(buf).root();
}

/** SkyBlock item id (ExtraAttributes.id) and count from base64 gzipped item_bytes. Null if unreadable. */
export function skyblockItem(itemBytes: string): { id: string; count: number } | null {
  try {
    const root = readNbt(gunzipSync(Buffer.from(itemBytes, 'base64'))) as { i?: { Count?: number; tag?: { ExtraAttributes?: { id?: string } } }[] };
    const first = root.i?.[0];
    const id = first?.tag?.ExtraAttributes?.id;
    return typeof id === 'string' ? { id, count: typeof first?.Count === 'number' ? first.Count : 1 } : null;
  } catch {
    return null;
  }
}
