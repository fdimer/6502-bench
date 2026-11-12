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
// Memory chips (src/memchips.js), for the pin display and fault simulation. From the 320351 parts list and layout:
//   UI2-UI9 and UJ2-UJ9   sixteen 4116 dynamic RAMs, one per data bit: two banks of 16K (an 8K machine has 4108s in UI2-UI9)
//   UF7, UF8              two 2114s: the 1K of screen RAM, four bits each
//   UD3-UD9               the ROM sockets (6332 4K ROMs; UD8 is a 6316 2K ROM), UF10 the 6316 character generator
// Assumed, because the logic diagram was not read for it: UI is the bank at 0000h-3FFFh and UJ the one at 4000h-7FFFh,
// position 2 holds data bit 0 up to position 9 for bit 7, and UF7 holds screen bits 0-3.
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

// BASIC keywords: tokens 80h-CBh (BASIC 2), and the disk commands BASIC 4 adds from CCh
const PET_TOKENS = ['END', 'FOR', 'NEXT', 'DATA', 'INPUT#', 'INPUT', 'DIM', 'READ', 'LET', 'GOTO', 'RUN', 'IF', 'RESTORE', 'GOSUB', 'RETURN', 'REM', 'STOP', 'ON', 'WAIT', 'LOAD', 'SAVE', 'VERIFY', 'DEF', 'POKE',
  'PRINT#', 'PRINT', 'CONT', 'LIST', 'CLR', 'CMD', 'SYS', 'OPEN', 'CLOSE', 'GET', 'NEW', 'TAB(', 'TO', 'FN', 'SPC(', 'THEN', 'NOT', 'STEP', '+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<',
  'SGN', 'INT', 'ABS', 'USR', 'FRE', 'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$', 'LEFT$', 'RIGHT$', 'MID$', 'GO',
  'CONCAT', 'DOPEN', 'DCLOSE', 'RECORD', 'HEADER', 'COLLECT', 'BACKUP', 'COPY', 'APPEND', 'DSAVE', 'DLOAD', 'CATALOG', 'RENAME', 'SCRATCH', 'DIRECTORY'];

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
    const C = (id, part, what, range, arr, base, abits, extra) => new MemChip(id, part, what, range, arr, base, abits, extra);
    this.ramBanks = [[], []];
    for (let b = 0; b < 2; b++) for (let bit = 0; bit < 8; bit++)
      this.ramBanks[b].push(C('U' + 'IJ'[b] + (bit + 2), '4116', `RAM: ${b ? 'upper' : 'lower'} 16K, data bit ${bit}`, b ? '4000h-7FFFh (32K machines)' : '0000h-3FFFh', this.ram, b * 0x4000, 14, { dram: true, bit, mux: 7, bank: b }));
    this.vBank = [C('UF7', '2114', 'screen RAM, data bits 0-3', '8000h-83FFh, repeated to 8FFFh', this.vram, 0, 10, { nib: 0, en: 'CS' }), C('UF8', '2114', 'screen RAM, data bits 4-7', '8000h-83FFh, repeated to 8FFFh', this.vram, 0, 10, { nib: 4, en: 'CS' })];
    this.romChips = PET_SOCKETS.map(([name, a, n]) => C(name, n === 0x800 ? '2316' : '2332', name === 'UD8' ? 'ROM socket: screen editor' : name === 'UD9' ? 'ROM socket: kernal' : a >= 0xB000 ? 'ROM socket: BASIC' : 'ROM socket: option ROM', `${a.toString(16).toUpperCase()}h-${(a + n - 1).toString(16).toUpperCase()}h`, this.rom, a, n === 0x800 ? 11 : 12, { rom: true, en: 'CS' }));
    this.cgChip = C('UF10', '2316', 'character generator ROM', 'not on the CPU bus: read by the video circuit', this.chargen, 0, 11, { rom: true, en: 'CS' });
    this.chips = [...this.ramBanks[0], ...this.ramBanks[1], ...this.vBank, ...this.romChips, this.cgChip];
    this.banks = [this.ramBanks[0], this.ramBanks[1], this.vBank, ...this.romChips.map(c => [c]), [this.cgChip]];
    this.chipById = {}; for (const c of this.chips) this.chipById[c.id] = c;
    this.acc = new Uint32Array(12);          // accesses: 0, 1 the RAM banks; 2 screen RAM; 3-9 the ROM sockets UD3-UD9; 10 the character generator
    this.faulty = false;
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
  socketIndex(a) { return a >= 0xF000 ? 6 : a >= 0xE000 ? (a < 0xE800 ? 5 : -1) : a >= 0x9000 ? (a >> 12) - 9 : -1; }
  read(a) {
    if (this.faulty) return this.readF(a, false);
    if (a < 0x8000) { this.acc[a >> 14]++; return a < this.ramSize ? this.ram[a] : (a >> 8); }      // empty RAM reads the bus's last value: the address high byte
    if (a < 0x9000) { this.acc[2]++; return this.vram[a & 0x3FF]; }
    if (a >= 0xE800 && a < 0xF000) return this.readIO(a);
    const i = this.socketIndex(a); this.acc[3 + i]++;
    return this.fitted[PET_SOCKETS[i][0]] ? this.rom[a] : (a >> 8);
  }
  readIO(a) {
    let v = 0xFF;                                                            // more than one chip can be selected at once; they share the bus
    if (a & 0x10) v &= this.pia1.read(a & 3);
    if (a & 0x20) v &= this.pia2.read(a & 3);
    if (a & 0x40) v &= this.via.read(a & 15);
    return (a & 0x70) ? v : (a >> 8);
  }
  // memory with chip faults (used only while at least one pin fault is set)
  readF(a, quiet) {
    let v, sel = -1;
    if (a < 0x8000) { if (!quiet) this.acc[a >> 14]++; v = a < this.ramSize ? memBankRead(this.ramBanks[a >> 14], a & 0x3FFF, quiet) : (a >> 8); }
    else if (a < 0x9000) { if (!quiet) this.acc[2]++; v = memBankRead(this.vBank, a & 0x3FF, quiet); }
    else if (a >= 0xE800 && a < 0xF000) v = quiet ? this.peekIO(a) : this.readIO(a);
    else { sel = this.socketIndex(a); if (!quiet) this.acc[3 + sel]++; v = this.fitted[PET_SOCKETS[sel][0]] ? memBankRead(this.banks[3 + sel], a & this.romChips[sel].mask, quiet) : (a >> 8); }
    // a ROM whose chip select is stuck low drives the bus during every read: the lines carry the AND of the two
    for (let i = 0; i < 7; i++) { const c = this.romChips[i]; if (c.always && i !== sel && this.fitted[c.id]) v &= memBankRead(this.banks[3 + i], a & c.mask, true); }
    return v;
  }
  // reading without side effects, for the memory and disassembly panes
  peekIO(a) {
    if (a & 0x40) { const r = a & 15, v = this.via; return r === 0 ? v.pb() : r === 1 || r === 15 ? v.pa() : r === 4 ? v.t1 & 0xFF : r === 8 ? v.t2 & 0xFF : r === 10 ? v.sr : v.read(r); }
    const p = a & 0x10 ? this.pia1 : a & 0x20 ? this.pia2 : null; if (!p) return a >> 8;
    switch (a & 3) { case 0: return p.cra & 4 ? p.pa() : p.ddra; case 2: return p.crb & 4 ? p.pb() : p.ddrb; default: return p.read(a & 3); }
  }
  peek(a) {
    if (this.faulty) return this.readF(a, true);
    if (a >= 0xE800 && a < 0xF000) return this.peekIO(a);
    if (a < 0x8000) return a < this.ramSize ? this.ram[a] : (a >> 8);
    if (a < 0x9000) return this.vram[a & 0x3FF];
    return this.fitted[this.socketAt(a)] ? this.rom[a] : (a >> 8);
  }
  write(a, v) {
    if (a < 0x8000) { this.acc[a >> 14]++; if (a < this.ramSize) { if (this.faulty && this.ramBanks[a >> 14].faulty) memBankWrite(this.ramBanks[a >> 14], a & 0x3FFF, v); else this.ram[a] = v; } return; }
    if (a < 0x9000) { this.acc[2]++; if (this.faulty && this.vBank.faulty) memBankWrite(this.vBank, a & 0x3FF, v); else this.vram[a & 0x3FF] = v; return; }
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
    const vf = this.faulty && this.vBank.faulty, cf = this.faulty && this.cgChip.faulty, cgB = this.banks[this.banks.length - 1];
    for (let cy = 0; cy < 25; cy++) for (let cx = 0; cx < 40; cx++) {
      const c = vf ? memBankRead(this.vBank, cy * 40 + cx, true) : this.vram[cy * 40 + cx], inv = c & 0x80 ? 0xFF : 0, base = set | (c & 0x7F) << 3;
      for (let y = 0; y < 8; y++) {
        const bits = (cf ? memBankRead(cgB, base + y, true) : cg[base + y]) ^ inv, o = (B + cy * 8 + y) * FW + B + cx * 8;
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
  // ---- BASIC program as text ----
  peekW(a) { return this.ram[a] | this.ram[a + 1] << 8; }
  basicListing() {
    const out = []; let a = this.peekW(0x28), guard = 0; const end = this.peekW(0x2A);      // TXTTAB, VARTAB
    if (a < 0x0400 || end < a || end > this.ramSize) return out;
    while (guard++ < 5000) {
      const next = this.peekW(a); if (!next || next <= a || next > end) break;
      let s = this.peekW(a + 2) + ' ', quote = false;
      for (let p = a + 4; p < next - 1; p++) {
        const c = this.ram[p]; if (!c) break;
        if (c === 0x22) quote = !quote;
        if (c >= 0x80 && !quote) s += PET_TOKENS[c - 0x80] || '{' + c.toString(16).toUpperCase() + '}';
        else if (c === 0xFF) s += 'π';
        else s += c >= 32 && c < 96 ? String.fromCharCode(c) : '{' + c.toString(16).toUpperCase().padStart(2, '0') + '}';
      }
      out.push(s); a = next;
    }
    return out;
  }
  // the BASIC program as a .prg file (load address 0401h), or null if there is none
  savePrg() {
    const start = this.peekW(0x28), end = this.peekW(0x2A); if (start !== 0x0401 || end <= start + 2 || end > this.ramSize) return null;
    const out = new Uint8Array(end - start + 2); out[0] = 0x01; out[1] = 0x04; out.set(this.ram.subarray(start, end), 2); return out;
  }
  report() {
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0'), h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), out = [], c = this.cpu;
    out.push(`Commodore PET (Dynamic PET board 320351) listing: ${this.ramSize / 1024}K RAM`);
    out.push(`CPU  PC ${h4(c.pc)}  A ${h2(c.a)}  X ${h2(c.x)}  Y ${h2(c.y)}  SP 01${h2(c.s)}  P ${h2(c.p)}`, '');
    out.push('BASIC pointers');
    for (const [a, n, w] of [[0x28, 'TXTTAB', 'start of the BASIC program'], [0x2A, 'VARTAB', 'start of variables (end of program)'], [0x2C, 'ARYTAB', 'start of arrays'], [0x2E, 'STREND', 'end of arrays (start of free memory)'], [0x30, 'FRETOP', 'bottom of string space'], [0x34, 'MEMSIZ', 'top of BASIC memory']])
      out.push(`  ${h4(a)}  ${n.padEnd(7)} ${h4(this.peekW(a))}   ${w}`);
    const reg = (n, p) => `  ${n}  port A ${h2(p.pa())} (direction ${h2(p.ddra)})  port B ${h2(p.pb())} (direction ${h2(p.ddrb)})`;
    out.push('', 'Interface chips', reg('PIA 1 (E810h)', this.pia1) + `  CRA ${h2(this.pia1.cra)}  CRB ${h2(this.pia1.crb)}`, reg('PIA 2 (E820h)', this.pia2) + `  CRA ${h2(this.pia2.cra)}  CRB ${h2(this.pia2.crb)}`,
      reg('VIA   (E840h)', this.via) + `  ACR ${h2(this.via.acr)}  PCR ${h2(this.via.pcr)}  IFR ${h2(this.via.ifr)}  IER ${h2(this.via.ier)}  T1 ${h4(this.via.t1 & 0xFFFF)}  T2 ${h4(this.via.t2 & 0xFFFF)}`);
    out.push('', 'BASIC program'); const prog = this.basicListing(); out.push(...(prog.length ? prog.map(l => '  ' + l) : ['  (none)']));
    out.push('', 'Screen', ...this.screenText().map(l => '  |' + l));
    out.push('', 'RAM (rows of zeros left out)');
    for (let a = 0; a < this.ramSize; a += 16) {
      let hx = '', as = '', zero = true; for (let i = 0; i < 16; i++) { const v = this.ram[a + i]; if (v) zero = false; hx += h2(v) + ' '; as += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; }
      if (!zero) out.push(`  ${h4(a)}  ${hx} ${as}`);
    }
    out.push('', 'Screen RAM 8000h-83E7h (screen codes)');
    for (let a = 0; a < 1000; a += 40) { let hx = ''; for (let i = 0; i < 40; i++) hx += h2(this.vram[a + i]); out.push(`  ${h4(0x8000 + a)}  ${hx}`); }
    return out.join('\n') + '\n';
  }
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
if (typeof module !== 'undefined') module.exports = { PETMachine, PET, PET_KEYS, PET_SOCKETS, PET_TOKENS };
