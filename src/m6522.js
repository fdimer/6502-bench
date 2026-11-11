// MOS 6522 VIA: two 8-bit ports with data direction registers, two 16-bit timers, a shift register,
// control lines CA1/CA2/CB1/CB2 and one interrupt output.
// Registers: 0 ORB, 1 ORA, 2 DDRB, 3 DDRA, 4/5 timer 1 counter, 6/7 timer 1 latch, 8/9 timer 2, 10 shift register,
// 11 ACR, 12 PCR, 13 IFR, 14 IER, 15 ORA without handshake.
// Interrupt flags: bit 0 CA2, 1 CA1, 2 shift register, 3 CB2, 4 CB1, 5 timer 2, 6 timer 1.
// Not modelled: timer 1 output on PB7, timer 2 pulse counting, port latching, and shift modes other than
// "free-running output at the timer 2 rate" (the one the PET uses to make sound on CB2).
class M6522 {
  constructor(name) {
    this.name = name || 'VIA';
    this.inA = 0xFF; this.inB = 0xFF; this.ca1 = 1; this.cb1 = 1; this.ca2in = 1; this.cb2in = 1;
    this.onPA = () => {}; this.onPB = () => {}; this.onCA2 = () => {}; this.onCB2 = () => {};
    this.reset();
  }
  reset() {
    this.ora = this.orb = this.ddra = this.ddrb = 0; this.acr = this.pcr = this.ifr = this.ier = 0; this.sr = 0;
    this.t1 = 0xFFFF; this.t1l = 0xFFFF; this.t1armed = false; this.t2 = 0xFFFF; this.t2ll = 0xFF; this.t2armed = false;
    this.ca2out = 1; this.cb2out = 1; this.srCnt = 0; this.srPhase = 0;
    this.onPA(this.pa()); this.onPB(this.pb());
  }
  pa() { return ((this.ora & this.ddra) | (this.inA & ~this.ddra)) & 0xFF; }
  pb() { return ((this.orb & this.ddrb) | (this.inB & ~this.ddrb)) & 0xFF; }
  ca2() { return this.pcr & 0x08 ? this.ca2out : this.ca2in; }
  cb2() { return (this.acr & 0x1C) === 0x10 ? this.cb2out : this.pcr & 0x80 ? this.cb2out : this.cb2in; }
  irq() { return !!(this.ifr & this.ier & 0x7F); }
  read(rs) {
    switch (rs & 15) {
      case 0: this.ifr &= ~0x18; return ((this.orb & this.ddrb) | (this.inB & ~this.ddrb)) & 0xFF;
      case 1: this.ifr &= ~0x03; return this.pa();
      case 2: return this.ddrb;
      case 3: return this.ddra;
      case 4: this.ifr &= ~0x40; return this.t1 & 0xFF;
      case 5: return (this.t1 >> 8) & 0xFF;
      case 6: return this.t1l & 0xFF;
      case 7: return this.t1l >> 8;
      case 8: this.ifr &= ~0x20; return this.t2 & 0xFF;
      case 9: return (this.t2 >> 8) & 0xFF;
      case 10: this.ifr &= ~0x04; return this.sr;
      case 11: return this.acr;
      case 12: return this.pcr;
      case 13: return (this.ifr & 0x7F) | (this.irq() ? 0x80 : 0);
      case 14: return this.ier | 0x80;
      default: return this.pa();
    }
  }
  write(rs, v) {
    v &= 0xFF;
    switch (rs & 15) {
      case 0: this.orb = v; this.ifr &= ~0x18; this.onPB(this.pb()); break;
      case 1: this.ora = v; this.ifr &= ~0x03; this.onPA(this.pa()); break;
      case 15: this.ora = v; this.onPA(this.pa()); break;
      case 2: this.ddrb = v; this.onPB(this.pb()); break;
      case 3: this.ddra = v; this.onPA(this.pa()); break;
      case 4: case 6: this.t1l = (this.t1l & 0xFF00) | v; break;
      case 5: this.t1l = (this.t1l & 0xFF) | v << 8; this.t1 = this.t1l + 1; this.t1armed = true;      // the counter is loaded one cycle after the write this.ifr &= ~0x40; break;
      case 7: this.t1l = (this.t1l & 0xFF) | v << 8; this.ifr &= ~0x40; break;
      case 8: this.t2ll = v; break;
      case 9: this.t2 = (v << 8 | this.t2ll) + 1; this.t2armed = true; this.ifr &= ~0x20; break;
      case 10: this.sr = v; this.ifr &= ~0x04; break;
      case 11: this.acr = v; if ((v & 0x1C) !== 0x10) this.setCb2Out(this.pcr & 0x20 ? 1 : this.cb2out); break;
      case 12:
        this.pcr = v;
        if ((v & 0x0C) === 0x0C) this.setCa2Out((v >> 1) & 1);           // CA2 manual output
        if ((v & 0xC0) === 0xC0 && (this.acr & 0x1C) !== 0x10) this.setCb2Out((v >> 5) & 1);
        break;
      case 13: this.ifr &= ~v; break;                                   // writing a 1 clears that flag
      case 14: if (v & 0x80) this.ier |= v & 0x7F; else this.ier &= ~v; break;
    }
  }
  setCa2Out(l) { if (this.ca2out !== l) { this.ca2out = l; this.onCA2(l); } }
  setCb2Out(l) { if (this.cb2out !== l) { this.cb2out = l; this.onCB2(l); } }
  // control inputs: PCR bit 0 (CA1) and bit 4 (CB1) choose the active edge, 1 = rising
  setCA1(l) { l = l ? 1 : 0; if (l === this.ca1) return; this.ca1 = l; if (l === (this.pcr & 1)) this.ifr |= 0x02; }
  setCB1(l) { l = l ? 1 : 0; if (l === this.cb1) return; this.cb1 = l; if (l === ((this.pcr >> 4) & 1)) this.ifr |= 0x10; }
  setCA2(l) { l = l ? 1 : 0; if (l === this.ca2in) return; this.ca2in = l; if (!(this.pcr & 0x08) && l === ((this.pcr >> 2) & 1)) this.ifr |= 0x01; }
  setCB2(l) { l = l ? 1 : 0; if (l === this.cb2in) return; this.cb2in = l; if (!(this.pcr & 0x80) && l === ((this.pcr >> 6) & 1)) this.ifr |= 0x08; }
  // advance n clock cycles
  tick(n) {
    this.t1 -= n;
    if (this.t1 < 0) {
      if (this.acr & 0x40) { this.ifr |= 0x40; const p = this.t1l + 2; while (this.t1 < 0) this.t1 += p; }      // free-running: reload from the latch
      else { if (this.t1armed) { this.ifr |= 0x40; this.t1armed = false; } this.t1 += 0x10000; }                // one shot: the counter rolls on
    }
    this.t2 -= n;
    if (this.t2 < 0) { if (this.t2armed) { this.ifr |= 0x20; this.t2armed = false; } this.t2 += 0x10000; }
    if ((this.acr & 0x1C) === 0x10) {      // shift register free-running on timer 2's low latch: one bit every two timeouts, out on CB2
      this.srCnt -= n;
      while (this.srCnt < 0) {
        this.srCnt += this.t2ll + 2;
        if ((this.srPhase ^= 1) === 0) { const b = this.sr >> 7; this.sr = ((this.sr << 1) | b) & 0xFF; this.setCb2Out(b); }
      }
    }
  }
}
if (typeof module !== 'undefined') module.exports = { M6522 };
