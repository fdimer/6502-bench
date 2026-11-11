// Commodore PET 2001-N / CBM 3000 series ("Dynamic PET", main board assembly 320351) for 6502 Bench.
// A 6502 at 1 MHz with:
//   RAM      0000h-7FFFh   8K, 16K or 32K of 4116 dynamic RAM
//   screen   8000h-83FFh   1K of video RAM (40 x 25 characters), repeated up to 8FFFh
//   ROMs     9000h-FFFFh   sockets UD3 (9000h), UD4 (A000h), UD5 (B000h), UD6 (C000h), UD7 (D000h),
//                          UD8 (E000h-E7FFh, the screen editor) and UD9 (F000h, the kernal)
//   I/O      E800h-EFFFh   6520 PIA 1 at E810h (keyboard, cassette 1, the 60 Hz interrupt),
//                          6520 PIA 2 at E820h (IEEE-488 data), 6522 VIA at E840h (IEEE-488 control,
//                          cassette 2, user port, character set select on CA2, sound on CB2)
//   UF10     the character generator ROM (2K: two sets of 128 characters), not on the CPU's bus
// The video is built from TTL counters with no controller chip. This model is functional: the picture is drawn
// from the video RAM once per frame, and the one video signal the software sees, VIDEO ON (high while the 200
// picture lines are being drawn), is timed from the line counter: it drives PIA 1 CB1, whose falling edge is the
// machine's 60 Hz interrupt, and VIA PB5.
// Keyboard (graphic layout): PIA 1 PA0-PA3 go to a decoder that pulls one of ten rows low; PIA 1 port B reads the
// eight columns, low for a key that is down.

const PET = {
  CPU_HZ: 1000000, LINE_T: 64, LINES: 260, VISIBLE: 200,     // 64 us per line, 260 lines: 60.1 pictures a second
  W: 320, H: 200, BORDER: 16
};
PET.FW = PET.W + 2 * PET.BORDER; PET.FH = PET.H + 2 * PET.BORDER;
// Graphic keyboard matrix: PET_KEYS[row][bit] for PIA 1 port B bits 0-7
const PET_KEYS = [
  ['!', '#', '%', '&', '(', 'Left arrow', 'Home', 'Right'],
  ['"', '$', "'", '\\', ')', null, 'Down', 'Del'],
  ['Q', 'E', 'T', 'U', 'O', 'Up arrow', '7', '9'],
  ['W', 'R', 'Y', 'I', 'P', null, '8', '/'],
  ['A', 'D', 'G', 'J', 'L', null, '4', '6'],
  ['S', 'F', 'H', 'K', ':', null, '5', '*'],
  ['Z', 'C', 'B', 'M', ';', 'Return', '1', '3'],
  ['X', 'V', 'N', ',', '?', null, '2', '+'],
  ['Shift', '@', ']', null, '>', 'Right shift', '0', '-'],
  ['Rvs', '[', 'Space', '<', 'Stop', null, '.', '=']
];
const PET_KEYPOS = {}; PET_KEYS.forEach((row, r) => row.forEach((k, c) => { if (k) PET_KEYPOS[k] = [r, c]; }));
// ROM sockets: name, start address, size
const PET_SOCKETS = [['UD3', 0x9000, 0x1000], ['UD4', 0xA000, 0x1000], ['UD5', 0xB000, 0x1000], ['UD6', 0xC000, 0x1000], ['UD7', 0xD000, 0x1000], ['UD8', 0xE000, 0x0800], ['UD9', 0xF000, 0x1000]];

