// ---- NMOS 6502 CPU core: every clock cycle is a logged bus access ----
// Each step() runs one instruction (or an IRQ/NMI/reset sequence) and returns
// an array of bus cycles: { k: 'R'|'W', a, d, sync?, dummy? }. One entry = one clock.
const P_N = 0x80, P_V = 0x40, P_U = 0x20, P_B = 0x10, P_D = 0x08, P_I = 0x04, P_Z = 0x02, P_C = 0x01;

// opcode table: [mnemonic, addressing mode]
// modes: imp acc imm zp zpx zpy abs abx aby izx izy ind rel
const OPS6502 = new Array(256).fill(null);
(() => {
  const grp = { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0D, abx: 0x1D, aby: 0x19, izx: 0x01, izy: 0x11 };
  for (const [m, base] of [['ORA', 0x00], ['AND', 0x20], ['EOR', 0x40], ['ADC', 0x60], ['STA', 0x80], ['LDA', 0xA0], ['CMP', 0xC0], ['SBC', 0xE0]])
    for (const mode in grp) if (!(m === 'STA' && mode === 'imm')) OPS6502[base + grp[mode]] = [m, mode];
  const shf = { acc: 0x0A, zp: 0x06, zpx: 0x16, abs: 0x0E, abx: 0x1E };
  for (const [m, base] of [['ASL', 0x00], ['ROL', 0x20], ['LSR', 0x40], ['ROR', 0x60]])
    for (const mode in shf) OPS6502[base + shf[mode]] = [m, mode];
  const list = {
    'BPL rel': 0x10, 'BMI rel': 0x30, 'BVC rel': 0x50, 'BVS rel': 0x70, 'BCC rel': 0x90, 'BCS rel': 0xB0, 'BNE rel': 0xD0, 'BEQ rel': 0xF0,
    'BIT zp': 0x24, 'BIT abs': 0x2C, 'BRK imp': 0x00, 'JSR abs': 0x20, 'RTI imp': 0x40, 'RTS imp': 0x60, 'JMP abs': 0x4C, 'JMP ind': 0x6C,
    'CLC imp': 0x18, 'SEC imp': 0x38, 'CLI imp': 0x58, 'SEI imp': 0x78, 'CLV imp': 0xB8, 'CLD imp': 0xD8, 'SED imp': 0xF8,
    'PHP imp': 0x08, 'PLP imp': 0x28, 'PHA imp': 0x48, 'PLA imp': 0x68,
    'DEY imp': 0x88, 'TXA imp': 0x8A, 'TYA imp': 0x98, 'TXS imp': 0x9A, 'TAY imp': 0xA8, 'TAX imp': 0xAA, 'TSX imp': 0xBA,
    'INY imp': 0xC8, 'DEX imp': 0xCA, 'INX imp': 0xE8, 'NOP imp': 0xEA,
    'STY zp': 0x84, 'STY zpx': 0x94, 'STY abs': 0x8C, 'STX zp': 0x86, 'STX zpy': 0x96, 'STX abs': 0x8E,
    'LDY imm': 0xA0, 'LDY zp': 0xA4, 'LDY zpx': 0xB4, 'LDY abs': 0xAC, 'LDY abx': 0xBC,
    'LDX imm': 0xA2, 'LDX zp': 0xA6, 'LDX zpy': 0xB6, 'LDX abs': 0xAE, 'LDX aby': 0xBE,
    'CPY imm': 0xC0, 'CPY zp': 0xC4, 'CPY abs': 0xCC, 'CPX imm': 0xE0, 'CPX zp': 0xE4, 'CPX abs': 0xEC,
    'DEC zp': 0xC6, 'DEC zpx': 0xD6, 'DEC abs': 0xCE, 'DEC abx': 0xDE, 'INC zp': 0xE6, 'INC zpx': 0xF6, 'INC abs': 0xEE, 'INC abx': 0xFE
  };
  for (const k in list) { const [m, mode] = k.split(' '); OPS6502[list[k]] = [m, mode]; }
})();
const MODE_LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, abs: 3, abx: 3, aby: 3, izx: 2, izy: 2, ind: 3, rel: 2 };
const READ_OPS = new Set(['LDA', 'LDX', 'LDY', 'EOR', 'AND', 'ORA', 'ADC', 'SBC', 'CMP', 'CPX', 'CPY', 'BIT']);
const WRITE_OPS = new Set(['STA', 'STX', 'STY']);
const RMW_OPS = new Set(['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC']);
const sgn8 = v => (v & 0x80) ? v - 256 : v;

