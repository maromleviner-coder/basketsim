#!/usr/bin/env python3
"""Regenerates tests/sut.js by extracting testable pure functions from
stock_basket_simulator.html. Run this after modifying simulate() or its
helper functions, then re-run `node tests/test_suite.js`."""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(ROOT, 'stock_basket_simulator.html')

with open(HTML_PATH, encoding='utf-8') as f:
    html = f.read()

start = html.index('<script>', 440) + len('<script>')
end = html.index('</script>', start)
content = html[start:end]

def extract_fn(name):
    m = re.search(r'^function\s+' + name + r'\s*\(', content, re.MULTILINE)
    if not m:
        m = re.search(r'^const\s+' + name + r'\s*=', content, re.MULTILINE)
    start_i = m.start()
    depth = 0
    i = content.index('{', start_i)
    for j in range(i, len(content)):
        if content[j] == '{': depth += 1
        elif content[j] == '}':
            depth -= 1
            if depth == 0:
                return content[start_i:j+1]

fns = ['generateWeeks', 'utcDateStr', 'buildWindowIndex', 'buildPriceWindowIndex',
       'addDays', 'cleanDivs', 'mergeByDate', 'simulate', 'fmtReturn']

extracted = [extract_fn(fn) for fn in fns]
onliners = re.findall(r'^const (?:fmt|fmt2|fmtM)=.*$', content, re.MULTILINE)
extracted.extend(onliners)

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sut.js')
with open(out_path, 'w') as f:
    f.write("// Auto-extracted System Under Test functions — DO NOT EDIT BY HAND.\n")
    f.write("// Regenerate with: python3 tests/extract_sut.py\n\n")
    f.write('\n\n'.join(extracted))
    f.write("\n\nmodule.exports = {generateWeeks,utcDateStr,buildWindowIndex,buildPriceWindowIndex,addDays,cleanDivs,mergeByDate,simulate,fmtReturn,fmt,fmt2,fmtM};\n")

print(f"Wrote {out_path}")
