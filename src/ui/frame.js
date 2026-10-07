import { view } from '../view.js?v=202610071423';

/**
 * The particles view's frame (ref: a framed dot grid): a box around the object,
 * its coordinates (y / x of the centre), two corner ticks, a crosshair at the centre
 * and two side guides. SVG over the canvas, redrawn every frame, only in that view.
 */
export function createFrame({ body }) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'ptframe';
  svg.classList.add('on');
  document.body.appendChild(svg);
  function draw() {
    const b = body.bounds?.();
    if (b && document.body.classList.contains('mode-particles')) {
      const [cx, cy] = view.project(b.c[0], b.c[1], b.c[2]);
      const h = b.r * view.scale * 0.78;
      const x0 = cx - h, x1 = cx + h, y0 = cy - h, y1 = cy + h;
      const ink = '#bdbbb6', soft = '#8a8883';
      svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
      svg.innerHTML = `
        <rect x="${x0}" y="${y0}" width="${2 * h}" height="${2 * h}" fill="none" stroke="${ink}" stroke-width="1"/>
        <path d="M${x1 - 18} ${y0 + 14}h6v-6 M${x0 + 18} ${y1 - 14}h-6v6" fill="none" stroke="${ink}" stroke-width="1"/>
        <path d="M${cx - 7} ${cy}h14M${cx} ${cy - 7}v14" stroke="${ink}" stroke-width="1"/>
        <path d="M${Math.max(0, x0 - 190)} ${cy}H${x0 - 90} M${x1 + 90} ${cy}H${x1 + 190}" stroke="${ink}" stroke-width="1"/>
        <text x="${x0 + 12}" y="${y0 + 22}" fill="${soft}" font-family="ui-monospace, monospace" font-size="11" font-style="italic">y ${b.c[1].toFixed(1)}</text>
        <text x="${x1 - 12}" y="${y1 - 14}" fill="${soft}" font-family="ui-monospace, monospace" font-size="11" font-style="italic" text-anchor="end">x ${b.c[0].toFixed(1)}</text>`;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
