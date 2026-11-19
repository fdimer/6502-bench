# Builds 6502-bench-standalone.html: one self-contained file with every script in src/ that the page loads inlined
# (handy for emailing, for opening without the src/ folder, and for the website's copy).
# Usage: python build.py
import pathlib, re
here = pathlib.Path(__file__).parent
page = (here / '6502-bench.html').read_text(encoding='utf-8')
names = re.findall(r'<script src="src/([\w.]+)"></script>', page)
assert 'm6502core.js' in names, names
for name in names:
    page = page.replace(f'<script src="src/{name}"></script>', '<script>\n' + (here / 'src' / name).read_text(encoding='utf-8') + '</script>')
(here / '6502-bench-standalone.html').write_text(page, encoding='utf-8')
print('wrote 6502-bench-standalone.html,', len(page), 'bytes, with', ', '.join(names))
