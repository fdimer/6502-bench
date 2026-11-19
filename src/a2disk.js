// The Disk II controller card and its drives, for the Apple II Plus (src/apple2.js).
// From Don Worth and Pieter Lechner, "Beneath Apple DOS" (track format), Jim Sather, "Understanding the Apple II"
// (the slot signals), and the card's own logic as the DOS 3.3 RWTS and the boot ROM use it:
//   C0n0-C0n7  stepper phases 0-3 off/on (n = 8 + slot)    C0n8/C0n9  motor off/on
//   C0nA/C0nB  drive 1/2                                    C0nC/C0nD  Q6 low/high
//   C0nE/C0nF  Q7 low/high
// Q7 low, Q6 low: read the data register; Q7 low, Q6 high: sense write protect (bit 7); Q7 high, Q6 high: load the
// data register from the bus; Q7 high, Q6 low: shift it out to the disk (write). An even address puts the data
// register on the bus.
// The card's logic state sequencer (the P6 PROM) is not simulated bit by bit: the disk turns under the head at its
// real rate, one nibble every 32 cycles, and a read returns the nibble under the head once, with bit 7 set, as the
// sequencer leaves it in the data register; a second read before the next nibble arrives sees bit 7 clear. Writing
// puts each nibble shifted out after the last, from where the head was when writing began. That is what DOS 3.3,
// ProDOS and the boot ROM expect; copy protections that count bits or time the gaps between nibbles are not.
// The boot ROM (the P5 PROM, 341-0027) is the user's own file: it is Apple's code and is not included.

// 6-and-2 encoding: 64 six-bit values to disk nibbles
const A2D_62 = [0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6, 0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3,
  0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE5, 0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF];
