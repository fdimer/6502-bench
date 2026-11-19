// Apple II Plus main board (RFI revision, board 820-0044) for 6502 Bench.
// From Jim Sather, "Understanding the Apple II" (1983), the Apple II Reference Manual (1979) and the main logic
// board schematic in Apple's addendum for the RFI board.
// A 6502 at 1.02 MHz with:
//   RAM      0000h-BFFFh   16K, 32K or 48K of 4116 dynamic RAM in rows C (0000h), D (4000h) and E (8000h)
//   I/O      C000h-C0FFh   keyboard C00Xh, keyboard strobe reset C01Xh, cassette out C02Xh, speaker C03Xh, C040 strobe,
//                          soft switches C050h-C05Fh (the 74LS259 at F14: graphics/text, mix, page 2, hires, AN0-AN3),
//                          serial inputs C06Xh (cassette in, three push buttons, four paddle timers on D7),
//                          paddle timer trigger C07Xh, the slots' device selects C080h-C0FFh
//   slots    C100h-CFFFh   the slots' I/O selects and I/O strobe (no cards are fitted: these addresses float)
//   ROM      D000h-FFFFh   six 2316B ROMs: D0, D8, E0, E8 and F0 (Applesoft BASIC) and F8 (the Autostart Monitor)
// Nothing drives the data bus at an address no device answers: the 6502 then reads the byte the video scanner drove
// out of RAM during the first half of the same cycle ("the floating bus", Sather 5-5). The video is generated cycle
// by cycle from the scanner's own addresses (Sather chapters 3, 5 and 8), so programs that switch modes or change
// screen memory in the middle of a frame show what a real Apple shows.
//
// Timing (Sather 3-3 to 3-12): 14.31818 MHz master clock; a normal cycle is 14 periods of it and every 65th cycle
// (the scanner's HPE' state) is 16, so a line is 65 cycles and 912 periods, and a frame 262 lines, 17030 cycles.
// The horizontal scanner counts 0000000, then 1000000 to 1111111 (65 states); the picture is shown from 1011000 on
// (40 states). The vertical scanner counts 011111010 to 111111111 (262 states); lines 0-191 carry the picture.

const A2 = {
  MASTER_HZ: 14318180, LINE_T: 65, LINES: 262, FRAME_T: 17030, VISIBLE: 192,
  W: 560, H: 192                                               // the picture: 560 samples of 14M (40 bytes x 14) by 192 lines
};
A2.CPU_HZ = A2.MASTER_HZ * A2.LINE_T / 912;                    // 1,020,484 cycles a second on average
// ROM sockets, by the names printed beside them: the address each one answers
const A2_SOCKETS = [['D0', 0xD000], ['D8', 0xD800], ['E0', 0xE000], ['E8', 0xE800], ['F0', 0xF000], ['F8', 0xF800]];
// the Apple II Plus ROMs: the part number in each socket
const A2_ROM_PARTS = { D0: '341-0011', D8: '341-0012', E0: '341-0013', E8: '341-0014', F0: '341-0015', F8: '341-0020' };
// Applesoft tokens 80h-EAh, for listings
const A2_TOKENS = ['END', 'FOR', 'NEXT', 'DATA', 'INPUT', 'DEL', 'DIM', 'READ', 'GR', 'TEXT', 'PR#', 'IN#', 'CALL', 'PLOT', 'HLIN', 'VLIN', 'HGR2', 'HGR', 'HCOLOR=', 'HPLOT', 'DRAW', 'XDRAW', 'HTAB', 'HOME',
  'ROT=', 'SCALE=', 'SHLOAD', 'TRACE', 'NOTRACE', 'NORMAL', 'INVERSE', 'FLASH', 'COLOR=', 'POP', 'VTAB', 'HIMEM:', 'LOMEM:', 'ONERR', 'RESUME', 'RECALL', 'STORE', 'SPEED=', 'LET', 'GOTO', 'RUN', 'IF',
  'RESTORE', '&', 'GOSUB', 'RETURN', 'REM', 'STOP', 'ON', 'WAIT', 'LOAD', 'SAVE', 'DEF', 'POKE', 'PRINT', 'CONT', 'LIST', 'CLEAR', 'GET', 'NEW', 'TAB(', 'TO', 'FN', 'SPC(', 'THEN', 'AT', 'NOT', 'STEP',
  '+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<', 'SGN', 'INT', 'ABS', 'USR', 'FRE', 'SCRN(', 'PDL', 'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'LEN', 'STR$', 'VAL',
  'ASC', 'CHR$', 'LEFT$', 'RIGHT$', 'MID$'];
