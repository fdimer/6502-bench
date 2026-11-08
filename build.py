# Builds 6502-bench-standalone.html: one self-contained file with the CPU core and
# assembler inlined (handy for emailing or opening without the src/ folder).
# Usage: python build.py
import pathlib
here = pathlib.Path(__file__).parent
page = (here / '6502-bench.html').read_text(encoding='utf-8')
for name in ('m6502core.js', 'm6502asm.js'):
    tag = f'<script src="src/{name}"></script>'
    assert tag in page, tag
    page = page.replace(tag, '<script>\n' + (here / 'src' / name).read_text(encoding='utf-8') + '</script>')
(here / '6502-bench-standalone.html').write_text(page, encoding='utf-8')
print('wrote 6502-bench-standalone.html,', len(page), 'bytes')