const A2D_UN62 = new Int16Array(256).fill(-1); A2D_62.forEach((v, i) => { A2D_UN62[v] = i; });
// the sector in a .dsk (DOS 3.3 order) or .po (ProDOS order) image that each physical sector holds
const A2D_DOS = [0x0, 0x7, 0xE, 0x6, 0xD, 0x5, 0xC, 0x4, 0xB, 0x3, 0xA, 0x2, 0x9, 0x1, 0x8, 0xF];
const A2D_PRODOS = [0x0, 0x8, 0x1, 0x9, 0x2, 0xA, 0x3, 0xB, 0x4, 0xC, 0x5, 0xD, 0x6, 0xE, 0x7, 0xF];
const A2D_TRACKS = 35, A2D_TRACK_NIB = 6400, A2D_NIB_TRACK = 6656;
// 256 bytes to the 343 nibbles of a data field (342 values and the checksum), as DOS 3.3 writes them
function a2dEncode62(data) {
  const v = new Uint8Array(0x158); let i2 = 0x55;
  for (let i6 = 0x101; i6 >= 0; i6--) {
    let b = data[i6 & 0xFF], t = v[i2];
    t = t << 1 | b & 1; b >>= 1; t = t << 1 | b & 1; b >>= 1;
    if (i6 < 0x100) v[0x56 + i6] = b;
    v[i2] = t & 0x3F; if (--i2 < 0) i2 = 0x55;
  }
  const out = []; let last = 0;
  for (let i = 0; i < 0x156; i++) { out.push(A2D_62[last ^ v[i]]); last = v[i]; }
  out.push(A2D_62[last]); return out;
}
// 343 nibbles back to 256 bytes, or null if a nibble is not a data nibble or the checksum fails
function a2dDecode62(nib) {
  const v = new Uint8Array(0x156); let last = 0;
  for (let i = 0; i < 0x156; i++) { const x = A2D_UN62[nib[i]]; if (x < 0) return null; last ^= x; v[i] = last; }
  if (A2D_UN62[nib[0x156]] !== last) return null;
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const aux = v[i % 0x56], sh = (i / 0x56 | 0) * 2, lo = aux >> sh & 3;
    out[i] = v[0x56 + i] << 2 | (lo & 1) << 1 | lo >> 1;
  }
  return out;
}
const a2d44 = v => [v >> 1 | 0xAA, v | 0xAA];
// one track of 16 sectors as nibbles: gaps of FFh sync bytes, then for each sector its address field and data field
function a2dTrack(img, t, order, vol) {
  const out = [], ff = n => { for (let i = 0; i < n; i++) out.push(0xFF); };
  ff(48);
  for (let s = 0; s < 16; s++) {
    out.push(0xD5, 0xAA, 0x96, ...a2d44(vol), ...a2d44(t), ...a2d44(s), ...a2d44(vol ^ t ^ s), 0xDE, 0xAA, 0xEB); ff(6);
    const off = (t * 16 + order[s]) * 256;
    out.push(0xD5, 0xAA, 0xAD, ...a2dEncode62(img.subarray(off, off + 256)), 0xDE, 0xAA, 0xEB); ff(27);
  }
  while (out.length < A2D_TRACK_NIB) out.push(0xFF);
  return Uint8Array.from(out);
}
// a disk image file to 35 tracks of nibbles: .dsk/.do (DOS order), .po (ProDOS order), .nib (raw tracks)
function a2dLoad(name, bytes) {
  const ext = (/\.(\w+)$/.exec(name || '') || [])[1]?.toLowerCase() || '';
  if (bytes.length === A2D_TRACKS * A2D_NIB_TRACK || ext === 'nib') {
    if (bytes.length !== A2D_TRACKS * A2D_NIB_TRACK) throw new Error(`a .nib image is ${A2D_TRACKS * A2D_NIB_TRACK} bytes; this one is ${bytes.length}`);
    return { kind: 'nib', tracks: Array.from({ length: A2D_TRACKS }, (_, t) => bytes.slice(t * A2D_NIB_TRACK, (t + 1) * A2D_NIB_TRACK)) };
  }
  if (bytes.length !== 143360) throw new Error(`a 5.25" disk image (.dsk, .do, .po) is 143,360 bytes; this one is ${bytes.length.toLocaleString('en-AU')}`);
  let kind = ext === 'po' ? 'po' : 'dsk';
  // a .dsk that is really in ProDOS order: ProDOS's volume directory header (block 2, storage type Fh) is at 0400h of a
  // ProDOS-order image, and at 0B00h (DOS sector 11 of track 0) of a DOS-order one
  const vdh = o => bytes[o] === 0 && bytes[o + 1] === 0 && bytes[o + 4] >> 4 === 0xF;
  if (ext !== 'do' && ext !== 'po' && vdh(0x400) && !vdh(0xB00)) kind = 'po';
  const order = kind === 'po' ? A2D_PRODOS : A2D_DOS, vol = 254;
  return { kind, tracks: Array.from({ length: A2D_TRACKS }, (_, t) => a2dTrack(bytes, t, order, vol)) };
}
// tracks of nibbles back to a 143,360-byte image in DOS or ProDOS order; sectors that cannot be read are listed in bad
function a2dSave(disk, kind) {
  const order = (kind || disk.kind) === 'po' ? A2D_PRODOS : A2D_DOS, img = new Uint8Array(143360), bad = [];
  disk.tracks.forEach((tr, t) => {
    const n = tr.length, got = new Set(), at = i => tr[(i % n + n) % n];
    for (let i = 0; i < n + 400; i++) {
      if (at(i) !== 0xD5 || at(i + 1) !== 0xAA || at(i + 2) !== 0x96) continue;
      const g = k => (at(i + 3 + 2 * k) << 1 | 1) & at(i + 4 + 2 * k), tk = g(1), s = g(2);
      if (tk !== t || s > 15 || got.has(s)) continue;
      for (let j = i + 14; j < i + 14 + 40; j++) if (at(j) === 0xD5 && at(j + 1) === 0xAA && at(j + 2) === 0xAD) {
        const nib = []; for (let k = 0; k < 343; k++) nib.push(at(j + 3 + k));
        const d = a2dDecode62(nib); if (d) { img.set(d, (t * 16 + order[s]) * 256); got.add(s); } break;
      }
    }
    for (let s = 0; s < 16; s++) if (!got.has(s)) bad.push(`track ${t} sector ${s}`);
  });
  return { bytes: img, bad };
}
// The 16-sector boot PROM (P5, 341-0027) as the 6502 reads it: 256 bytes that start LDX #20h, LDY #0 (the boot code
// finding its slot). Some files of it hold the chip as it is wired on the card instead: there address lines A5 and A7
// are swapped and data bits 4-7 are in reverse order, relative to what the 6502 sees. Undoing that gives the same
// code. Returns the bytes as the 6502 reads them, with raw true for such a file, or null if it is not the boot PROM.
function a2dBootProm(bytes) {
  if (!bytes || bytes.length !== 256) return null;
  const ok = b => b[0] === 0xA2 && b[1] === 0x20 && b[2] === 0xA0 && b[3] === 0x00;
  if (ok(bytes)) return { bytes: Uint8Array.from(bytes), raw: false };
  const hi = n => ((n & 1) << 3) | ((n & 2) << 1) | ((n & 4) >> 1) | ((n & 8) >> 3);
  const out = new Uint8Array(256);
  for (let a = 0; a < 256; a++) { const b = bytes[(a & 0x5F) | ((a >> 2) & 0x20) | ((a << 2) & 0x80)]; out[a] = (hi(b >> 4) << 4) | (b & 15); }
  return ok(out) ? { bytes: out, raw: true } : null;
}

