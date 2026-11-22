# 6502 Bench: SYM-1 branch (Synertek Systems SYM-1)

This branch turns 6502 Bench into a Synertek SYM-1 single board computer: the 6502 with its pinout, bus timing, disassembly and debug points, wired to the SYM-1's memory, keypad, display, serial port and cassette. It was built from the *SYM-1 Reference Manual* (Synertek, January 1981: chapter 4, figure 4-10 and the SUPERMON listing) and Robert A. Peck's *SYM-1 Hardware Theory of Operations Manual* (1979) with its schematic. It branches from the Apple II branch, whose files (`src/apple2.js`, `src/a2disk.js`, `src/pet.js`, `src/m6821.js` and their tests) are still here but not used by the page.

- **Machine**: a 6502 at 1 MHz; 1K to 4K of 2114 RAM at 0000h; four ROM sockets P0-P3 (SUPERMON, a 4K ROM, in P0 at 8000h; the others anywhere a 2K block from 8000h up is free); VIA 1 at A000h, the 6532 RIOT at A400h with its RAM (System RAM) at A600h, VIA 2 (optional, the user's socket) at A800h and VIA 3 at AC00h, repeated through their blocks by the partial decoding; System RAM echoed at F800h-FFFFh, so the vectors come from A67Ah-A67Fh.
- **Power-on reset**: VIA 1's CA2 is high from reset, and while it is (and the address is outside A000h-A7FFh) P0 answers at every address, so the 6502 reads its reset vector from 8FFCh; SUPERMON ends it by writing VIA 1's PCR.
- **Keypad and display**: the 28 keys, laid out as on the board, in the matrix SUPERMON scans (columns on PA0-PA6, rows on PA7 and PB0-PB2); RST, DEBUG ON and DEBUG OFF wired as hardware. The six digits are lit by the 74145 at U37 from PB0-PB3 with the segments on port A, and drawn from the share of the time each segment is lit, as the eye sees a multiplexed display. Output 6 of U37 is the speaker (with sound), output 7 the cassette output.
- **Serial terminal**: the CRT port (PB4 out, PB7 in, the RS-232 lines inverted), bit-banged by SUPERMON and decoded by the page's terminal at 110-4800 baud; log on with Q, as on the real board (SUPERMON measures the baud rate). The terminal sends a character when SUPERMON is waiting for one. It can also talk to a real SYM-1 on a serial port (Web Serial, in Chrome and Edge).
- **Debug**: the DEBUG flip-flop pulls NMI on every opcode fetch outside P0, so SUPERMON single-steps and traces; jumpers W24 and X25 let VIA 3 PA4 and PA5 switch it.
- **Cassette**: the input (VIA 1 PB6) plays a recording or a tape made from a binary file in SUPERMON's high-speed format; recording the output gives a WAV file. Checked with S1/L1 (KIM format) and S2/L2 (high speed).
- **Memory chips, with faults**: the eight 2114s and the four ROM sockets, with live pins; click a pin to hold its line or disconnect it.
- **Hardware panel**: the RIOT's ports and timer, U37's output, the keys down, the serial lines and SUPERMON's SDBYT, TOUTFL and TECHO, VIA 1 (POR', tape), VIA 3 (write protection, the DEBUG flip-flop).
- **Not yet**: the TTY (20 mA) port, the oscilloscope display output, BASIC (its ROMs are not on bitsavers).

**ROMs are not included.** Load your own with the Load ROM folder button: SUPERMON 1.1 (`symon1_1.bin`, 4K) and the RAE ROMs are recognised by their contents; other 2K and 4K ROMs are placed by the address in their file names (`..._C000.BIN`), or by clicking a socket. Open `6502-bench.html` from this folder. The machine is `src/sym1.js` and the 6532 `src/m6532.js`; `node tests/sym1-test.js` checks them with a small stand-in ROM, and with `SYM_ROMS` set to a folder holding SUPERMON it also runs the monitor: the keypad and display, the terminal at 4800 and 300 baud, both cassette formats, the high-speed tape encoder and the debug single step.

The rest of this file describes the 6502 Bench base.

---

# 6502 Bench

