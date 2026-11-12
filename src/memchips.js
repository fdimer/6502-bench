// Memory chips as objects with pins, for the live pin display and for fault simulation.
// A MemChip stores some of the bits (dmask) of every byte in part of a machine's memory array: all eight for a
// byte-wide ROM or RAM, four for a 2114, one for a 4116 or 4164 dynamic RAM. The chips that together make up the
// bytes of one area form a bank (an array of MemChips); memBankRead and memBankWrite go through the bank.
// Each pin can be given a fault: 'z' (disconnected), 0 (stuck low) or 1 (stuck high).
//   address pin: that address bit is forced (a disconnected input floats high); on a multiplexed dynamic RAM the
//     pin carries a row bit and a column bit, so two CPU address lines are affected
//   data pin: the bit reads as the forced level and is stored as the forced level (disconnected: reads and stores 1)
//   chip select stuck high or disconnected (or a fault on RAS or CAS): the chip is out of circuit; its bits read 1
//     and writes to it are lost
//   chip select stuck low: the chip is selected all the time (chip.always; the machine decides what that does)
//   output enable stuck high or disconnected: the chip never drives the bus
//   write enable stuck high or disconnected: writes are lost; stuck low: every access is a write, so the cell is
//     overwritten with 1s and reads float to 1s
const MEM_PINOUTS = {
  '2764': [[1, 'VPP', 'p'], [2, 'A12', 'i'], [3, 'A7', 'i'], [4, 'A6', 'i'], [5, 'A5', 'i'], [6, 'A4', 'i'], [7, 'A3', 'i'], [8, 'A2', 'i'], [9, 'A1', 'i'], [10, 'A0', 'i'], [11, 'O0', 'i'], [12, 'O1', 'i'], [13, 'O2', 'i'], [14, 'GND', 'g'],
    [15, 'O3', 'i'], [16, 'O4', 'i'], [17, 'O5', 'i'], [18, 'O6', 'i'], [19, 'O7', 'i'], [20, 'CE', 'i'], [21, 'A10', 'i'], [22, 'OE', 'i'], [23, 'A11', 'i'], [24, 'A9', 'i'], [25, 'A8', 'i'], [26, 'NC', 'c'], [27, 'PGM', 'p'], [28, 'VCC', 'p']],
  '27128': [[1, 'VPP', 'p'], [2, 'A12', 'i'], [3, 'A7', 'i'], [4, 'A6', 'i'], [5, 'A5', 'i'], [6, 'A4', 'i'], [7, 'A3', 'i'], [8, 'A2', 'i'], [9, 'A1', 'i'], [10, 'A0', 'i'], [11, 'O0', 'i'], [12, 'O1', 'i'], [13, 'O2', 'i'], [14, 'GND', 'g'],
    [15, 'O3', 'i'], [16, 'O4', 'i'], [17, 'O5', 'i'], [18, 'O6', 'i'], [19, 'O7', 'i'], [20, 'CE', 'i'], [21, 'A10', 'i'], [22, 'OE', 'i'], [23, 'A11', 'i'], [24, 'A9', 'i'], [25, 'A8', 'i'], [26, 'A13', 'i'], [27, 'PGM', 'p'], [28, 'VCC', 'p']],
  '27256': [[1, 'VPP', 'p'], [2, 'A12', 'i'], [3, 'A7', 'i'], [4, 'A6', 'i'], [5, 'A5', 'i'], [6, 'A4', 'i'], [7, 'A3', 'i'], [8, 'A2', 'i'], [9, 'A1', 'i'], [10, 'A0', 'i'], [11, 'O0', 'i'], [12, 'O1', 'i'], [13, 'O2', 'i'], [14, 'GND', 'g'],
    [15, 'O3', 'i'], [16, 'O4', 'i'], [17, 'O5', 'i'], [18, 'O6', 'i'], [19, 'O7', 'i'], [20, 'CE', 'i'], [21, 'A10', 'i'], [22, 'OE', 'i'], [23, 'A11', 'i'], [24, 'A9', 'i'], [25, 'A8', 'i'], [26, 'A13', 'i'], [27, 'A14', 'i'], [28, 'VCC', 'p']],
  // 24-pin mask ROMs: 2316 (2K), 2332 (4K) and 2364 (8K) share one layout; the upper address pins differ
  '2316': [[1, 'A7', 'i'], [2, 'A6', 'i'], [3, 'A5', 'i'], [4, 'A4', 'i'], [5, 'A3', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'A0', 'i'], [9, 'D0', 'i'], [10, 'D1', 'i'], [11, 'D2', 'i'], [12, 'GND', 'g'],
    [13, 'D3', 'i'], [14, 'D4', 'i'], [15, 'D5', 'i'], [16, 'D6', 'i'], [17, 'D7', 'i'], [18, 'CS3', 'c'], [19, 'A10', 'i'], [20, 'CS', 'i'], [21, 'CS2', 'c'], [22, 'A9', 'i'], [23, 'A8', 'i'], [24, 'VCC', 'p']],
  '2332': [[1, 'A7', 'i'], [2, 'A6', 'i'], [3, 'A5', 'i'], [4, 'A4', 'i'], [5, 'A3', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'A0', 'i'], [9, 'D0', 'i'], [10, 'D1', 'i'], [11, 'D2', 'i'], [12, 'GND', 'g'],
    [13, 'D3', 'i'], [14, 'D4', 'i'], [15, 'D5', 'i'], [16, 'D6', 'i'], [17, 'D7', 'i'], [18, 'A11', 'i'], [19, 'A10', 'i'], [20, 'CS', 'i'], [21, 'CS2', 'c'], [22, 'A9', 'i'], [23, 'A8', 'i'], [24, 'VCC', 'p']],
  '2364': [[1, 'A7', 'i'], [2, 'A6', 'i'], [3, 'A5', 'i'], [4, 'A4', 'i'], [5, 'A3', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'A0', 'i'], [9, 'D0', 'i'], [10, 'D1', 'i'], [11, 'D2', 'i'], [12, 'GND', 'g'],
    [13, 'D3', 'i'], [14, 'D4', 'i'], [15, 'D5', 'i'], [16, 'D6', 'i'], [17, 'D7', 'i'], [18, 'A11', 'i'], [19, 'A10', 'i'], [20, 'CS', 'i'], [21, 'A12', 'i'], [22, 'A9', 'i'], [23, 'A8', 'i'], [24, 'VCC', 'p']],
  '6116': [[1, 'A7', 'i'], [2, 'A6', 'i'], [3, 'A5', 'i'], [4, 'A4', 'i'], [5, 'A3', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'A0', 'i'], [9, 'D0', 'i'], [10, 'D1', 'i'], [11, 'D2', 'i'], [12, 'GND', 'g'],
    [13, 'D3', 'i'], [14, 'D4', 'i'], [15, 'D5', 'i'], [16, 'D6', 'i'], [17, 'D7', 'i'], [18, 'CE', 'i'], [19, 'A10', 'i'], [20, 'OE', 'i'], [21, 'WE', 'i'], [22, 'A9', 'i'], [23, 'A8', 'i'], [24, 'VCC', 'p']],
  '2114': [[1, 'A6', 'i'], [2, 'A5', 'i'], [3, 'A4', 'i'], [4, 'A3', 'i'], [5, 'A0', 'i'], [6, 'A1', 'i'], [7, 'A2', 'i'], [8, 'CS', 'i'], [9, 'GND', 'g'],
    [10, 'WE', 'i'], [11, 'I/O4', 'i'], [12, 'I/O3', 'i'], [13, 'I/O2', 'i'], [14, 'I/O1', 'i'], [15, 'A9', 'i'], [16, 'A8', 'i'], [17, 'A7', 'i'], [18, 'VCC', 'p']],
  '4116': [[1, 'VBB', 'p'], [2, 'DIN', 'i'], [3, 'WE', 'i'], [4, 'RAS', 'i'], [5, 'A0', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'VDD', 'p'],
    [9, 'VCC', 'p'], [10, 'A5', 'i'], [11, 'A4', 'i'], [12, 'A3', 'i'], [13, 'A6', 'i'], [14, 'DOUT', 'i'], [15, 'CAS', 'i'], [16, 'GND', 'g']],
  '4164': [[1, 'NC', 'c'], [2, 'DIN', 'i'], [3, 'WE', 'i'], [4, 'RAS', 'i'], [5, 'A0', 'i'], [6, 'A2', 'i'], [7, 'A1', 'i'], [8, 'VCC', 'p'],
    [9, 'A7', 'i'], [10, 'A5', 'i'], [11, 'A4', 'i'], [12, 'A3', 'i'], [13, 'A6', 'i'], [14, 'DOUT', 'i'], [15, 'CAS', 'i'], [16, 'GND', 'g']],
  // 16K x 4 dynamic RAM (TMS4416 and equivalents): 8 row and 6 column address bits on A0-A7
  '4416': [[1, 'OE', 'i'], [2, 'DQ1', 'i'], [3, 'DQ2', 'i'], [4, 'WE', 'i'], [5, 'RAS', 'i'], [6, 'A6', 'i'], [7, 'A5', 'i'], [8, 'A4', 'i'], [9, 'VCC', 'p'],
    [10, 'A7', 'i'], [11, 'A3', 'i'], [12, 'A2', 'i'], [13, 'A1', 'i'], [14, 'A0', 'i'], [15, 'DQ3', 'i'], [16, 'CAS', 'i'], [17, 'DQ4', 'i'], [18, 'GND', 'g']]
};
const MEM_ACTIVE_LOW = new Set(['CE', 'CS', 'OE', 'WE', 'RAS', 'CAS', 'PGM']);
class MemChip {
  // arr/base/abits: where the chip's cells are (arr[base + address], address 0 .. 2^abits - 1)
  // extra: rom, dram (1-bit dynamic RAM: bit, mux = address pins), nib (2114 or 4416: 0 = low nibble, 4 = high),
  //        mux (multiplexed address pins: pin n carries bits n and n + mux), en (name of the chip-select pin), plus anything the machine wants
  constructor(id, part, what, range, arr, base, abits, extra) {
    Object.assign(this, { id, part, what, range, arr, base, abits, mask: (1 << abits) - 1, f: {}, en: 'CE', mux: 0, nib: -1 }, extra || {});
    this.dmask = this.dram ? 1 << this.bit : this.nib >= 0 ? 0x0F << this.nib : 0xFF;
    this.recalc();
  }
  setFault(pin, v) { if (v === null || v === undefined) delete this.f[pin]; else this.f[pin] = v; this.recalc(); }
  recalc() {
    const f = this.f, lvl = k => f[k] === 'z' ? 1 : f[k], high = k => k in f && lvl(k) === 1;
    let aAnd = 0xFFFF, aOr = 0, dAnd = 0xFF, dOr = 0, n = 0;
    for (const k in f) {
      n++; let m;
      if ((m = /^A(\d+)$/.exec(k))) { const b = +m[1], bits = this.mux ? (1 << b) | (1 << (b + this.mux)) : 1 << b; if (lvl(k)) aOr |= bits; else aAnd &= ~bits; }
      else if ((m = /^[DO](\d)$/.exec(k)) || (m = /^(?:I\/O|DQ)(\d)$/.exec(k))) { const b = /^[DO]\d$/.test(k) ? +m[1] : +m[1] - 1 + this.nib; if (lvl(k)) dOr |= 1 << b; else dAnd &= ~(1 << b); }
    }
    Object.assign(this, { aAnd, aOr, dAnd, dOr, faulty: n > 0 });
    const strobed = this.mux > 0, off = strobed ? 'RAS' in f || 'CAS' in f : high(this.en);
    this.weLow = !off && f.WE === 0;
    this.noRead = off || high('OE') || this.weLow; this.noWrite = off || high('WE') || !!this.rom;
    this.always = !strobed && f[this.en] === 0;
    this.dout = 'DOUT' in f ? lvl('DOUT') : -1; this.din = 'DIN' in f ? lvl('DIN') : -1;
  }
  cell(off) { return this.base + ((off & this.aAnd | this.aOr) & this.mask); }
}
// a bank's faulty flag, to be refreshed whenever a fault changes
function memBankFlag(bank) { bank.faulty = bank.some(c => c.faulty); return bank.faulty; }
function memBankRead(bank, off, quiet) {
  const c0 = bank[0]; let v = c0.arr[c0.base + (off & c0.mask)];
  for (const c of bank) {
    if (!c.faulty) continue;
    const o = c.cell(off); let bits;
    if (c.noRead) { bits = c.dmask; if (c.weLow && !quiet) c.arr[o] |= c.dmask; }
    else bits = c.dout >= 0 ? (c.dout ? c.dmask : 0) : c.arr[o] & c.dAnd | c.dOr;
    v = v & ~c.dmask | bits & c.dmask;
  }
  return v;
}
function memBankWrite(bank, off, v) {
  const c0 = bank[0]; let keep = 0;
  for (const c of bank) {
    if (!c.faulty) continue;
    keep |= c.dmask; if (c.noWrite) continue;
    const o = c.cell(off), bits = c.din >= 0 ? (c.din ? c.dmask : 0) : v & c.dAnd | c.dOr;
    c.arr[o] = c.arr[o] & ~c.dmask | bits & c.dmask;
  }
  if (!c0.rom) { const o0 = c0.base + (off & c0.mask); c0.arr[o0] = c0.arr[o0] & keep | v & ~keep; }
}
// fault bookkeeping shared by the machines: chips is the machine's full list, banks every bank to re-flag
function memSetFault(m, id, pin, v) { m.chipById[id].setFault(pin, v); for (const b of m.banks) memBankFlag(b); m.faulty = m.chips.some(c => c.faulty); }
function memClearFaults(m) { for (const c of m.chips) { c.f = {}; c.recalc(); } for (const b of m.banks) memBankFlag(b); m.faulty = false; }
function memFaultList(m) { const out = []; for (const c of m.chips) for (const k in c.f) out.push([c.id, k, c.f[k]]); return out; }
if (typeof module !== 'undefined') module.exports = { MemChip, MEM_PINOUTS, MEM_ACTIVE_LOW, memBankFlag, memBankRead, memBankWrite, memSetFault, memClearFaults, memFaultList };
