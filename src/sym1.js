// Synertek SYM-1 single board computer for 6502 Bench.
// From the SYM-1 Reference Manual (Synertek, fifth printing, January 1981: chapter 4, figure 4-10 and the SUPERMON
// listing) and Robert A. Peck's SYM-1 Hardware Theory of Operations Manual (1979), with its schematic.
// A 6502 (U5) at 1 MHz with:
//   RAM      0000h-0FFFh   1K to 4K of 2114 static RAM in four pairs (U12/U13 0000h, U14/U15 0400h, U16/U17 0800h,
//                          U18/U19 0C00h); the first is always fitted. The other three can be write protected by
//                          VIA 3 PA1-PA3 when jumpers JJ, KK and LL are in.
//   ROM      8000h-FFFFh   four sockets, P0-P3 (U20-U23), each wired by jumpers to a 2K block chosen by the 74LS145
//                          decoders U10 (8000h-BFFFh) and U11 (C000h-FFFFh). SUPERMON is a 4K ROM in P0 at 8000h.
//   I/O      A000h-A3FFh   VIA 1 (U25): cassette input (PB6), tape remote (CB2), the power-on reset latch (CA2)
//            A400h-A5FFh   the 6532 RIOT (U27): keypad and display (port A, PB0-PB3), CRT and TTY serial (PB4-PB7)
//            A600h-A7FFh   the RIOT's 128 bytes of RAM, SUPERMON's System RAM; also at F800h-FFFFh (jumper U-22),
//                          so the 6502's vectors at FFFAh-FFFFh come from A67Ah-A67Fh
//            A800h-ABFFh   VIA 2 (U28), the user's (an empty socket as delivered)
//            AC00h-AFFFh   VIA 3 (U29): write protection (PA0-PA3), debug on and off (PA4, PA5), the user port
// Partial decoding repeats the devices through their blocks (Peck, page 15): VIA 1 every 16 bytes from A000h to
// A3FFh, the RIOT's I/O every 32 bytes from A400h to A5FFh, its RAM every 128 bytes from A600h to A7FFh.
//
// Power-on reset (Peck, pages 2-4): the RES pulse clears VIA 1, which leaves CA2 high. While CA2 is high and the
// address is outside A000h-A7FFh, POR' is low: it selects the ROM in P0 whatever the address, and switches U11
// (C000h-FFFFh) off, so the reset vector is read from 8FFCh in the ROM. SUPERMON's first act is to write CCh to
// VIA 1's PCR (A00Ch), which takes CA2 low and ends POR'.
// Keypad and display (Peck, page 13): RIOT port A drives the seven segments and the decimal point of all six digits
// through the 7416 at U30 (a high bit lights its segment); PB0-PB3 go to the 74145 at U37, whose outputs 0-5 light
// one digit each, 6 the speaker and 7 the cassette output. The 28 keys are a matrix of seven columns (PA0-PA6) by
// four rows (PA7, PB0, PB1, PB2): SUPERMON drives one side low and reads the other (its CONFIG table at 8BC6h).
// RST, DEBUG ON and DEBUG OFF are not in the matrix: RST pulls RES low, the debug keys set and clear the DEBUG
// flip-flop (U8), which, when set, pulls NMI low on every opcode fetch from outside the ROM in P0: SUPERMON's trace.
// Serial (Peck, page 13): PB4 is CRT out and PB7 CRT in (through the 7416 at U38 to the RS-232 connector); PB5 and PB6
// are the 20 mA TTY loop. SUPERMON sends and receives a bit at a time: the pins are the RS-232 lines inverted, so
// they idle low and a start bit is high.