class M6502 {
  constructor(bus) {
    this.bus = bus;
    this.log = true;
    this.cyc = [];
    this.irqLine = false;
    this.nmiPending = false;
    this.a = 0; this.x = 0; this.y = 0; this.s = 0; this.p = P_U | P_I; this.pc = 0; // S ends at FDh after the first reset
    this.pollI = true; this.jammed = false; this.resetPending = false;
  }
  snapshot() { return { a: this.a, x: this.x, y: this.y, s: this.s, p: this.p, pc: this.pc, jammed: this.jammed }; }
  // instant reset (used by the Reset button): same end state as the 7-cycle sequence
  reset() {
    this.s = (this.s - 3) & 0xFF; this.p = (this.p | P_I | P_U) & 0xFF;
    const rd = this.bus.peek || this.bus.read; // no side effects for an instant reset
    this.pc = rd(0xFFFC) | (rd(0xFFFD) << 8);
    this.jammed = false; this.nmiPending = false; this.pollI = true; this.resetPending = false;
  }

  // ---- bus ----
  rd(a, dummy) { a &= 0xFFFF; const v = this.bus.read(a) & 0xFF; if (this.log) this.cyc.push(dummy ? { k: 'R', a, d: v, dummy: true } : { k: 'R', a, d: v }); return v; }
  wr(a, v, dummy) { a &= 0xFFFF; v &= 0xFF; this.bus.write(a, v); if (this.log) this.cyc.push(dummy ? { k: 'W', a, d: v, dummy: true } : { k: 'W', a, d: v }); }
  fetch(dummy) { const a = this.pc, v = this.bus.read(a) & 0xFF; if (this.log) this.cyc.push({ k: 'R', a, d: v, sync: true, dummy: !!dummy }); return v; }
  push(v) { this.wr(0x100 | this.s, v); this.s = (this.s - 1) & 0xFF; }
  pull() { this.s = (this.s + 1) & 0xFF; return this.rd(0x100 | this.s); }
  nz(v) { this.p = (this.p & ~(P_N | P_Z)) | (v & 0x80) | (v ? 0 : P_Z); return v; }