class PETMachine {
  constructor() {
    this.ram = new Uint8Array(0x8000); this.ramSize = 0x8000;
    this.vram = new Uint8Array(0x400);
    this.rom = new Uint8Array(0x10000); this.fitted = {};            // ROM images at their addresses; fitted[socket] = true
    this.chargen = new Uint8Array(0x800); this.hasChargen = false;
    this.keys = new Uint8Array(10);                                  // bit set = key down
    this.pia1 = new M6821('PIA 1'); this.pia2 = new M6821('PIA 2'); this.via = new M6522('VIA');
    this.fb = new Uint8Array(PET.FW * PET.FH);                       // last complete picture: 1 = lit
    this.audioRate = 0; this.abuf = new Float32Array(32768); this.aw = 0; this.audioT = 0;
    this.bus = { read: a => this.read(a), write: (a, v) => this.write(a, v), peek: a => this.peek(a) };
    this.cpu = new M6502(this.bus);
    this.pia1.onPA = () => this.scanKeys();
    this.reset();
  }
  setRam(kb) { this.ramSize = kb * 1024; }
  // put a ROM image at an address; marks every socket it covers as fitted
  loadRom(addr, bytes) {
    this.rom.set(bytes, addr);
    for (const [name, a, n] of PET_SOCKETS) if (a >= addr && a + n <= addr + bytes.length) this.fitted[name] = true;
  }
  ready() { return !!(this.fitted.UD6 && this.fitted.UD7 && this.fitted.UD8 && this.fitted.UD9); }
  reset() {
    this.pia1.reset(); this.pia2.reset(); this.via.reset();
    // inputs as they sit with nothing plugged in: cassette switches open, IEEE-488 lines released, diagnostic jumper out
    this.pia1.inA = 0xFF; this.pia2.inA = 0xFF; this.pia2.inB = 0xFF; this.via.inA = 0xFF; this.via.inB = 0xFF;
    this.t = 0; this.line = 0; this.nextLine = PET.LINE_T; this.frames = 0; this.irqs = 0;
    this.setVideoOn(1); this.scanKeys();
    this.cpu.reset();
  }
  // ---- memory ----
  socketAt(a) { for (const [name, s, n] of PET_SOCKETS) if (a >= s && a < s + n) return name; return null; }
  read(a) {
    if (a < 0x8000) return a < this.ramSize ? this.ram[a] : (a >> 8);          // empty RAM reads the bus's last value: the address high byte
    if (a < 0x9000) return this.vram[a & 0x3FF];
    if (a >= 0xE800 && a < 0xF000) {
      let v = 0xFF;                                                            // more than one chip can be selected at once; they share the bus
      if (a & 0x10) v &= this.pia1.read(a & 3);
      if (a & 0x20) v &= this.pia2.read(a & 3);
      if (a & 0x40) v &= this.via.read(a & 15);
      return (a & 0x70) ? v : (a >> 8);
    }
    return this.fitted[this.socketAt(a)] ? this.rom[a] : (a >> 8);
  }
  // reading without side effects, for the memory and disassembly panes
  peek(a) {
    if (a >= 0xE800 && a < 0xF000) {
      if (a & 0x40) { const r = a & 15, v = this.via; return r === 0 ? v.pb() : r === 1 || r === 15 ? v.pa() : r === 4 ? v.t1 & 0xFF : r === 8 ? v.t2 & 0xFF : r === 10 ? v.sr : v.read(r); }
      const p = a & 0x10 ? this.pia1 : a & 0x20 ? this.pia2 : null; if (!p) return a >> 8;
      switch (a & 3) { case 0: return p.cra & 4 ? p.pa() : p.ddra; case 2: return p.crb & 4 ? p.pb() : p.ddrb; default: return p.read(a & 3); }
    }
    return this.read(a);
  }
  write(a, v) {
    if (a < 0x8000) { if (a < this.ramSize) this.ram[a] = v; return; }
    if (a < 0x9000) { this.vram[a & 0x3FF] = v; return; }
    if (a >= 0xE800 && a < 0xF000) {
      if (a & 0x10) this.pia1.write(a & 3, v);
      if (a & 0x20) this.pia2.write(a & 3, v);
      if (a & 0x40) this.via.write(a & 15, v);
    }
  }
  // ---- keyboard ----
  key(name, down) { const p = PET_KEYPOS[name]; if (!p) return; if (down) this.keys[p[0]] |= 1 << p[1]; else this.keys[p[0]] &= ~(1 << p[1]); this.scanKeys(); }
  scanKeys() { const row = this.pia1.pa() & 15; this.pia1.inB = row < 10 ? ~this.keys[row] & 0xFF : 0xFF; }
  // ---- video ----
  setVideoOn(l) { this.videoOn = l; this.pia1.setCB1(l); this.via.inB = l ? this.via.inB | 0x20 : this.via.inB & ~0x20; }
  charSet() { return this.via.ca2() ? 1 : 0; }       // VIA CA2 high selects the second character set (lower case)
  draw() {
    const fb = this.fb, B = PET.BORDER, FW = PET.FW, cg = this.chargen, set = this.charSet() << 10; fb.fill(0);
    for (let cy = 0; cy < 25; cy++) for (let cx = 0; cx < 40; cx++) {
      const c = this.vram[cy * 40 + cx], inv = c & 0x80 ? 0xFF : 0, base = set | (c & 0x7F) << 3;
      for (let y = 0; y < 8; y++) {
        const bits = cg[base + y] ^ inv, o = (B + cy * 8 + y) * FW + B + cx * 8;
        for (let x = 0; x < 8; x++) fb[o + x] = (bits >> (7 - x)) & 1;
      }
    }
  }
  // the screen as text (screen codes to ASCII), for tests and listings
  screenText() {
    const out = [];
    for (let y = 0; y < 25; y++) {
      let s = '';
      for (let x = 0; x < 40; x++) { const c = this.vram[y * 40 + x] & 0x7F; s += c === 0 ? '@' : c < 27 ? String.fromCharCode(64 + c) : c < 32 ? '[\\]^_'[c - 27] : c < 64 ? String.fromCharCode(c) : '.'; }
      out.push(s.replace(/\s+$/, ''));
    }
    return out;
  }
  // ---- per instruction ----
  irqLevel() { return this.pia1.irqA() || this.pia1.irqB() || this.pia2.irqA() || this.pia2.irqB() || this.via.irq(); }
  syncIrq() { this.cpu.irqLine = this.irqLevel(); }
  afterStep(cyc) {
    const n = cyc.length; this.t += n; this.via.tick(n);
    if (this.cpu.lastEvent === 'IRQ') this.irqs++;
    if (this.audioRate) { this.audioT += n * this.audioRate; while (this.audioT >= PET.CPU_HZ) { this.audioT -= PET.CPU_HZ; this.abuf[this.aw++ & 32767] = this.via.cb2() ? 0.3 : 0; } }
    while (this.t >= this.nextLine) {
      this.nextLine += PET.LINE_T; this.line++;
      if (this.line === PET.VISIBLE) { this.setVideoOn(0); this.draw(); this.frames++; }      // picture finished: vertical retrace begins
      else if (this.line >= PET.LINES) { this.line = 0; this.setVideoOn(1); }
    }
    return n;
  }
  step() { this.syncIrq(); return this.afterStep(this.cpu.step()); }
  run(cycles) { let t = 0; while (t < cycles) t += this.step(); return t; }
  // ---- programs ----
  // a .prg file: two bytes of load address, then the bytes. A BASIC program (load address 0401h) also needs
  // BASIC's end-of-program pointers set, as LOAD would have done.
  loadPrg(bytes) {
    const addr = bytes[0] | bytes[1] << 8, end = addr + bytes.length - 2;
    if (end > this.ramSize) return { ok: false, addr, end };
    this.ram.set(bytes.subarray(2), addr);
    if (addr === 0x0401) for (const p of [0x2A, 0x2C, 0x2E]) { this.ram[p] = end & 0xFF; this.ram[p + 1] = end >> 8; }   // VARTAB, ARYTAB, STREND
    return { ok: true, addr, end, basic: addr === 0x0401 };
  }
}
if (typeof module !== 'undefined') module.exports = { PETMachine, PET, PET_KEYS, PET_SOCKETS };