const SYM = { CPU_HZ: 1000000 };
// ROM sockets: the factory wiring (Peck, page 11): P0 (U20) a 2332 at 8000h for SUPERMON, P1-P3 (U21-U23) 2716s
// or 2316Bs at C000h, C800h and D000h. The page rewires them when a ROM needs another place.
const SYM_SOCKETS = [['P0', 'U20', 0x8000, 0x1000], ['P1', 'U21', 0xC000, 0x0800], ['P2', 'U22', 0xC800, 0x0800], ['P3', 'U23', 0xD000, 0x0800]];
// The keypad (Reference Manual figure 5-1 and SUPERMON's key table at 8BD6h): SYM_KEYS[row][column], row 0 on PA7,
// rows 1-3 on PB0-PB2, columns on PA0-PA6. The name is the key's unshifted legend, then its shifted one.
const SYM_KEYS = [
  ['0', '4', '8', 'C', 'CR', 'GO', 'L2'],
  ['1', '5', '9', 'D', '-', 'REG', 'S2'],
  ['2', '6', 'A', 'E', '→', 'MEM', null],
  ['3', '7', 'B', 'F', 'SHIFT', null, null]
];
const SYM_SHIFTED = { 0: 'USR 0', 1: 'USR 1', 2: 'USR 2', 3: 'USR 3', 4: 'USR 4', 5: 'USR 5', 6: 'USR 6', 7: 'USR 7', 8: 'JUMP', 9: 'VER', A: 'ASCII', B: 'B MOV', C: 'CALC', D: 'DEP', E: 'EXEC', F: 'FILL', CR: 'S DBL', '-': '+', '→': '←', GO: 'LD P', REG: 'SAV P', MEM: 'WP', L2: 'LD 1', S2: 'SAV 1' };
// the keypad as it is laid out on the board (figure 5-1): four columns, seven rows; [key, lower legend]
const SYM_LAYOUT = [[['L2', 'LD 2'], ['S2', 'SAV 2'], ['RST', 'RST'], ['DEBUG ON', 'ON']], [['GO', 'GO'], ['REG', 'REG'], ['MEM', 'MEM'], ['DEBUG OFF', 'OFF']],
  [['CR', 'CR'], ['-', '−'], ['→', '→'], ['SHIFT', 'SHIFT']], ...['CDEF', '89AB', '4567', '0123'].map(r => r.split('').map(k => [k, k]))];
const SYM_KEYPOS = {}; SYM_KEYS.forEach((row, r) => row.forEach((k, c) => { if (k) SYM_KEYPOS[k] = [r, c]; }));
// the seven segments: bit 0 a (top) ... bit 6 g (middle), bit 7 the decimal point
const SYM_BAUDS = [110, 300, 600, 1200, 2400, 4800];
// the RIOT's pinout
MEM_PINOUTS['6532'] = [[1, 'VSS', 'g'], [2, 'A5', 'i'], [3, 'A4', 'i'], [4, 'A3', 'i'], [5, 'A2', 'i'], [6, 'A1', 'i'], [7, 'A0', 'i'], ...[0, 1, 2, 3, 4, 5, 6, 7].map(n => [8 + n, 'PA' + n, 'i']),
  ...[7, 6, 5, 4].map((n, k) => [16 + k, 'PB' + n, 'i']), [20, 'VCC', 'p'], ...[3, 2, 1, 0].map((n, k) => [21 + k, 'PB' + n, 'i']), [25, 'IRQ', 'i'],
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((d, k) => [26 + k, 'D' + d, 'i']), [34, 'RES', 'i'], [35, 'R/W', 'i'], [36, 'RS', 'i'], [37, 'CS2', 'i'], [38, 'CS1', 'i'], [39, 'PHI2', 'i'], [40, 'A6', 'i']];

// ---- cassette tapes, as the times (cycles from the start) at which the signal changes polarity ----
// SUPERMON's high-speed format (Reference Manual appendix C): each byte is a start bit (0) and eight data bits, least
// significant first; a 1 is one cycle of 1400 Hz and a 0 half a cycle of 700 Hz. A record is TAPDEL x 1.5 seconds
// of SYN characters (16h), "*", the ID, the start address and the end address plus one (low byte first), the data,
// "/", the checksum (low byte first) and two EOTs (04h). The checksum is the 16-bit sum of the start address, the
// end address plus one and the data (SUPERMON's CHKT adds each byte to CHKL/CHKH).
function symTapeHS(bytes, start, id, leaderSec) {
  const edges = []; let t = 0;
  const half = us => { t += us; edges.push(t); };
  const bit = b => { if (b) { half(357); half(357); } else half(714); };
  const byte = v => { bit(0); for (let k = 0; k < 8; k++) bit(v >> k & 1); };
  for (let i = 0, n = Math.round((leaderSec || 6) * 185); i < n; i++) byte(0x16);
  const end = start + bytes.length, sa = [start & 0xFF, start >> 8], ea = [end & 0xFF, end >> 8 & 0xFF];
  let sum = 0; const add = v => { sum = (sum + v) & 0xFFFF; };
  byte(0x2A); byte(id & 0xFF);
  for (const v of [...sa, ...ea]) { byte(v); add(v); }
  for (const v of bytes) { byte(v); add(v); }
  byte(0x2F); byte(sum & 0xFF); byte(sum >> 8); byte(4); byte(4);
  for (let i = 0; i < 20; i++) byte(0x16);
  return Float64Array.from(edges.map(e => e * SYM.CPU_HZ / 1e6));
}
// a recording (samples between -1 and 1 at a rate) to polarity changes, with a little hysteresis against noise
function symTapeFromSamples(samples, rate) {
  let peak = 0; for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
  const h = peak * 0.08, k = SYM.CPU_HZ / rate, edges = []; let s = 0, dc = 0;
  for (let i = 0; i < samples.length; i++) {
    dc += (samples[i] - dc) * 0.0005; const x = samples[i] - dc;
    if (s <= 0 && x > h) { s = 1; edges.push(Math.round(i * k)); } else if (s >= 0 && x < -h) { s = -1; edges.push(Math.round(i * k)); }
  }
  return Float64Array.from(edges);
}
// polarity changes to a WAV file: 16-bit mono at 44.1 kHz, a square wave as the cassette output gives it
function symWavFromTape(edges) {
  const rate = 44100, k = rate / SYM.CPU_HZ, n = Math.ceil((edges.length ? edges[edges.length - 1] : 0) * k) + rate / 2;
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  let e = 0, lv = 1;
  for (let i = 0; i < n; i++) { while (e < edges.length && edges[e] * k <= i) { lv = -lv; e++; } dv.setInt16(44 + i * 2, e < edges.length ? lv * 12000 : 0, true); }
  return new Uint8Array(buf);
}