  // ---- ALU ----
  adc(v) {
    const a = this.a, c = this.p & P_C;
    if (this.p & P_D) {
      let lo = (a & 0x0F) + (v & 0x0F) + c;
      if (lo > 9) lo += 6;
      let hi = (a >> 4) + (v >> 4) + (lo > 0x0F ? 1 : 0);
      const z = ((a + v + c) & 0xFF) === 0;
      const n = hi & 0x08, ov = ((hi << 4) ^ a) & 0x80 && !((a ^ v) & 0x80);
      if (hi > 9) hi += 6;
      this.p = (this.p & ~(P_N | P_V | P_Z | P_C)) | (n ? P_N : 0) | (ov ? P_V : 0) | (z ? P_Z : 0) | (hi > 15 ? P_C : 0);
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    } else {
      const r = a + v + c;
      this.p = (this.p & ~(P_V | P_C)) | ((~(a ^ v) & (a ^ r) & 0x80) ? P_V : 0) | (r > 0xFF ? P_C : 0);
      this.a = this.nz(r & 0xFF);
    }
  }
  sbc(v) {
    const a = this.a, b = 1 - (this.p & P_C), r = a - v - b;
    this.p = (this.p & ~(P_V | P_C)) | (((a ^ v) & (a ^ r) & 0x80) ? P_V : 0) | (r >= 0 ? P_C : 0);
    this.nz(r & 0xFF);
    if (this.p & P_D) {
      let lo = (a & 0x0F) - (v & 0x0F) - b, hi = (a >> 4) - (v >> 4);
      if (lo & 0x10) { lo -= 6; hi--; }
      if (hi & 0x10) hi -= 6;
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    } else this.a = r & 0xFF;
  }
  cmp(reg, v) { const r = reg - v; this.p = (this.p & ~P_C) | (r >= 0 ? P_C : 0); this.nz(r & 0xFF); }
  readOp(m, v) {
    switch (m) {
      case 'LDA': this.a = this.nz(v); break; case 'LDX': this.x = this.nz(v); break; case 'LDY': this.y = this.nz(v); break;
      case 'AND': this.a = this.nz(this.a & v); break; case 'ORA': this.a = this.nz(this.a | v); break; case 'EOR': this.a = this.nz(this.a ^ v); break;
      case 'ADC': this.adc(v); break; case 'SBC': this.sbc(v); break;
      case 'CMP': this.cmp(this.a, v); break; case 'CPX': this.cmp(this.x, v); break; case 'CPY': this.cmp(this.y, v); break;
      case 'BIT': this.p = (this.p & ~(P_N | P_V | P_Z)) | (v & 0xC0) | ((this.a & v) ? 0 : P_Z); break;
    }
  }
  rmwOp(m, v) {
    let r;
    switch (m) {
      case 'ASL': this.p = (this.p & ~P_C) | (v >> 7); r = (v << 1) & 0xFF; break;
      case 'LSR': this.p = (this.p & ~P_C) | (v & 1); r = v >> 1; break;
      case 'ROL': r = ((v << 1) | (this.p & P_C)) & 0xFF; this.p = (this.p & ~P_C) | (v >> 7); break;
      case 'ROR': r = (v >> 1) | ((this.p & P_C) << 7); this.p = (this.p & ~P_C) | (v & 1); break;
      case 'INC': r = (v + 1) & 0xFF; break;
      case 'DEC': r = (v - 1) & 0xFF; break;
    }
    return this.nz(r);
  }
  storeVal(m) { return m === 'STA' ? this.a : m === 'STX' ? this.x : this.y; }
  branchTaken(m) {
    const p = this.p;
    switch (m) {
      case 'BPL': return !(p & P_N); case 'BMI': return !!(p & P_N); case 'BVC': return !(p & P_V); case 'BVS': return !!(p & P_V);
      case 'BCC': return !(p & P_C); case 'BCS': return !!(p & P_C); case 'BNE': return !(p & P_Z); case 'BEQ': return !!(p & P_Z);
    }
  }

  // interrupt/reset sequences (7 cycles)
  interrupt(vector, brk) {
    this.push(this.pc >> 8); this.push(this.pc & 0xFF);
    this.push((this.p | P_U | (brk ? P_B : 0)) & ~(brk ? 0 : P_B));
    this.p |= P_I;
    const lo = this.rd(vector), hi = this.rd(vector + 1);
    this.pc = (hi << 8) | lo;
  }

