// MOS/Synertek 6532 RIOT: 128 bytes of RAM, two 8-bit ports with data direction registers, an interval timer and
// an edge detector on PA7. From the SY6532 data sheet (in the SYM-1 Reference Manual, appendix).
// RS low selects the RAM (A0-A6). RS high selects the I/O, by A0-A4:
//   A2 low:  A1 A0 = 00 port A, 01 DDRA, 10 port B, 11 DDRB
//   A2 high, write with A4 high: the timer, divided by 1, 8, 64 or 1024 (A1 A0); A3 high enables its interrupt
//   A2 high, write with A4 low:  the PA7 edge detector: A0 = rising (1) or falling (0) edge, A1 enables its interrupt
//   A2 high, read with A0 low:   the timer (A3 high enables its interrupt, low disables it; the flag is cleared)
//   A2 high, read with A0 high:  the interrupt flags: bit 7 timer, bit 6 PA7 edge (reading clears the PA7 flag)
// The timer counts down once every 1, 8, 64 or 1024 cycles; when it passes zero it sets its flag and from then on
// counts down once a cycle, so a program can tell how long ago it ran out.
// Port A reads the pins. Port B reads the output register on its output bits and the pins on its input bits.
// inA() and inB() give the levels the outside world puts on the pins (pulled high when nothing drives them).
class M6532 {
  constructor(name) {
    this.name = name || 'RIOT';
    this.ram = new Uint8Array(128);
    this.inA = () => 0xFF; this.inB = () => 0xFF;
    this.onPA = () => {}; this.onPB = () => {};
    this.fmA = 0; this.fvA = 0; this.fmB = 0; this.fvB = 0;     // forced (stuck) pins, as on the 6522 model
    this.reset();
  }
  reset() {
    this.ora = this.orb = this.ddra = this.ddrb = 0;
    this.timer = 0xFF; this.div = 1024; this.sub = 0; this.tIrq = false; this.tFlag = false; this.expired = false;
    this.edgePos = false; this.eIrq = false; this.eFlag = false; this.pa7 = 1;
    this.onPA(this.pa()); this.onPB(this.pb());
  }
  // the levels on the pins: an output pin drives its register bit, an input pin shows the outside world
  pa() { const v = (this.ora & this.ddra) | (this.inA() & ~this.ddra); return ((v & ~this.fmA) | (this.fvA & this.fmA)) & 0xFF; }
  pb() { const v = (this.orb & this.ddrb) | (this.inB() & ~this.ddrb); return ((v & ~this.fmB) | (this.fvB & this.fmB)) & 0xFF; }
  irq() { return (this.tFlag && this.tIrq) || (this.eFlag && this.eIrq); }
  // the edge detector watches PA7: call after anything that may change it
  edge() {
    const l = this.pa() >> 7 & 1;
    if (l !== this.pa7) { if (l === (this.edgePos ? 1 : 0)) this.eFlag = true; this.pa7 = l; }
  }
  readIO(a) {
    if (!(a & 4)) {
      switch (a & 3) {
        case 0: return this.pa();
        case 1: return this.ddra;
        case 2: return ((this.orb & this.ddrb) | (this.pb() & ~this.ddrb)) & 0xFF;
        default: return this.ddrb;
      }
    }
    if (!(a & 1)) { this.tIrq = !!(a & 8); this.tFlag = false; return this.timer; }
    const f = (this.tFlag ? 0x80 : 0) | (this.eFlag ? 0x40 : 0); this.eFlag = false; return f;
  }
  writeIO(a, v) {
    v &= 0xFF;
    if (!(a & 4)) {
      switch (a & 3) {
        case 0: this.ora = v; this.onPA(this.pa()); this.edge(); break;
        case 1: this.ddra = v; this.onPA(this.pa()); this.edge(); break;
        case 2: this.orb = v; this.onPB(this.pb()); break;
        default: this.ddrb = v; this.onPB(this.pb()); break;
      }
      return;
    }
    if (a & 0x10) { this.div = [1, 8, 64, 1024][a & 3]; this.timer = v; this.sub = 0; this.tIrq = !!(a & 8); this.tFlag = false; this.expired = false; }
    else { this.edgePos = !!(a & 1); this.eIrq = !!(a & 2); }
  }
  // advance n clock cycles
  tick(n) {
    if (this.expired) { this.timer = (this.timer - n) & 0xFF; return; }
    this.sub += n;
    while (this.sub >= this.div) {
      this.sub -= this.div;
      if (this.timer === 0) { this.tFlag = true; this.expired = true; this.timer = (0xFF - this.sub) & 0xFF; this.sub = 0; return; }
      this.timer--;
    }
  }
  force(name, l) {
    const m = /^P([AB])(\d)$/.exec(name); if (!m) return;
    const bit = 1 << +m[2];
    if (m[1] === 'A') { this.fmA = l === null ? this.fmA & ~bit : this.fmA | bit; this.fvA = l ? this.fvA | bit : this.fvA & ~bit; this.onPA(this.pa()); this.edge(); }
    else { this.fmB = l === null ? this.fmB & ~bit : this.fmB | bit; this.fvB = l ? this.fvB | bit : this.fvB & ~bit; this.onPB(this.pb()); }
  }
}
if (typeof module !== 'undefined') module.exports = { M6532 };
