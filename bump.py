"""Cache-busting: stamp ?v=<version> on every relative import and on the files index.html loads.

Run before each push (python bump.py), so browsers fetch the new files instead of their cached copies.
"""
import pathlib, re, time

root = pathlib.Path(__file__).parent
v = time.strftime('%Y%m%d%H%M')

# from './x.js' · from '../x.js?v=…' · import('./x.js')
imp = re.compile(r"""((?:from\s+|import\s*\(\s*)(['"])\.{1,2}/[^'"?]+\.js)(?:\?v=\w+)?(\2)""")
for f in (root / 'src').rglob('*.js'):
    s = f.read_bytes().decode('utf-8')
    t = imp.sub(lambda m: f'{m.group(1)}?v={v}{m.group(3)}', s)
    if t != s:
        f.write_bytes(t.encode('utf-8'))

idx = root / 'index.html'
s = idx.read_bytes().decode('utf-8')
s = re.sub(r'(src/(?:style\.css|main\.js))(?:\?v=\w+)?', rf'\1?v={v}', s)
idx.write_bytes(s.encode('utf-8'))
print('version', v)