  // ---- one instruction ----
  step() {
    this.cyc = [];
    this.lastEvent = null;
    if (this.resetPending) {
      this.resetPending = false; this.jammed = false; this.nmiPending = false;
      this.fetch(true); this.rd(this.pc, true);
      for (let i = 0; i < 3; i++) { this.rd(0x100 | this.s, true); this.s = (this.s - 1) & 0xFF; }
      this.p |= P_I | P_U;
      const lo = this.rd(0xFFFC), hi = this.rd(0xFFFD);
      this.pc = (hi << 8) | lo; this.pollI = true;
      this.lastEvent = 'RESET';
      return this.cyc;
    }
    if (this.jammed) { this.rd(0xFFFF, true); return this.cyc; }
    if (this.nmiPending || (this.irqLine && !this.pollI)) {
      const nmi = this.nmiPending; this.nmiPending = false;
      this.fetch(true); this.rd(this.pc, true);
      this.interrupt(nmi ? 0xFFFA : 0xFFFE, false);
      this.pollI = true;
      this.lastEvent = nmi ? 'NMI' : 'IRQ';
      return this.cyc;
    }
    const iBefore = !!(this.p & P_I);
    const op = this.fetch(); this.pc = (this.pc + 1) & 0xFFFF;
    const e = OPS6502[op];
    if (!e) { this.jammed = true; this.pc = (this.pc - 1) & 0xFFFF; this.lastEvent = 'JAM'; return this.cyc; }
    this.exec(e[0], e[1]);
    this.pollI = (e[0] === 'CLI' || e[0] === 'SEI' || e[0] === 'PLP') ? iBefore : !!(this.p & P_I);
    return this.cyc;
  }

  exec(m, mode) {
    const next = () => { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; };
    switch (m) { // instructions with their own cycle patterns
      case 'BRK': next(); this.interrupt(0xFFFE, true); this.lastEvent = 'BRK'; return;
      case 'JSR': {
        const lo = next(); this.rd(0x100 | this.s, true);
        this.push(this.pc >> 8); this.push(this.pc & 0xFF);
        const hi = this.rd(this.pc); this.pc = (hi << 8) | lo; return;
      }
      case 'RTS': {
        this.rd(this.pc, true); this.rd(0x100 | this.s, true);
        const lo = this.pull(), hi = this.pull(); this.pc = (hi << 8) | lo;
        this.rd(this.pc, true); this.pc = (this.pc + 1) & 0xFFFF; return;
      }
      case 'RTI': {
        this.rd(this.pc, true); this.rd(0x100 | this.s, true);
        this.p = (this.pull() | P_U) & ~P_B;
        const lo = this.pull(), hi = this.pull(); this.pc = (hi << 8) | lo; return;
      }
      case 'PHA': this.rd(this.pc, true); this.push(this.a); return;
      case 'PHP': this.rd(this.pc, true); this.push(this.p | P_B | P_U); return;
      case 'PLA': this.rd(this.pc, true); this.rd(0x100 | this.s, true); this.a = this.nz(this.pull()); return;
      case 'PLP': this.rd(this.pc, true); this.rd(0x100 | this.s, true); this.p = (this.pull() | P_U) & ~P_B; return;
      case 'JMP':
        if (mode === 'abs') { const lo = next(), hi = this.rd(this.pc); this.pc = (hi << 8) | lo; }
        else { const lo = next(), hi = next(), ptr = (hi << 8) | lo; const l = this.rd(ptr), h = this.rd((ptr & 0xFF00) | ((ptr + 1) & 0xFF)); this.pc = (h << 8) | l; }
        return;
    }
    if (mode === 'rel') {
      const off = sgn8(next());
      if (this.branchTaken(m)) {
        this.rd(this.pc, true);
        const np = (this.pc + off) & 0xFFFF;
        if ((np ^ this.pc) & 0xFF00) this.rd((this.pc & 0xFF00) | (np & 0xFF), true);
        this.pc = np;
      }
      return;
    }
    if (mode === 'imp' || mode === 'acc') {
      this.rd(this.pc, true);
      if (mode === 'acc') { this.a = this.rmwOp(m, this.a); return; }
      switch (m) {
        case 'CLC': this.p &= ~P_C; break; case 'SEC': this.p |= P_C; break;
        case 'CLI': this.p &= ~P_I; break; case 'SEI': this.p |= P_I; break;
        case 'CLV': this.p &= ~P_V; break; case 'CLD': this.p &= ~P_D; break; case 'SED': this.p |= P_D; break;
        case 'TAX': this.x = this.nz(this.a); break; case 'TAY': this.y = this.nz(this.a); break;
        case 'TXA': this.a = this.nz(this.x); break; case 'TYA': this.a = this.nz(this.y); break;
        case 'TSX': this.x = this.nz(this.s); break; case 'TXS': this.s = this.x; break;
        case 'INX': this.x = this.nz((this.x + 1) & 0xFF); break; case 'INY': this.y = this.nz((this.y + 1) & 0xFF); break;
        case 'DEX': this.x = this.nz((this.x - 1) & 0xFF); break; case 'DEY': this.y = this.nz((this.y - 1) & 0xFF); break;
        case 'NOP': break;
      }
      return;
    }
    if (mode === 'imm') { this.readOp(m, next()); return; }
    const kind = READ_OPS.has(m) ? 'r' : WRITE_OPS.has(m) ? 'w' : 'm';
    let addr;
    switch (mode) {
      case 'zp': addr = next(); break;
      case 'zpx': case 'zpy': { const b = next(); this.rd(b, true); addr = (b + (mode === 'zpx' ? this.x : this.y)) & 0xFF; break; }
      case 'abs': { const lo = next(), hi = next(); addr = (hi << 8) | lo; break; }
      case 'abx': case 'aby': case 'izy': {
        let lo, hi;
        if (mode === 'izy') { const p = next(); lo = this.rd(p); hi = this.rd((p + 1) & 0xFF); }
        else { lo = next(); hi = next(); }
        const t = lo + (mode === 'abx' ? this.x : this.y);
        addr = ((hi << 8) + t) & 0xFFFF;
        if (t > 0xFF || kind !== 'r') this.rd((hi << 8) | (t & 0xFF), true);
        break;
      }
      case 'izx': { const p = next(); this.rd(p, true); const q = (p + this.x) & 0xFF; const lo = this.rd(q), hi = this.rd((q + 1) & 0xFF); addr = (hi << 8) | lo; break; }
    }
    if (kind === 'r') this.readOp(m, this.rd(addr));
    else if (kind === 'w') this.wr(addr, this.storeVal(m));
    else { const v = this.rd(addr); this.wr(addr, v, true); this.wr(addr, this.rmwOp(m, v)); }
  }
}