// the soft switches at C050h-C05Fh (Sather table 7.1): even address = the first state, odd = the second
const A2_SWITCHES = [['text', 0, 1, 'GRAPHICS', 'TEXT'], ['mixed', 0, 1, 'NOMIX', 'MIX'], ['page2', 0, 1, 'PAGE 1', 'PAGE 2'], ['hires', 0, 1, 'LORES', 'HIRES'],
  ['an0', 0, 1, 'AN0 low', 'AN0 high'], ['an1', 0, 1, 'AN1 low', 'AN1 high'], ['an2', 0, 1, 'AN2 low', 'AN2 high'], ['an3', 0, 1, 'AN3 low', 'AN3 high']];

// The sixteen LORES colours (their dot patterns at 14M: colour n lights dot x when bit x mod 4 of n is set). Four of
// them are also the HIRES colours: 3 violet, 6 blue, 9 orange and 12 green.
const A2_PALETTE = [0x000000, 0xDD0033, 0x000099, 0xDD22DD, 0x007722, 0x555555, 0x2222FF, 0x66AAFF, 0x885500, 0xFF6600, 0xAAAAAA, 0xFF9988, 0x11DD00, 0xFFFF00, 0x44FF99, 0xFFFFFF];
// Turn a picture of dots (A2.W x A2.H, 1 = white level) into pixels, as a monitor shows it:
//   'colour': on a line with the colour burst, each dot takes the colour of the four dots around it (one cycle of
//   COLOR REFERENCE): the pattern of lit dots, read in colour-reference phase, is a LORES colour number. Lines without
//   the burst (TEXT) are white on black, as the colour killer leaves them.
//   'mono': white, green or amber dots, as a monochrome monitor shows them.
// out: a Uint32Array of A2.W x A2.H pixels in the canvas's byte order (ABGR on little-endian machines).
function a2Render(fb, burst, out, mode, tint) {
  const W = A2.W, abgr = rgb => 0xFF000000 | (rgb & 0xFF) << 16 | (rgb & 0xFF00) | rgb >> 16 & 0xFF;
  const pal = A2_PALETTE.map(abgr), on = abgr(tint || 0xFFFFFF), off = abgr(0);
  for (let y = 0; y < A2.H; y++) {
    const o = y * W;
    if (mode === 'mono' || !burst[y]) { for (let x = 0; x < W; x++) out[o + x] = fb[o + x] ? (mode === 'mono' ? on : pal[15]) : off; continue; }
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let k = -1; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < W && fb[o + xx]) n |= 1 << (xx & 3); }
      out[o + x] = pal[n];
    }
  }
}
class AppleMachine {
  constructor() {
    this.ram = new Uint8Array(0xC000); this.ramSize = 0xC000;
    this.rom = new Uint8Array(0x10000); this.fitted = {};            // ROM images at their addresses; fitted[socket] = true
    this.chargen = new Uint8Array(0x800); this.hasChargen = false;     // the 2316B text ROM at A5 (not on the CPU's bus)
    this.sw = { text: 1, mixed: 0, page2: 0, hires: 0, an0: 0, an1: 0, an2: 0, an3: 0 };
    this.paddle = [0.5, 0.5, 0.5, 0.5]; this.button = [0, 0, 0]; this.timerEnd = [0, 0, 0, 0];
    this.kbd = 0; this.strobe = 0; this.typeQ = []; this.keyDown = null;
    this.work = new Uint8Array(A2.W * A2.H); this.fb = new Uint8Array(A2.W * A2.H);   // dots at 14M: the frame being drawn, the last whole one
    this.burstW = new Uint8Array(A2.H); this.burst = new Uint8Array(A2.H);            // colour burst on each line (off in TEXT: the colour killer)
    this.audioRate = 0; this.abuf = new Float32Array(32768); this.aw = 0; this.audioT = 0;
    this.bus = { read: a => this.read(a), write: (a, v) => this.write(a, v), peek: a => this.peek(a) };
    this.cpu = new M6502(this.bus);
    const run = this.cpu.step.bind(this.cpu);
    this.cpu.step = () => {
      const why = this.heldWhy; if (!why) { this.zr = false; return run(); }
      if (!this.zr && this.cpuC.lv.RES === 0) { this.cpu.reset(); this.zr = true; }
      this.cpu.lastEvent = null; return [{ k: 'R', a: this.cpu.pc, d: 0xFF, dummy: true, held: why }];
    };
    // ---- the chips (src/memchips.js), from the RFI main logic board schematic ----
    // RAM: three rows of eight 4116s. In each row the chip in column n + 3 holds data bit n (C3 bit 0 ... C10 bit 7,
    // Sather 2-12). The 74LS153 multiplexers put the 6502's address on RA0-RA6 as (Sather figure 5.3):
    //   RA0 A7/A10, RA1 A2/A4, RA2 A0/A5, RA3 A8/A11, RA4 A3/A9, RA5 A1/A6, RA6 A12/A13 (row/column)
    const C = (id, part, what, range, arr, base, abits, extra) => new MemChip(id, part, what, range, arr, base, abits, extra);
    const amap = [0x0480, 0x0014, 0x0021, 0x0900, 0x0208, 0x0042, 0x3000];
    this.ramRows = ['C', 'D', 'E'].map((r, b) => [0, 1, 2, 3, 4, 5, 6, 7].map(bit => C(r + (bit + 3), '4116', `RAM row ${r}: data bit ${bit}`, `${(b * 0x4000).toString(16).toUpperCase().padStart(4, '0')}h-${(b * 0x4000 + 0x3FFF).toString(16).toUpperCase()}h`, this.ram, b * 0x4000, 14, { dram: true, bit, mux: 7, amap, row: b })));
    this.romChips = A2_SOCKETS.map(([name, a]) => C(name, '2316', `ROM ${name} (${A2_ROM_PARTS[name]}${name === 'F8' ? ', the Autostart Monitor' : ', Applesoft BASIC'})`, `${a.toString(16).toUpperCase()}h-${(a + 0x7FF).toString(16).toUpperCase()}h`, this.rom, a, 11, { rom: true, en: 'CS' }));
    this.cgChip = C('A5', '2316', 'text ROM (character generator, 341-0036)', 'not on the CPU bus: read by the video generator', this.chargen, 0, 11, { rom: true, en: 'CS' });
    this.cpuC = new BoardChip('H7', '6502', 'processor (H7/8)', 'address, data and control lines', { label: 'H7' });
    this.chips = [...this.ramRows[0], ...this.ramRows[1], ...this.ramRows[2], ...this.romChips, this.cgChip, this.cpuC];
    this.chipById = {}; for (const c of this.chips) this.chipById[c.id] = c;
    this.banks = [...this.ramRows, ...this.romChips.map(c => [c]), [this.cgChip]];
    this.pinF = {}; this.netF = {}; this.heldWhy = null; this.fx = false; this.faulty = false;
    this.acc = new Uint32Array(11);           // accesses: 0-2 RAM rows C, D, E; 3-8 the ROMs D0-F8; 9 the text ROM; 10 I/O C000h-C0FFh
    this.t = 0; this.ct = 0;
    this.reset(true);
  }
  setRam(kb) { this.ramSize = kb * 1024; }
  // ---- lines and faults (the shared scheme in memchips.js) ----
  // The lines, from the RFI schematic. The 6502 (H7) reaches the system bus through the 8T97 address buffers (H3-H5)
  // and the 8T28 data transceivers (H10, H11), so its own pins are on lines of their own. The 24 RAMs share RA0-RA6
  // (from the 74LS153s at E11-E13 and C1), RAS' and RAM R/W'; each row has its own CAS'. A data bit's three RAM data
  // inputs are on the data bus line; their three outputs share one line to the RAM data latch (B5, B8). The six
  // ROMs share A0-A10 and D0-D7 of the system bus and INHIBIT' (CS2, from the slots); each has its own ROM ENABLE'
  // from the 74LS138 at F12 on CS1. The buffers, multiplexers and latches are not drawn, so their lines have no
  // drawn driver.
  nets() {
    if (this.NETS) return this.NETS;
    const N = {}, ram = this.ramRows.flat(), roms = this.romChips;
    for (let n = 0; n < 8; n++) N['D' + n] = { label: `data bus line D${n}`, d: -1, pins: [...roms.map(c => [c.id, 'D' + n]), ...this.ramRows.map(r => [r[n].id, 'DIN'])] };
    for (let n = 0; n < 11; n++) N['A' + n] = { label: `address bus line A${n}`, d: -1, pins: roms.map(c => [c.id, 'A' + n]) };
    for (let n = 0; n < 7; n++) N['RA' + n] = { label: `RAM address line RA${n} (from the 74LS153 multiplexers)`, d: -1, pins: ram.map(c => [c.id, 'A' + n]) };
    N.RAS = { label: 'RAS\' to the RAMs', d: -1, pins: ram.map(c => [c.id, 'RAS']) };
    ['C', 'D', 'E'].forEach((r, b) => { N['CAS' + r] = { label: `CAS' row ${r}`, d: -1, pins: this.ramRows[b].map(c => [c.id, 'CAS']) }; });
    N.RAMRW = { label: 'RAM R/W\' (R/W\' gated by PHASE 0)', d: -1, pins: ram.map(c => [c.id, 'WE']) };
    for (let n = 0; n < 8; n++) N['RD' + n] = { label: `RAM data out line ${n} (to the latch at B5/B8)`, d: -1, pins: this.ramRows.map(r => [r[n].id, 'DOUT']) };
    N.INHIBIT = { label: 'INHIBIT\' (pin 32 of the slots: pulled up)', d: -1, pins: roms.map(c => [c.id, 'CS2']) };
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
    // a ROM whose INHIBIT' (CS2) input is pulled low is switched off
    for (const c of this.romChips) c.inhibited = c.f.CS2 === 0;
  }
  held() { return this.heldWhy; }
  busA(a) { return this.fx ? this.cpuC.busA(a) : a; }
  // put a ROM image at an address; marks every socket it covers as fitted
  loadRom(addr, bytes) {
    this.rom.set(bytes, addr);
    for (const [name, a] of A2_SOCKETS) if (a >= addr && a + 0x800 <= addr + bytes.length) this.fitted[name] = true;
  }
  ready() { return !!this.fitted.F8; }
  // RESET (warm): the 6502 alone; the soft switches, the strobe and the speaker keep their states (the Monitor's reset
  // routine sets the screen itself). reset(true) is power on: everything starts again.
  reset(cold) {
    if (cold === true) {
      this.sw = { text: 1, mixed: 0, page2: 0, hires: 0, an0: 0, an1: 0, an2: 0, an3: 0 };
      this.strobe = 0; this.kbd = 0; this.spk = 0; this.casOut = 0; this.tapeIn = 0;
      this.frames = 0; this.frameT = this.ct; this.vt = 0; this.flash = 0; this.speakerToggles = 0;
      this.work.fill(0); this.fb.fill(0);
    }
    this.typeQ.length = 0;
    this.cpu.reset();
  }
  // ---- the video scanner (Sather 3-11, 5-7 to 5-13) ----
  // frame cycle c: line = c / 65, and in each line the first cycle is the long one (HPE' low, horizontal count 0);
  // the next 64 count 1000000 to 1111111. Lines 0-255 are vertical counts 100000000-111111111, lines 256-261 the
  // counts 011111010-011111111 at the start of the next frame's count (they repeat the memory of lines 250-255).
  hState(c) { const h = c % 65; return h ? 0x3F + h : 0; }
  vState(c) { const l = (c / 65) | 0; return l < 256 ? 0x100 + l : 0xFA + l - 256; }
  // the address the scanner drives out of RAM in frame cycle c, for the soft switches s
  scanAddr(c, s) {
    const H = this.hState(c), V = this.vState(c), v3 = V >> 6 & 1, v4 = V >> 7 & 1, v2 = V >> 5 & 1;
    const sum = (0x0D + (H >> 3 & 7) + (v4 << 3 | v3 << 2 | v4 << 1 | v3)) & 15;
    let a = H & 7 | sum << 3 | (V >> 3 & 7) << 7;
    if (s.hires && !s.text && !(s.mixed && v4 && v2)) a |= (V & 7) << 10 | (s.page2 ? 0x4000 : 0x2000);   // HIRES TIME
    else a |= (s.page2 ? 0x800 : 0x400) | (H < 0x58 ? 0x1000 : 0);                                          // TEXT/LORES, A12 = HBL
    return a;
  }
  // the byte the scanner drives out of RAM: what the 6502 reads from the floating bus
  scanByte(c) { return this.vByte(this.scanAddr(c, this.sw)); }
  vByte(a) {
    const row = a >> 14; if (row * 0x4000 >= this.ramSize) return 0xFF;
    return this.faulty && this.ramRows[row].faulty ? memBankRead(this.ramRows[row], a & 0x3FFF, true) : this.ram[a];
  }
  frameCycle() { return this.ct - this.frameT; }
  floating() { const c = this.ct - 1 - this.frameT; return this.scanByte(c < 0 ? c + A2.FRAME_T : c % A2.FRAME_T); }
  // ---- the video generator (Sather chapter 8): one byte of picture per displayed cycle, 14 dots of 14M ----
  // TEXT: the byte addresses the text ROM with the row (VA-VC); bits 6-0 of the ROM are the seven dots, left to right,
  // two 14M periods each. DL7 high: normal; DL7 and DL6 low: inverse; DL7 low and DL6 high: flashing, inverse while
  // the 2 Hz flasher is on. LORES: the low nibble in the top four lines of a row, the high nibble in the bottom four,
  // circulated at 14M so that dot x shows bit (x mod 4). HIRES: bits 0-6 are seven dots of two 14M periods, delayed
  // by one 14M period when bit 7 is set (the delayed half dot holds the last dot of the byte before).
  // The colour burst is off in TEXT mode (the colour killer), so text shows white on a colour monitor.
  vidTo(end) {
    const s = this.sw, w = this.work, cg = this.chargen, cf = this.faulty && this.cgChip.faulty, cgB = this.banks[this.banks.length - 1];
    for (let c = this.vt; c < end; c++) {
      const l = (c / 65) | 0, h = c % 65;
      if (l >= 192) { c = A2.FRAME_T; break; }
      if (h < 25) continue;
      this.burstW[l] = s.text ? 0 : 1;                            // the colour burst goes out in GRAPHICS mode only
      const col = h - 25, b = this.vByte(this.scanAddr(c, s)), o = l * A2.W + col * 14;
      const textNow = s.text || (s.mixed && l >= 160);
      if (textNow) {
        const ra = (b & 0xC0) << 3 | (b & 0x3F) << 3 | (l & 7);
        let d = cf ? memBankRead(cgB, ra, true) : cg[ra];
        const inv = !(b & 0x80) && (!(d & 0x80) || this.flash);
        if (inv) d = ~d;
        for (let k = 0; k < 7; k++) { const v = d >> (6 - k) & 1; w[o + 2 * k] = v; w[o + 2 * k + 1] = v; }
      } else if (!s.hires) {
        const nib = (l & 4) ? b >> 4 : b & 15, x0 = col * 14;
        for (let k = 0; k < 14; k++) w[o + k] = nib >> ((x0 + k) & 3) & 1;
      } else {
        const d = b >> 7, prev = col ? w[o - 1] : 0;
        if (d) w[o] = prev;
        for (let k = 0; k < 7; k++) { const v = b >> k & 1, x = 2 * k + d; w[o + x] = v; if (x + 1 < 14) w[o + x + 1] = v; }
      }
    }
    this.vt = Math.max(this.vt, Math.min(end, A2.FRAME_T));
  }
  // the picture as it stands now: the lines of this frame drawn so far over the last whole frame
  liveFrame() {
    this.catchUp(); const n = Math.min(A2.H, (this.vt / 65) | 0);
    if (!this.live) { this.live = new Uint8Array(A2.W * A2.H); this.liveB = new Uint8Array(A2.H); }
    this.live.set(this.fb); this.live.set(this.work.subarray(0, n * A2.W)); this.liveB.set(this.burst); this.liveB.set(this.burstW.subarray(0, n));
    return { fb: this.live, burst: this.liveB };
  }
  catchUp() { const c = this.ct - this.frameT; if (c > this.vt) this.vidTo(c); }
  endFrame() {
    this.vidTo(A2.FRAME_T);
    this.fb.set(this.work); this.burst.set(this.burstW);
    this.frames++; this.frameT += A2.FRAME_T; this.vt = 0;
    this.flash = (this.frames >> 4) & 1;                       // the 2 Hz flasher: inverse for 16 frames, normal for 16
  }
  // ---- memory ----
  socketAt(a) { for (const [name, s] of A2_SOCKETS) if (a >= s && a < s + 0x800) return name; return null; }
  rowPresent(a) { return a < this.ramSize; }
  read(a) {
    this.ct++;
    if (this.fx) { a = this.cpuC.busA(a); return this.cpuC.busD(this.cpuC.lv.RW === 0 ? this.floating() : this.readM(a, false)); }
    return this.readM(a, false);
  }
  readM(a, quiet) {
    if (a < 0xC000) {
      if (!quiet) this.acc[a >> 14]++;
      if (a >= this.ramSize) return quiet ? 0xFF : this.floating();
      return this.faulty && this.ramRows[a >> 14].faulty ? memBankRead(this.ramRows[a >> 14], a & 0x3FFF, quiet) : this.ram[a];
    }
    if (a < 0xC100) return quiet ? this.peekIO(a) : this.io(a, false, 0);
    if (a < 0xD000) return quiet ? 0xFF : this.floating();          // the slots: no cards
    const i = (a - 0xD000) >> 11, c = this.romChips[i];
    if (!quiet) this.acc[3 + i]++;
    if (!this.fitted[c.id] || c.inhibited) return quiet ? 0xFF : this.floating();
    return this.faulty && c.faulty ? memBankRead(this.banks[3 + i], a & 0x7FF, quiet) : this.rom[a];
  }
  peek(a) {
    if (this.fx) a = this.cpuC.busA(a);
    return this.readM(a, true);
  }
  write(a, v) {
    this.ct++;
    if (this.fx) { if (this.cpuC.lv.RW === 1) return; a = this.cpuC.busA(a); v = this.cpuC.busD(v); }
    if (a < 0xC000) {
      this.acc[a >> 14]++; if (a >= this.ramSize) return;
      if (a >= 0x400 && a < 0x6000) this.catchUp();             // screen memory: the picture so far is drawn first
      if (this.faulty && this.ramRows[a >> 14].faulty) memBankWrite(this.ramRows[a >> 14], a & 0x3FFF, v); else this.ram[a] = v;
      return;
    }
    if (a < 0xC100) this.io(a, true, v);
  }
  // ---- I/O: C000h-C0FFh. Any access acts, read or write (R/W' is not part of the decoding, Sather 7-8) ----
  io(a, wr, v) {
    this.acc[10]++;
    const r = a >> 4 & 15, fl = () => this.floating();
    switch (r) {
      case 0: return this.kbd | this.strobe << 7;                              // the keyboard: 7-bit code and the strobe flip-flop
      case 1: this.strobe = 0; return fl();
      case 2: this.casOut ^= 1; return fl();
      case 3: this.spk ^= 1; this.speakerToggles++; this.audioEdge(); return fl();
      case 4: return fl();                                                       // C040 STROBE' to the game connector
      case 5: { this.catchUp(); const sw = A2_SWITCHES[a >> 1 & 7]; this.sw[sw[0]] = a & 1; return fl(); }
      case 6: {                                                                  // the serial input multiplexor on D7 only
        const n = a & 7, now = this.ct;
        const bit = n === 0 ? this.tapeIn : n < 4 ? this.button[n - 1] : now < this.timerEnd[n - 4] ? 1 : 0;
        return bit << 7 | fl() & 0x7F;
      }
      case 7: for (let n = 0; n < 4; n++) this.timerEnd[n] = this.ct + this.paddleCycles(n); return fl();
      default: return fl();                                                      // C080h-C0FFh: the slots' device selects
    }
  }
  // the 558 timer's pulse is (R + 100) x 0.022 microseconds for a 150K paddle at resistance R (Sather 7-11)
  paddleCycles(n) { return Math.round((this.paddle[n] * 150000 + 100) * 0.022 * A2.CPU_HZ / 1e6); }
  peekIO(a) {
    const r = a >> 4 & 15;
    if (r === 0) return this.kbd | this.strobe << 7;
    if (r === 6) { const n = a & 7; return (n === 0 ? this.tapeIn : n < 4 ? this.button[n - 1] : this.ct < this.timerEnd[n - 4] ? 1 : 0) << 7; }
    return 0xFF;
  }
  // ---- keyboard: the AY-5-3600 encoder latches a 7-bit code and its strobe sets the flip-flop read on D7 ----
  // Typed text waits in a queue: the next key goes in once the program has cleared the strobe.
  key(code) { this.kbd = code & 0x7F; this.strobe = 1; this.keyAt = this.ct; }
  type(text) { for (const ch of text) { let c = ch.charCodeAt(0); if (c === 10) c = 13; if (c >= 0x60 && c < 0x80) c -= 0x20; if (c < 0x80) this.typeQ.push(c); } }
  // ---- sound: the speaker flip-flop, sampled as the machine runs ----
  audioEdge() { }
  // ---- per instruction ----
  irqLevel() { return false; }                 // no cards: nothing pulls IRQ or NMI low
  syncIrq() { const i = this.cpuC.lv.IRQ; this.cpu.irqLine = i !== undefined ? i === 0 : this.irqLevel(); }
  afterStep(cyc) {
    const n = cyc.length; this.t += n; if (this.ct < this.t) this.ct = this.t; else if (this.ct > this.t) this.t = this.ct;
    if (this.cpu.lastEvent === 'IRQ') this.irqs = (this.irqs || 0) + 1;
    if (this.audioRate) { this.audioT += n * this.audioRate; while (this.audioT >= A2.CPU_HZ) { this.audioT -= A2.CPU_HZ; this.abuf[this.aw++ & 32767] = this.spk ? 0.25 : -0.25; } }
    if (this.typeQ.length && !this.strobe && this.ct - (this.keyAt || 0) > 2000) this.key(this.typeQ.shift());
    while (this.ct - this.frameT >= A2.FRAME_T) this.endFrame();
    return n;
  }
  get line() { return ((this.ct - this.frameT) / 65) | 0; }
  step() { this.syncIrq(); return this.afterStep(this.cpu.step()); }
  run(cycles) { let t = 0; while (t < cycles) t += this.step(); return t; }
  // ---- the screen as text (40 x 24 of the text page shown), for tests and listings ----
  screenText(page2) {
    const out = [], base = (page2 ?? this.sw.page2) ? 0x800 : 0x400;
    for (let y = 0; y < 24; y++) {
      let s = ''; const a = base + (y & 7) * 128 + (y >> 3) * 40;
      for (let x = 0; x < 40; x++) { let c = this.ram[a + x] & 0x3F; c = c < 32 ? c + 64 : c; s += String.fromCharCode(c); }
      out.push(s.replace(/\s+$/, ''));
    }
    return out;
  }
  // ---- BASIC program as text: Applesoft's TXTTAB (67h) to VARTAB (69h) ----
  peekW(a) { return this.ram[a] | this.ram[a + 1] << 8; }
  basicListing() {
    const out = []; let a = this.peekW(0x67), guard = 0; const end = this.peekW(0x69);
    if (a < 0x0800 || a >= 0xC000 || end < a || end > this.ramSize) return out;
    while (guard++ < 5000) {
      const next = this.peekW(a); if (!next || next <= a || next > end) break;
      let s = this.peekW(a + 2) + ' ';
      for (let p = a + 4; p < next - 1; p++) {
        const c = this.ram[p]; if (!c) break;
        s += c >= 0x80 ? (A2_TOKENS[c - 0x80] ? ' ' + A2_TOKENS[c - 0x80] + ' ' : '{' + c.toString(16).toUpperCase() + '}') : c >= 32 ? String.fromCharCode(c) : '{' + c.toString(16).toUpperCase().padStart(2, '0') + '}';
      }
      out.push(s.replace(/ +/g, ' ').trim()); a = next;
    }
    return out;
  }
  report() {
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0'), h4 = v => v.toString(16).toUpperCase().padStart(4, '0'), out = [], c = this.cpu, s = this.sw;
    out.push(`Apple II Plus (RFI main board) listing: ${this.ramSize / 1024}K RAM`);
    out.push(`CPU  PC ${h4(c.pc)}  A ${h2(c.a)}  X ${h2(c.x)}  Y ${h2(c.y)}  SP 01${h2(c.s)}  P ${h2(c.p)}`, '');
    out.push(`Soft switches  ${s.text ? 'TEXT' : 'GRAPHICS'}  ${s.mixed ? 'MIX' : 'NOMIX'}  ${s.page2 ? 'PAGE 2' : 'PAGE 1'}  ${s.hires ? 'HIRES' : 'LORES'}  AN0-AN3 ${s.an0}${s.an1}${s.an2}${s.an3}`);
    out.push(`Keyboard  ${h2(this.kbd)}  strobe ${this.strobe}`, '');
    out.push('BASIC pointers');
    for (const [a, n, w] of [[0x67, 'TXTTAB', 'start of the BASIC program'], [0x69, 'VARTAB', 'start of variables (end of program)'], [0x6B, 'ARYTAB', 'start of arrays'], [0x6D, 'STREND', 'end of arrays'], [0x6F, 'FRETOP', 'bottom of string space'], [0x73, 'MEMSIZ', 'top of BASIC memory']])
      out.push(`  ${h4(a)}  ${n.padEnd(7)} ${h4(this.peekW(a))}   ${w}`);
    out.push('', 'BASIC program'); const prog = this.basicListing(); out.push(...(prog.length ? prog.map(l => '  ' + l) : ['  (none)']));
    out.push('', 'Text page', ...this.screenText().map(l => '  |' + l));
    out.push('', 'RAM (rows of zeros left out)');
    for (let a = 0; a < this.ramSize; a += 16) {
      let hx = '', as = '', zero = true; for (let i = 0; i < 16; i++) { const v = this.ram[a + i]; if (v) zero = false; hx += h2(v) + ' '; as += v >= 32 && v < 127 ? String.fromCharCode(v) : '.'; }
      if (!zero) out.push(`  ${h4(a)}  ${hx} ${as}`);
    }
    return out.join('\n') + '\n';
  }
  // ---- programs: a binary file with its load address, or a BASIC program's tokens at 0801h ----
  loadBin(bytes, addr) {
    const end = addr + bytes.length; if (end > this.ramSize) return { ok: false, addr, end };
    this.ram.set(bytes, addr); return { ok: true, addr, end };
  }
}
Object.assign(AppleMachine.prototype, BOARD_FAULTS);
if (typeof module !== 'undefined') module.exports = { AppleMachine, A2, A2_SOCKETS, A2_ROM_PARTS, A2_TOKENS, A2_SWITCHES, A2_PALETTE, a2Render };
