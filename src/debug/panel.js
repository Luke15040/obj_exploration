import { state, params, setBody, setLinked, reset, snapshot, onChange } from '../state.js?v=202610071442';

/**
 * Tuning panel, hidden by default, toggled with the `d` key.
 * Each control writes straight into `params` / `state.body`; the body layer
 * eases toward the new values on its own.
 */
export function createDebugPanel({ orbit } = {}) {
  const root = document.createElement('div');
  root.id = 'debug';
  document.body.appendChild(root);

  // split-compare overlay labels
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="split-line"></div><div class="split-label left">bayer</div><div class="split-label right">blue noise</div>',
  );

  root.innerHTML = '<h2>body tuning <span>[d] to hide</span></h2>';

  const slider = (label, min, max, step, get, set, fmt = (v) => v) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}<output></output></label><input type="range" min="${min}" max="${max}" step="${step}">`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.value = get();
    out.textContent = fmt(get());
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      out.textContent = fmt(parseFloat(input.value));
    });
    root.appendChild(row);
  };

  const check = (label, get, set) => {
    const row = document.createElement('label');
    row.className = 'check';
    row.innerHTML = `<input type="checkbox"> ${label}`;
    const input = row.querySelector('input');
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    root.appendChild(row);
    return input;
  };

  // --- dots ---
  const styleRow = document.createElement('div');
  styleRow.className = 'row';
  styleRow.innerHTML = `<label>dot style</label>
    <select>
      <option value="cloud">point cloud on the surface</option>
      <option value="grid">screen grid dithering (old)</option>
    </select>`;
  const styleSelect = styleRow.querySelector('select');
  styleSelect.value = params.dotStyle;
  styleSelect.addEventListener('change', () => (params.dotStyle = styleSelect.value));
  root.appendChild(styleRow);

  const methodRow = document.createElement('div');
  methodRow.className = 'row';
  methodRow.innerHTML = `<label>dither method (grid)</label>
    <select>
      <option value="bayer">ordered (bayer 8×8)</option>
      <option value="blue">blue noise (void & cluster)</option>
      <option value="split">compare: bayer | blue noise</option>
    </select>`;
  const select = methodRow.querySelector('select');
  select.value = params.method;
  const applyMethod = () => {
    params.method = select.value;
    document.body.classList.toggle('split', params.method === 'split');
  };
  select.addEventListener('change', applyMethod);
  root.appendChild(methodRow);

  slider('dot pitch', 1.5, 10, 0.1, () => params.pitch, (v) => (params.pitch = v), (v) => v + 'mm');
  slider('dot size', 0.2, 1, 0.01, () => params.dotSize, (v) => (params.dotSize = v), (v) => v.toFixed(2));
  slider('size follows light', 0, 1, 0.01, () => params.sizeByLight, (v) => (params.sizeByLight = v), (v) => v.toFixed(2));
  slider('exposure', 0.3, 1.8, 0.01, () => params.exposure, (v) => (params.exposure = v), (v) => v.toFixed(2));
  check('edge rings (third level)', () => params.rings, (v) => (params.rings = v));
  slider('ring amount', 0, 1.5, 0.01, () => params.ringAmount, (v) => (params.ringAmount = v), (v) => v.toFixed(2));

  root.appendChild(document.createElement('hr'));

  // --- shape ---
  slider('blend radius', 0, 40, 0.5, () => state.body.blend, (v) => setBody('blend', v), (v) => v + 'mm');
  slider('body padding', -4, 16, 0.5, () => state.body.padding, (v) => setBody('padding', v), (v) => v + 'mm');
  slider('edge softness (halo)', 0.5, 16, 0.5, () => params.softness, (v) => (params.softness = v), (v) => v + 'mm');

  root.appendChild(document.createElement('hr'));

  // --- life / response ---
  slider('clustering', 0, 1.2, 0.01, () => params.cluster, (v) => (params.cluster = v), (v) => v.toFixed(2));
  slider('drift speed', 0, 2, 0.01, () => params.drift, (v) => (params.drift = v), (v) => v.toFixed(2));
  slider('edge breathing', 0, 5, 0.1, () => params.breathe, (v) => (params.breathe = v), (v) => v + 'mm');
  slider('body response', 0.5, 8, 0.1, () => params.response, (v) => (params.response = v), (v) => v + 'hz');
  slider('wobble (damping)', 0.25, 1, 0.01, () => params.wobble, (v) => (params.wobble = v), (v) => v.toFixed(2));
  slider('dot fade speed', 2, 40, 1, () => params.dotSpeed, (v) => (params.dotSpeed = v), (v) => v + '/s');
  slider('cursor reach', 0, 20, 0.5, () => params.reach, (v) => (params.reach = v), (v) => v + 'mm');


  root.appendChild(document.createElement('hr'));

  // --- components ---
  const linkInput = check('symmetric wheels', () => state.wheels.linked, (v) => setLinked(v));
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const button = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    buttons.appendChild(b);
  };
  button('reset pose', reset);
  button('front', () => orbit?.setView('front'));
  button('3/4', () => orbit?.setView('3/4'));
  root.appendChild(buttons);

  // live readout of what FluentCAD would receive
  const pre = document.createElement('pre');
  root.appendChild(pre);
  const showState = () => {
    const s = snapshot();
    const f = (p) => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
    pre.textContent =
      `wheel l   ${f(s.wheels.left)}\n` +
      `wheel r   ${f(s.wheels.right)}\n` +
      `screen    ${f(s.screen)}\n` +
      `add-ons   ${s.extras.map((e) => e.type).join(', ') || '—'}\n` +
      `(mm, centres)`;
    linkInput.checked = state.wheels.linked;
  };
  onChange(showState);
  showState();

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'd' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    root.classList.toggle('open');
  });

  applyMethod();
}