// ---- Disassembler ----
const h2 = v => v.toString(16).toUpperCase().padStart(2, '0');
const h4 = v => v.toString(16).toUpperCase().padStart(4, '0');
function disasm(read, addr) {
  const op = read(addr & 0xFFFF), e = OPS6502[op];
  if (!e) return { len: 1, text: '???', bad: true };
  const [m, mode] = e, len = MODE_LEN[mode];
  const b1 = read((addr + 1) & 0xFFFF), b2 = read((addr + 2) & 0xFFFF), w = '$' + h4((b2 << 8) | b1), z = '$' + h2(b1);
  let o;
  switch (mode) {
    case 'imp': o = ''; break; case 'acc': o = 'A'; break; case 'imm': o = '#' + z; break;
    case 'zp': o = z; break; case 'zpx': o = z + ',X'; break; case 'zpy': o = z + ',Y'; break;
    case 'abs': o = w; break; case 'abx': o = w + ',X'; break; case 'aby': o = w + ',Y'; break;
    case 'izx': o = '(' + z + ',X)'; break; case 'izy': o = '(' + z + '),Y'; break; case 'ind': o = '(' + w + ')'; break;
    case 'rel': o = '$' + h4((addr + 2 + sgn8(b1)) & 0xFFFF); break;
  }
  return { len, text: o ? m + ' ' + o : m };
}

if (typeof module !== 'undefined') module.exports = { M6502, OPS6502, MODE_LEN, disasm, h2, h4 };