class DiskII {
  constructor(m, slot) {
    this.m = m; this.slot = slot || 6; this.rom = null;            // the P5 boot PROM (256 bytes), the user's file
    this.drives = [0, 1].map(() => ({ disk: null, name: '', wp: false, ht: 0, dirty: false }));
    this.reset();
  }
  reset() { this.phases = 0; this.motor = false; this.motorOffAt = 0; this.drive = 0; this.q6 = 0; this.q7 = 0; this.latch = 0; this.lastN = -1; this.wpos = -1; this.spinAt = 0; this.writes = 0; }
  insert(n, name, bytes) { const d = a2dLoad(name, bytes); Object.assign(this.drives[n], { disk: d, name, dirty: false }); return d; }
  eject(n) { Object.assign(this.drives[n], { disk: null, name: '', dirty: false }); }
  spinning() { return this.motor || this.m.ct < this.motorOffAt; }
  cur() { return this.drives[this.drive]; }
  track() { return this.cur().ht >> 1; }
  // the nibble position under the head: the disk turns one nibble every 32 cycles while the motor runs
  pos() { const d = this.cur(); if (!d.disk) return -1; const tr = d.disk.tracks[Math.min(A2D_TRACKS - 1, d.ht >> 1)]; return Math.floor((this.m.ct - this.spinAt) / 32) % tr.length; }
  io(a, wr, v) {
    const r = a & 15, d = this.cur();
    if (r < 8) {                                     // the stepper: a phase turned on pulls the head half a track toward it
      const p = r >> 1;
      if (r & 1) {
        this.phases |= 1 << p;
        const h = d.ht & 3;
        if (p === (h + 1) % 4) d.ht = Math.min(A2D_TRACKS * 2 - 2, d.ht + 1);
        else if (p === (h + 3) % 4) d.ht = Math.max(0, d.ht - 1);
      } else this.phases &= ~(1 << p);
    } else if (r === 8) { if (this.motor) this.motorOffAt = this.m.ct + 1020484; this.motor = false; }   // the motor runs on for about a second
    else if (r === 9) { if (!this.spinning()) this.spinAt = this.m.ct; this.motor = true; }
    else if (r === 10 || r === 11) this.drive = r - 10;
    else if (r === 12 || r === 13) this.q6 = r - 12;
    else { if (r === 15 && !this.q7) this.wpos = -1; this.q7 = r - 14; }
    if (wr && this.q6 && this.q7) this.latch = v;     // Q7 and Q6 high: load the data register from the bus
    let out = this.m.floating();
    if (!this.spinning() || !d.disk) { if (!(a & 1)) out = this.q6 && !this.q7 ? (d.wp || !d.disk ? 0x80 : 0) | out & 0x7F : this.q7 ? this.latch : 0; return out; }
    const tr = d.disk.tracks[d.ht >> 1], n = Math.floor((this.m.ct - this.spinAt) / 32);
    if (this.q7) {                                   // writing: each access to Q6L shifts the data register onto the disk
      if (r === 12 && !d.wp) {                     // written in sequence from where the head was when writing began
        if (this.wpos < 0) this.wpos = n;
        tr[this.wpos++ % tr.length] = this.latch; d.dirty = true; this.writes++;
      }
      return a & 1 ? out : this.latch;
    }
    if (this.q6) return a & 1 ? out : (d.wp ? 0x80 : 0) | out & 0x7F;      // write protect sense
    if (a & 1) return out;
    const nib = tr[n % tr.length];
    if (n !== this.lastN) { this.lastN = n; return nib; }
    return nib & 0x7F;
  }
}
if (typeof module !== 'undefined') module.exports = { DiskII, a2dBootProm, a2dLoad, a2dSave, a2dEncode62, a2dDecode62, A2D_DOS, A2D_PRODOS };
