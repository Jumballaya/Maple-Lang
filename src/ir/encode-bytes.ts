export class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  byte(n: number): void {
    this.bytes(Uint8Array.of(n));
  }

  bytes(bytes: Uint8Array): void {
    const chunk = bytes.slice();
    this.chunks.push(chunk);
    this.length += chunk.byteLength;
  }

  u32(n: number): void {
    let value = n;
    do {
      const group = value & 0x7f;
      value >>>= 7;
      this.byte(group | (value === 0 ? 0 : 0x80));
    } while (value !== 0);
  }

  s32(n: number): void {
    let value = n;
    while (true) {
      const group = value & 0x7f;
      value >>= 7;
      const signSet = (group & 0x40) !== 0;
      const done = (value === 0 && !signSet) || (value === -1 && signSet);
      this.byte(group | (done ? 0 : 0x80));
      if (done) return;
    }
  }

  s64(n: bigint): void {
    let value = n;
    while (true) {
      const group = Number(value & 0x7fn);
      value >>= 7n;
      const signSet = (group & 0x40) !== 0;
      const done = (value === 0n && !signSet) || (value === -1n && signSet);
      this.byte(group | (done ? 0 : 0x80));
      if (done) return;
    }
  }

  f32(n: number): void {
    if (Number.isNaN(n)) {
      this.bytes(Uint8Array.of(0x00, 0x00, 0xc0, 0x7f));
      return;
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, n, true);
    this.bytes(bytes);
  }

  f64(n: number): void {
    if (Number.isNaN(n)) {
      this.bytes(Uint8Array.of(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f));
      return;
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, n, true);
    this.bytes(bytes);
  }

  name(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.u32(bytes.byteLength);
    this.bytes(bytes);
  }

  sized(build: (writer: ByteWriter) => void): void {
    const child = new ByteWriter();
    build(child);
    if (child.length >= 2 ** 32) throw new Error("encode: payload exceeds u32");
    this.u32(child.length);
    this.bytes(child.toUint8Array());
  }

  section(id: number, build: (writer: ByteWriter) => void): void {
    this.byte(id);
    this.sized(build);
  }

  toUint8Array(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}