An NMOS 6502 emulator for debugging programs and designing hardware around the chip. It runs in a web browser and shows the state of all 40 pins on every clock cycle. It is a sister project of [Z80 Bench](https://github.com/fdimer/z80-bench), with the same layout.

**Try it online:** <https://fdimer.github.io/6502-bench/app/>

Open `6502-bench.html` in any web browser, from this folder on your computer (it loads the CPU core and assembler from `src/`). It needs no installation or internet connection; the web fonts fall back to system fonts offline.

To get a single self-contained file instead, run `python build.py`, which writes `6502-bench-standalone.html`.

## Features

- **Pinout**: 40-pin DIP view that updates every clock cycle (high, low, or floating). Click the input pins to drive them:
  - φ0 pulses one clock, which is one bus cycle
  - /IRQ is level-sensitive and masked by the I flag (with the real one-instruction delay after CLI, SEI and PLP)
  - /NMI triggers on a falling edge
  - /SO sets the V flag on a falling edge
  - RDY low stops the CPU on its next read cycle; writes still complete, as on the NMOS part
  - /RES held low keeps the CPU in reset; releasing it runs the 7-cycle reset sequence and loads PC from FFFCh
- **Cycle-accurate bus**: every cycle is a real memory access, including the dummy reads and writes the 6502 makes during indexed addressing, page crossings, branches and read-modify-write instructions. The bus timing panel shows φ2, SYNC, R/W, address and data for each cycle of the current instruction.
- **Program input**: switch between Assembly and Hex.
  - Assembly: standard 6502 syntax. Labels start in column 1 or end with `:`. Supports `.org` / `* =`, `=` / `EQU`, `.byte`, `.word`, `.res`, `.end`, expressions, `*` for the current address, and `<label` / `>label` for the low and high byte. Zero page is chosen automatically when the address is known to be below 0100h.
  - Hex: bytes with optional `ADDR:` jumps, or Intel HEX.
  - **Import file…** (or drop a file on the editor): `.asm`/`.s`/`.a65` go to Assembly; `.hex`/`.ihx` and plain hex text go to Hex; raw `.bin`/`.rom` images are converted to hex.
  - **Load at** sets where code goes in memory, for example the start of ROM. In Assembly it applies until the first `.org`; Intel HEX keeps its own addresses.
  - After loading, the CPU is reset through the reset vector at FFFCh if the program sets one; otherwise PC is set to the load address.
- **Memory map**: RAM size from 0000h, a write-protected ROM region at the top of memory (8000h, C000h, E000h or F000h to FFFFh), and a 16-byte memory-mapped I/O block. Unmapped reads return FFh or the last value on the data bus. The defaults (16 KB RAM, I/O at 6000h, ROM from 8000h) follow a common hobby layout.
- **Stepping**: one cycle, one instruction, or run at 5 Hz, 50 Hz, 1 kHz, 5 kHz, 10 kHz or full speed.
- **Breakpoints**: click a line in the disassembly to cycle between *break at* (filled dot: stops before the instruction runs), *break after* (ring: stops when the PC leaves that address, so a branch to itself keeps running until it falls through) and off.
- **Register stops**: click **stop** beside any register and give a hex value; the run halts at the end of the instruction that changes the register to that value, in every run mode.
- **Debug pane**: lists every breakpoint and stop, with a × to remove each and a click to jump to it. From it you can also add:
  - *memory stops*: halt after the instruction that changes the byte at an address, or changes it to a given value
  - *pin stops*: halt on the clock where a pin changes, goes high or goes low (while one is set, full speed runs clock by clock, so it is slower)
  - *bus stops*: halt on the clock where the address bus or data bus takes a given value (like pin stops, these slow full speed while set)
- **I/O**: writes to the I/O block are shown as 8-LED latches with a log of every access. You can set the value each register returns when read.

## Files

| Path | What it is |
|---|---|
| `6502-bench.html` | The application: layout, pin model, cycle engine and panels; loads the files in `src/` |
| `src/sym1.js`, `src/m6532.js`, `src/m6522.js` | The SYM-1, its 6532 RIOT and its 6522 VIAs |
| `tests/sym1-test.js` | The SYM-1 checks (`SYM_ROMS` set: with SUPERMON) |
| `src/m6502core.js` | CPU core: all 151 documented NMOS opcodes, cycle-by-cycle bus log, IRQ/NMI/reset sequences, NMOS decimal mode; disassembler |
| `src/m6502asm.js` | Two-pass assembler |
| `build.py` | Writes `6502-bench-standalone.html`, one file with everything inlined (`python build.py`) |
| `tests/functional-test.js` | Runs Klaus Dormann's 6502 functional test |
| `tests/singlestep-test.js` | Checks every documented opcode, cycle by cycle, against Tom Harte's SingleStepTests |
| `tests/asm-test.js` | Round-trips all 151 documented opcodes through the disassembler and assembler |

## Verification

- **Klaus Dormann's functional test** passes, decimal mode included: the success trap at 3469h is reached after 96,241,364 cycles, the published figure for this test.
- **SingleStepTests**: all 1,510,000 cases for the 151 documented opcodes match the real chip, including the address, data and read/write of every bus cycle and the NMOS decimal-mode flags.
- **Assembler**: all 151 documented opcodes assemble to the expected bytes.

## Running the tests

The tests need [Node.js](https://nodejs.org/). The test programs themselves are not included; get them from their own repositories:

```
node tests/asm-test.js
node tests/functional-test.js path/to/6502_functional_test.bin
node tests/singlestep-test.js path/to/65x02/6502/v1
```

- [Klaus2m5/6502_65C02_functional_tests](https://github.com/Klaus2m5/6502_65C02_functional_tests) (`bin_files/6502_functional_test.bin`)
- [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) (`6502/v1`)

## Known limitations

- Undocumented (illegal) opcodes are not emulated: the CPU stops ("jammed") and the disassembly shows `???`. Reset to recover.
- During clock stepping, registers and memory update together at the end of each instruction, not partway through it. Bus activity on the pins is exact for every cycle.
- RDY holds the read cycle in place, but the value read is the one present when the instruction started.
- Interrupts are taken at instruction boundaries. The rare hardware quirks (an NMI hijacking a BRK, the extra delay after a taken branch that doesn't cross a page) are not modelled.
- The 65C02 (CMOS) is not modelled yet.

## Licence

6502 Bench is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, copy, modify and share it for any noncommercial purpose, including personal projects, education and research. Commercial use needs separate permission from the copyright holder. See [NOTICE](NOTICE).