class SymMachine {
  constructor() {
    this.ram = new Uint8Array(0x1000); this.ramKB = 4;
    this.rom = new Uint8Array(0x10000);                               // ROM images at the addresses their sockets answer
    this.sockets = SYM_SOCKETS.map(([name, u, addr, size]) => ({ name, u, addr, size, fitted: false, label: '' }));
    this.via1 = new M6522('VIA 1'); this.via2 = new M6522('VIA 2'); this.via3 = new M6522('VIA 3');
    this.via2Fitted = false;                                         // U28 is the user's: an empty socket as delivered
    this.riot = new M6532('6532');
    this.riot.inA = () => this.keyLines().a; this.riot.inB = () => this.keyLines().b;
    this.riot.onPA = () => this.portChange(); this.riot.onPB = () => this.portChange();
    this.via3.inA = 0xFF;                                            // PA0-PA7 pulled up (R67-R69, R75, R76, R83)
    this.via3.onPA = () => this.debugInputs();
    // jumpers: MM write protects System RAM (factory fitted); JJ, KK and LL the 2nd, 3rd and 4th 1K of RAM; U-22
    // puts System RAM at F800h-FFFFh (factory fitted: the vectors come from there); W24 and X25 let VIA 3 PA4 and PA5
    // turn DEBUG on and off (not fitted as delivered, Reference Manual 9.6)
    this.jumpers = { MM: true, JJ: false, KK: false, LL: false, U22: true, W24: false, X25: false };
    this.keysDown = new Set(); this.debug = false;
    this.dbus = 0xFF;
    this.bus = { read: a => this.read(a), write: (a, v) => this.write(a, v), peek: a => this.peek(a) };
    this.cpu = new M6502(this.bus);
    const run = this.cpu.step.bind(this.cpu);
    this.cpu.step = () => {
      const why = this.heldWhy; if (!why) { this.zr = false; return run(); }
      if (!this.zr && this.cpuC.lv.RES === 0) { this.cpu.reset(); this.zr = true; }
      this.cpu.lastEvent = null; return [{ k: 'R', a: this.cpu.pc, d: 0xFF, dummy: true, held: why }];
    };
    // ---- the memory chips (src/memchips.js) ----
    // The 2114s: U12, U14, U16 and U18 hold data bits 0-3, U13, U15, U17 and U19 bits 4-7 (Peck, page 10).
    const C = (id, part, what, range, arr, base, abits, extra) => new MemChip(id, part, what, range, arr, base, abits, extra);
    this.ramPairs = [0, 1, 2, 3].map(k => [0, 4].map(nib => C('U' + (12 + 2 * k + nib / 4), '2114', `RAM ${k * 1024}-${k * 1024 + 1023}: data bits ${nib}-${nib + 3}`, `${(k * 0x400).toString(16).toUpperCase().padStart(4, '0')}h-${(k * 0x400 + 0x3FF).toString(16).toUpperCase().padStart(4, '0')}h`, this.ram, k * 0x400, 10, { nib, en: 'CS', block: k })));
    this.cpuC = new BoardChip('U5', '6502', 'processor (U5)', 'address, data and control lines', { label: 'U5' });
    this.romChips = []; this.buildRomChips();
    this.acc = new Uint32Array(12);            // accesses: 0-3 the RAM pairs, 4-7 the ROM sockets, 8 VIA 1, 9 RIOT, 10 VIA 2 and 3, 11 System RAM
    this.pinF = {}; this.netF = {}; this.heldWhy = null; this.fx = false; this.faulty = false;
    // the display: how long each segment of each digit has been lit, for the picture (a multiplexed display)
    this.segT = new Float64Array(48); this.segFrom = 0; this.lit = -1; this.litSegs = 0; this.u37 = 9;
    this.t = 0; this.ct = 0;
    // serial terminal on the CRT port (PB4 out, PB7 in) at a baud rate the page sets
    this.baud = 4800; this.rx = { edges: [], start: -1, after: 0 }; this.rxOut = []; this.txQ = []; this.tx = null; this.txEnd = 0; this.crtOut = 0;
    // cassette
    this.tape = null; this.rec = null; this.tapeIn = 0; this.tapeOutLv = 0; this.remote = 0;
    this.audioRate = 0; this.abuf = new Float32Array(32768); this.aw = 0; this.audioT = 0; this.spk = 0;
    this.via1.onCB2 = l => { this.remote = l; };
    this.reset(true);
  }
  buildRomChips() {
    this.romChips = this.sockets.map(s => new MemChip(s.u, s.size > 0x800 ? '2332' : '2316', `ROM socket ${s.name}${s.label ? ': ' + s.label : ''}`,
      `${s.addr.toString(16).toUpperCase()}h-${(s.addr + s.size - 1).toString(16).toUpperCase()}h`, this.rom, s.addr, s.size > 0x800 ? 12 : 11, { rom: true, en: 'CS', socket: s.name }));
    this.chips = [...this.ramPairs.flat(), ...this.romChips, this.cpuC];
    this.chipById = {}; for (const c of this.chips) this.chipById[c.id] = c;
    this.banks = [...this.ramPairs, ...this.romChips.map(c => [c])];
    this.NETS = null; this.netCache = null;
    if (this.pinF) this.applyFaults();
  }
  setRam(kb) { this.ramKB = Math.max(1, Math.min(4, kb | 0)); }
  // put a ROM image into a socket, rewired to answer at addr (2K or 4K; a 4K socket covers two 2K decoder blocks)
  fitRom(name, addr, bytes, label) {
    const s = this.sockets.find(x => x.name === name); if (!s) return false;
    s.addr = addr; s.size = bytes.length > 0x800 ? 0x1000 : 0x800; s.fitted = true; s.label = label || '';
    for (let i = 0; i < s.size; i++) this.rom[addr + i] = bytes[i % bytes.length];
    this.buildRomChips(); return true;
  }
  removeRom(name) { const s = this.sockets.find(x => x.name === name); if (s) { s.fitted = false; s.label = ''; this.buildRomChips(); } }
  ready() { return this.sockets[0].fitted; }
  // ---- lines and faults (the shared scheme in memchips.js) ----
  // The RAMs share A0-A9 and R/W (WRITE' through U4 for the protectable pairs); each pair has its own chip select from
  // the 74LS138 at U1. A 2114's I/O pins are on the data bus. The ROM sockets share A0-A10 (A11 on a 4K socket) and the
  // data bus; each has its own chip select from U24.
  nets() {
    if (this.NETS) return this.NETS;
    const N = {}, ram = this.ramPairs.flat(), roms = this.romChips;
    for (let n = 0; n < 8; n++) N['D' + n] = { label: `data bus line D${n}`, d: -1, pins: [...roms.map(c => [c.id, 'D' + n]), ...ram.filter(c => n >= c.nib && n < c.nib + 4).map(c => [c.id, 'I/O' + (n - c.nib + 1)])] };
    for (let n = 0; n < 12; n++) N['A' + n] = { label: `address bus line A${n}`, d: -1, pins: [...(n < 10 ? ram.map(c => [c.id, 'A' + n]) : []), ...roms.filter(c => n < c.abits).map(c => [c.id, 'A' + n])] };
    this.ramPairs.forEach((p, k) => { N['CS' + k] = { label: `RAM chip select ${k} (U1 output ${k})`, d: -1, pins: p.map(c => [c.id, 'CS']) }; });
    N.WE = { label: 'RAM WRITE\'', d: -1, pins: ram.map(c => [c.id, 'WE']) };
    return (this.NETS = N);
  }
  refault() {
    const z = this.cpuC.lv;
    this.fx = this.cpuC.faulty;
    this.heldWhy = 'PHI0' in z ? 'no clock at the 6502\'s PHI0 pin' : z.RES === 0 ? 'RES is low at the 6502: it is held in reset' : z.RDY === 0 ? 'RDY is low at the 6502: it waits' : null;
    if (z.NMI === 0 && !this.nmiLow && this.cpu) this.cpu.nmiPending = true;
    this.nmiLow = z.NMI === 0;
    if (z.SO === 0 && !this.soLow && this.cpu) this.cpu.p |= 0x40;
    this.soLow = z.SO === 0;
  }
  held() { return this.heldWhy; }
  busA(a) { return this.fx ? this.cpuC.busA(a) : a; }
  // RST: RES goes to the 6502, the three VIAs and the RIOT, and clears the DEBUG flip-flop. reset(true) is power on.
  reset(cold) {
    if (cold === true) { this.ram.fill(0); this.riot.ram.fill(0); this.keysDown.clear(); this.segT.fill(0); this.segFrom = this.ct; this.tapeOutLv = 0; }
    this.via1.reset(); this.via2.reset(); this.via3.reset(); this.riot.reset();
    this.debug = false;
    this.cpu.reset();
  }
  // POR': VIA 1's CA2 high (it is high from reset until SUPERMON writes the PCR) and the address outside A000h-A7FFh
  por(a) { return this.via1.ca2() === 1 && (a < 0xA000 || a >= 0xA800); }
  // ---- the keypad matrix and the 74145 at U37 ----
  // A line is low if a pin driving it is low, or a key joins it to a line that a pin drives low; otherwise the pull-ups
  // hold it high. Lines: columns 0-6 (PA0-PA6), rows 0-3 (PA7, PB0, PB1, PB2).
  keyLines() {
    const r = this.riot, drv = (or, dd, b) => dd >> b & 1 ? (or >> b & 1) : -1;
    const col = [0, 1, 2, 3, 4, 5, 6].map(b => drv(r.ora, r.ddra, b)), row = [drv(r.ora, r.ddra, 7), drv(r.orb, r.ddrb, 0), drv(r.orb, r.ddrb, 1), drv(r.orb, r.ddrb, 2)];
    const cl = col.map(v => v === 0 ? 0 : 1), rl = row.map(v => v === 0 ? 0 : 1);
    for (const k of this.keysDown) { const p = SYM_KEYPOS[k]; if (!p) continue; const [y, x] = p; const lv = Math.min(cl[x], rl[y]); cl[x] = rl[y] = lv; }
    // a second pass: a column pulled low by one row reaches the other rows on keys in that column
    for (const k of this.keysDown) { const p = SYM_KEYPOS[k]; if (!p) continue; const [y, x] = p; const lv = Math.min(cl[x], rl[y]); cl[x] = rl[y] = lv; }
    let a = 0; for (let b = 0; b < 7; b++) a |= cl[b] << b; a |= rl[0] << 7;
    const b = rl[1] | rl[2] << 1 | rl[3] << 2 | 1 << 3 | 1 << 4 | 1 << 5 | (this.ttyIn() << 6) | (this.crtIn() << 7);
    return { a, b };
  }
  // a change on the RIOT's ports: the display, the speaker and the cassette output follow U37
  portChange() {
    this.segUpdate();
    const d = this.riot.pb() & 0x0F;
    this.u37 = d;
    const spk = d === 6 ? 1 : 0; if (spk !== this.spk) { this.spk = spk; this.audioEdge(); }
    const to = d === 7 ? 1 : 0; if (to !== this.tapeOutLv) { this.tapeOutLv = to; if (this.rec) this.rec.push(this.ct); }
    this.lit = d < 6 ? d : -1; this.litSegs = this.lit >= 0 ? this.riot.pa() : 0;
    const crt = this.riot.pb() >> 4 & 1; if (crt !== this.crtOut) { this.crtOut = crt; this.rx.edges.push([this.ct, crt]); }
  }
  segUpdate() {
    const dt = this.ct - this.segFrom; this.segFrom = this.ct;
    if (this.lit < 0 || dt <= 0) return;
    for (let s = 0; s < 8; s++) if (this.litSegs >> s & 1) this.segT[this.lit * 8 + s] += dt;
  }
  // the display over the time since the last call: each segment's share of the time it was lit, 0-1
  displayFrame() {
    this.segUpdate();
    const span = Math.max(1, this.ct - (this.dispFrom ?? 0)); this.dispFrom = this.ct;
    const out = new Float32Array(48); for (let i = 0; i < 48; i++) { out[i] = this.segT[i] / span; this.segT[i] = 0; }
    return out;
  }
  // the display as six characters, for tests: a segment counts as lit if it was on for at least a tenth of a scan
  displayText(frame) {
    const f = frame || this.displayFrame(), rev = {};
    const SEG = { 0x3F: '0', 0x06: '1', 0x5B: '2', 0x4F: '3', 0x66: '4', 0x6D: '5', 0x7D: '6', 0x07: '7', 0x7F: '8', 0x67: '9', 0x6F: '9', 0x77: 'A', 0x7C: 'b', 0x39: 'C', 0x5E: 'd', 0x79: 'E', 0x71: 'F', 0x40: '-', 0x00: ' ', 0x6E: 'Y', 0x76: 'H', 0x38: 'L', 0x73: 'P', 0x50: 'r', 0x54: 'n', 0x5C: 'o', 0x3E: 'U', 0x1C: 'u', 0x08: '_', 0x01: '‾', 0x37: 'N' };
    let max = 0; for (const v of f) max = Math.max(max, v);
    let s = '';
    for (let d = 0; d < 6; d++) {
      let m = 0; for (let k = 0; k < 8; k++) if (f[d * 8 + k] > max * 0.3) m |= 1 << k;
      s += (SEG[m & 0x7F] ?? '?') + (m & 0x80 ? '.' : '');
    }
    return s;
  }
  // ---- the DEBUG flip-flop (U8) ----
  // set by the DEBUG ON key or (jumper W24) VIA 3 PA4 low, cleared by DEBUG OFF, (jumper X25) VIA 3 PA5 low or RESET
  debugInputs() { const pa = this.via3.pa(); if (this.jumpers.W24 && !(pa & 0x10)) this.debug = true; if (this.jumpers.X25 && !(pa & 0x20)) this.debug = false; }
  inMonitor(a) { const s = this.sockets[0]; return a >= s.addr && a < s.addr + s.size; }
  // ---- memory ----
  socketAt(a) { for (const s of this.sockets) if (s.fitted && a >= s.addr && a < s.addr + s.size) return s; return null; }
  read(a) {
    this.ct++;
    if (this.fx) { a = this.cpuC.busA(a); return (this.dbus = this.cpuC.busD(this.cpuC.lv.RW === 0 ? this.dbus : this.readM(a, false))); }
    return (this.dbus = this.readM(a, false));
  }
  readM(a, quiet) {
    const open = quiet ? 0xFF : this.dbus;
    if (this.por(a) && a >= 0x8000) {                                 // POR': the ROM in P0, whatever the address
      const s = this.sockets[0]; if (!s.fitted) return open;
      if (!quiet) this.acc[4]++;
      const o = a & (s.size - 1);
      return this.faulty && this.romChips[0].faulty ? memBankRead(this.banks[4], o, quiet) : this.rom[s.addr + o];
    }
    if (a < 0x2000) {                                                 // U1: 1K blocks; four pairs of 2114s on the board
      const k = a >> 10; if (k >= this.ramKB) return open;
      if (!quiet) this.acc[k]++;
      return this.faulty && this.ramPairs[k].faulty ? memBankRead(this.ramPairs[k], a & 0x3FF, quiet) : this.ram[a];
    }
    if (a >= 0xA000 && a < 0xA800) {
      if (!(a & 0x400)) { if (!quiet) this.acc[8]++; return quiet ? this.peekVia(this.via1, a, 1) : this.viaRead(this.via1, a, 1); }
      if (a & 0x200) { if (!quiet) this.acc[11]++; return this.riot.ram[a & 0x7F]; }
      if (!quiet) this.acc[9]++;
      return quiet ? this.peekRiot(a) : this.riot.readIO(a & 0x1F);
    }
    if (a >= 0xA800 && a < 0xB000) {
      if (!quiet) this.acc[10]++;
      if (a & 0x400) return quiet ? this.peekVia(this.via3, a, 3) : this.viaRead(this.via3, a, 3);
      if (!this.via2Fitted) return open;
      return quiet ? this.peekVia(this.via2, a, 2) : this.viaRead(this.via2, a, 2);
    }
    if (a >= 0xF800 && this.jumpers.U22) { if (!quiet) this.acc[11]++; return this.riot.ram[a & 0x7F]; }   // U11 output 7
    const s = this.socketAt(a);
    if (s) {
      const i = this.sockets.indexOf(s); if (!quiet) this.acc[4 + i]++;
      const c = this.romChips[i];
      return this.faulty && c.faulty ? memBankRead(this.banks[4 + i], a - s.addr, quiet) : this.rom[a];
    }
    return open;
  }
  viaRead(v, a, n) {
    if (n === 1) v.inB = 0xBF | this.tapeLevel() << 6;                // PB6: the cassette input comparator (U26)
    return v.read(a & 15);
  }
  peekVia(v, a, n) { const r = a & 15; if (r === 0) return v.pb(); if (r === 1 || r === 15) return v.pa(); if (r === 13) return (v.ifr & 0x7F) | (v.irq() ? 0x80 : 0); return [0, 0, v.ddrb, v.ddra, v.t1 & 0xFF, v.t1 >> 8 & 0xFF, v.t1l & 0xFF, v.t1l >> 8, v.t2 & 0xFF, v.t2 >> 8 & 0xFF, v.sr, v.acr, v.pcr, 0, v.ier | 0x80, 0][r]; }
  peekRiot(a) { const r = this.riot; if (!(a & 4)) return [r.pa(), r.ddra, ((r.orb & r.ddrb) | (r.pb() & ~r.ddrb)) & 0xFF, r.ddrb][a & 3]; return a & 1 ? (r.tFlag ? 0x80 : 0) | (r.eFlag ? 0x40 : 0) : r.timer; }
  peek(a) { if (this.fx) a = this.cpuC.busA(a); return this.readM(a, true); }
  write(a, v) {
    this.ct++;
    if (this.fx) { if (this.cpuC.lv.RW === 1) return; a = this.cpuC.busA(a); v = this.cpuC.busD(v); }
    this.dbus = v;
    if (a < 0x2000) {
      const k = a >> 10; if (k >= this.ramKB) return;
      this.acc[k]++;
      if (k && this.jumpers[['', 'JJ', 'KK', 'LL'][k]] && !(this.via3.pa() >> k & 1)) return;      // write protected
      if (this.faulty && this.ramPairs[k].faulty) memBankWrite(this.ramPairs[k], a & 0x3FF, v); else this.ram[a] = v;
      return;
    }
    if (a >= 0xA000 && a < 0xA800) {
      if (!(a & 0x400)) { this.acc[8]++; this.via1.write(a & 15, v); return; }
      if (a & 0x200) { this.acc[11]++; this.sysRamWrite(a, v); return; }
      this.acc[9]++; this.riot.writeIO(a & 0x1F, v); return;
    }
    if (a >= 0xA800 && a < 0xB000) {
      this.acc[10]++;
      if (a & 0x400) this.via3.write(a & 15, v); else if (this.via2Fitted) this.via2.write(a & 15, v);
      return;
    }
    if (a >= 0xF800 && this.jumpers.U22 && !this.por(a)) { this.acc[11]++; this.sysRamWrite(a, v); }
  }
  // System RAM is written only while VIA 3 PA0 is high (jumper MM fitted): SUPERMON's ACCESS routine sets it
  sysRamWrite(a, v) { if (this.jumpers.MM && !(this.via3.pa() & 1)) return; this.riot.ram[a & 0x7F] = v; }
  // ---- keys ----
  keyDown(k) {
    if (k === 'RST') { this.rstDown = true; this.reset(false); return; }
    if (k === 'DEBUG ON') { this.debug = true; return; }
    if (k === 'DEBUG OFF') { this.debug = false; return; }
    this.keysDown.add(k);
  }
  keyUp(k) { if (k === 'RST') { this.rstDown = false; return; } this.keysDown.delete(k); }
  // ---- the serial terminal on the CRT port ----
  bitT() { return SYM.CPU_HZ / this.baud; }
  // RS-232 in, as the RIOT's PB7 sees it (inverted: idle low, the start bit high, data bits inverted, stop bits low)
  crtIn() {
    const t = this.tx; if (!t) return 0;
    const k = Math.floor((this.ct - t.start) / this.bitT());
    if (k === 0) return 1;
    if (k >= 1 && k <= 8) return (t.byte >> (k - 1) & 1) ^ 1;
    return 0;
  }
  ttyIn() { return 0; }
  send(text) { for (const ch of text) { let c = ch.charCodeAt(0); if (c === 10) c = 13; if (c < 0x80) this.txQ.push(c); } }
  // the terminal starts a character when SUPERMON is waiting for one (its INTCHR loop at 8A5Fh-8A69h), or when the
  // line has been quiet for a long time (a program with serial routines of its own)
  txPump() {
    const bt = this.bitT();
    if (this.tx && this.ct - this.tx.start >= 11 * bt) { this.txEnd = this.tx.start + 11 * bt; this.tx = null; }
    if (this.tx || !this.txQ.length) return;
    const pc = this.cpu.pc, waiting = this.ready() && pc >= 0x8A5F && pc < 0x8A6A;
    if (waiting || this.ct - this.txEnd > 400 * bt) this.tx = { byte: this.txQ.shift(), start: this.ct };
  }
  // RS-232 out: PB4's changes, decoded as a terminal would, sampling the middle of each bit
  rxPump() {
    const r = this.rx, bt = this.bitT(), E = r.edges;
    const levelAt = t => { let lv = 0; for (const [et, l] of E) { if (et > t) break; lv = l; } return lv; };
    for (;;) {
      if (r.start < 0) {
        const e = E.find(([t, l]) => l === 1 && t >= r.after); if (!e) { if (E.length > 64) E.splice(0, E.length - 2); return; }
        r.start = e[0];
      }
      if (this.ct < r.start + 9.6 * bt) return;
      let v = 0; for (let k = 0; k < 8; k++) v |= (levelAt(r.start + (k + 1.5) * bt) ^ 1) << k;
      this.rxOut.push(v); r.after = r.start + 9.5 * bt; r.start = -1;
      while (E.length > 2 && E[1][0] < r.after) E.shift();
    }
  }
  // what the terminal has received since the last call, as text
  takeOutput() { const s = String.fromCharCode(...this.rxOut.map(c => c & 0x7F)); this.rxOut.length = 0; return s; }
  // ---- the cassette: VIA 1 PB6 follows the tape's polarity while it plays ----
  playTape(edges, label) { this.tape = { edges, at: this.ct, pos: 0, label: label || 'tape', len: edges.length ? edges[edges.length - 1] : 0 }; }
  stopTape() { this.tape = null; }
  tapeLevel() {
    const t = this.tape; if (!t) return this.tapeIn;
    const now = this.ct - t.at, e = t.edges;
    while (t.pos < e.length && e[t.pos] <= now) t.pos++;
    this.tapeIn = t.pos & 1; return this.tapeIn;
  }
  tapeDone() { return !!this.tape && this.ct - this.tape.at >= this.tape.len; }
  startRec() { this.rec = []; this.recAt = this.ct; }
  stopRec() { const r = this.rec; this.rec = null; return (r || []).map(c => c - this.recAt); }
  audioEdge() { }
  // ---- per instruction ----
  // IRQ: the three VIAs' outputs, wired together (the 6532's is not connected, Peck page 26)
  irqLevel() { return this.via1.irq() || this.via3.irq() || (this.via2Fitted && this.via2.irq()); }
  syncIrq() { const i = this.cpuC.lv.IRQ; this.cpu.irqLine = i !== undefined ? i === 0 : this.irqLevel(); }
  afterStep(cyc) {
    const n = cyc.length; this.t += n; if (this.ct < this.t) this.ct = this.t; else if (this.ct > this.t) this.t = this.ct;
    this.via1.tick(n); this.via2.tick(n); this.via3.tick(n); this.riot.tick(n);
    if (this.cpu.lastEvent === 'IRQ') this.irqs = (this.irqs || 0) + 1;
    if (this.cpu.lastEvent === 'NMI') this.nmis = (this.nmis || 0) + 1;
    // DEBUG on: an opcode fetched from outside P0 pulls NMI low (U7: DEBUG ON, SYNC and not P0); the 6502 takes the
    // interrupt once the instruction is done
    if (this.debug && !this.cpu.lastEvent && n && cyc[0].sync && !cyc[0].held && !this.inMonitor(cyc[0].a)) this.cpu.nmiPending = true;
    if (this.audioRate) { this.audioT += n * this.audioRate; while (this.audioT >= SYM.CPU_HZ) { this.audioT -= SYM.CPU_HZ; this.abuf[this.aw++ & 32767] = this.spk ? 0.25 : -0.25; } }
    this.txPump(); if (this.rx.edges.length) this.rxPump();
    return n;
  }
  step() { this.syncIrq(); return this.afterStep(this.cpu.step()); }
  run(cycles) { let t = 0; while (t < cycles) t += this.step(); return t; }
  // ---- listing ----
  report() {
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0'), h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), out = [], c = this.cpu;
    out.push(`SYM-1 listing: ${this.ramKB}K RAM`);
    out.push(`CPU  PC ${h4(c.pc)}  A ${h2(c.a)}  X ${h2(c.x)}  Y ${h2(c.y)}  SP 01${h2(c.s)}  P ${h2(c.p)}`, '');
    out.push(`Display  ${this.displayText()}    DEBUG ${this.debug ? 'on' : 'off'}`);
    out.push('ROM sockets'); for (const s of this.sockets) out.push(`  ${s.name} (${s.u})  ${s.fitted ? h4(s.addr) + 'h-' + h4(s.addr + s.size - 1) + 'h  ' + (s.label || 'ROM') : 'empty'}`);
    out.push('', 'System RAM (A600h-A67Fh)');
    for (let a = 0; a < 128; a += 16) out.push(`  ${h4(0xA600 + a)}  ${[...this.riot.ram.subarray(a, a + 16)].map(h2).join(' ')}`);
    out.push('', 'RAM (rows of zeros left out)');
    for (let a = 0; a < this.ramKB * 1024; a += 16) {
      let hx = '', as = '', zero = true; for (let i = 0; i < 16; i++) { const v = this.ram[a + i]; if (v) zero = false; hx += h2(v) + ' '; as += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; }
      if (!zero) out.push(`  ${h4(a)}  ${hx} ${as}`);
    }
    return out.join('\n') + '\n';
  }
  loadBin(bytes, addr) {
    const end = addr + bytes.length; if (end > this.ramKB * 1024) return { ok: false, addr, end };
    this.ram.set(bytes, addr); return { ok: true, addr, end };
  }
}
Object.assign(SymMachine.prototype, BOARD_FAULTS);
if (typeof module !== 'undefined') module.exports = { SymMachine, SYM, SYM_SOCKETS, SYM_KEYS, SYM_SHIFTED, SYM_LAYOUT, SYM_KEYPOS, SYM_BAUDS, symTapeHS, symTapeFromSamples, symWavFromTape };
