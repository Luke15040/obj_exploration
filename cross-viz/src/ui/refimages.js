/**
 * Reference images for the guided prompts: simple flat illustrations in the
 * page's greys (drawn here, so nothing is downloaded and nothing is copyrighted).
 * Each is an SVG string; `refImageURL(id)` turns it into an <img> src.
 */
const FROG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#dadadc"/>
  <ellipse cx="50" cy="86" rx="34" ry="5" fill="#c8c8cb"/>
  <path d="M20 80 q-7-18 11-24 l9 19 z" fill="#8f8f94"/>
  <path d="M80 80 q7-18 -11-24 l-9 19 z" fill="#8f8f94"/>
  <ellipse cx="50" cy="66" rx="25" ry="17" fill="#a7a7ac"/>
  <ellipse cx="50" cy="48" rx="21" ry="14" fill="#b6b6bb"/>
  <circle cx="37" cy="37" r="8" fill="#c9c9cd"/>
  <circle cx="63" cy="37" r="8" fill="#c9c9cd"/>
  <circle cx="37" cy="37" r="3.6" fill="#3d3d42"/>
  <circle cx="63" cy="37" r="3.6" fill="#3d3d42"/>
  <path d="M40 54 q10 6 20 0" stroke="#7d7d82" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M33 72 l-6 12 h11 z" fill="#9b9ba0"/>
  <path d="M67 72 l6 12 h-11 z" fill="#9b9ba0"/>
</svg>`;

const ROBOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#dadadc"/>
  <ellipse cx="50" cy="88" rx="38" ry="4.5" fill="#c8c8cb"/>
  <rect x="12" y="66" width="26" height="20" rx="9" fill="#7f7f84"/>
  <rect x="62" y="66" width="26" height="20" rx="9" fill="#7f7f84"/>
  <path d="M17 76 h16 M67 76 h16" stroke="#6a6a6f" stroke-width="1.4"/>
  <rect x="30" y="50" width="40" height="30" rx="2" fill="#b3b3b8"/>
  <rect x="36" y="56" width="15" height="9" fill="#9a9a9f"/>
  <circle cx="61" cy="61" r="3" fill="#9a9a9f"/>
  <rect x="21" y="58" width="10" height="5" rx="2" fill="#9a9a9f"/>
  <rect x="69" y="58" width="10" height="5" rx="2" fill="#9a9a9f"/>
  <rect x="47" y="36" width="6" height="15" fill="#9a9a9f"/>
  <rect x="30" y="22" width="18" height="14" rx="5" fill="#c4c4c8"/>
  <rect x="52" y="22" width="18" height="14" rx="5" fill="#c4c4c8"/>
  <circle cx="39" cy="29" r="4.6" fill="#3d3d42"/>
  <circle cx="61" cy="29" r="4.6" fill="#3d3d42"/>
  <circle cx="40.5" cy="27.5" r="1.2" fill="#d8d8db"/>
  <circle cx="62.5" cy="27.5" r="1.2" fill="#d8d8db"/>
</svg>`;

const IMAGES = { frog: FROG, walle: ROBOT };
export const REF_LABELS = { frog: 'tiny frog', walle: 'wall-e' };

// raster references provided by the designer take precedence over the drawings
const FILES = { frog: new URL('./ref-frog.png', import.meta.url).href };

export function refImageURL(id) {
  return FILES[id] ?? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(IMAGES[id]);
}
