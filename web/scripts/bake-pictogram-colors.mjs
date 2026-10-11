/** Bake the rig's fill layers into the small PNGs, preserving source registration.
 * Rebuilds source crops first; Chromium is only an authoring tool, not runtime.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Always start from source crops, so running this command twice is safe.
execFileSync(process.env.DANCIFY_PIPELINE_PYTHON || fileURLToPath(new URL('../../pipeline/.venv/bin/python', import.meta.url)), [fileURLToPath(new URL('./build-pictograms.py', import.meta.url))]);
const base = new URL('../src/assets/pictograms/', import.meta.url);
const palette = JSON.parse(await readFile(new URL('../src/pictograms/palette.json', import.meta.url)));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage();
  for (const character of ['lenny', 'human']) {
    const manifest = JSON.parse(await readFile(new URL(`${character}/sprites.json`, base)));
    for (const id of Object.keys(manifest)) {
      const file = new URL(`${character}/${id}.png`, base);
      const png = (await readFile(file)).toString('base64');
      const output = await page.evaluate(async ({ png, character, id, colors }) => {
        const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width + 4; canvas.height = image.height + 4;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 2, 2);
        const { width: w, height: h } = canvas, original = ctx.getImageData(0, 0, w, h), n = w * h;
        const mask = new Uint8Array(n);
        for (let i = 0; i < n; i++) mask[i] = original.data[i * 4 + 3] >= 64 ? 1 : 0;
        const steps = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1];
        // Thin source strokes only to locate their open ends. Never redraw the ink.
        const thin = mask.slice();
        let changed = true;
        while (changed) {
          changed = false;
          for (let pass = 0; pass < 2; pass++) {
            const remove = [];
            for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
              const i = y * w + x; if (!thin[i]) continue;
              const p = steps.map(d => thin[i + d]), count = p.reduce((a, b) => a + b, 0);
              if (count < 2 || count > 6 || p.filter((v, j) => !v && p[(j + 1) % 8]).length !== 1) continue;
              if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
              remove.push(i);
            }
            for (const i of remove) thin[i] = 0;
            changed ||= remove.length > 0;
          }
        }
        const seen = new Uint8Array(n), ends = [];
        for (let i = 0; i < n; i++) if (thin[i] && !seen[i]) {
          const queue = [i], component = [], tips = []; seen[i] = 1;
          for (let k = 0; k < queue.length; k++) {
            const j = queue[k]; component.push(j);
            if (steps.filter(d => thin[j + d]).length === 1) tips.push(j);
            for (const d of steps) if (thin[j + d] && !seen[j + d]) { seen[j + d] = 1; queue.push(j + d); }
          }
          const xs = component.map(p => p % w), ys = component.map(p => Math.floor(p / w));
          // Exclude facial features, chest star and internal spiral decorations.
          if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= Math.max(w, h) * .3)
            ends.push(...tips.map(index => ({ index, group: i })));
        }
        // Join nearest open ends of different contour pieces, then close the loop.
        // These closures are invisible fill boundaries at the rig's joint seams.
        // Thick hand-drawn corners can leave short skeleton spurs. For a single
        // open contour, close its two outermost tips rather than each spur.
        if (ends.length > 2 && ends.every(e => e.group === ends[0].group)) {
          let pair = [ends[0], ends[1]], distance = -1;
          for (const a of ends) for (const b of ends) {
            const d = Math.hypot(a.index % w - b.index % w, Math.floor(a.index / w) - Math.floor(b.index / w));
            if (d > distance) { distance = d; pair = [a, b]; }
          }
          ends.splice(0, ends.length, ...pair);
        }
        const closed = mask.slice();
        while (ends.length >= 2) {
          let pair = null, best = Infinity;
          for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
            if (ends.length > 2 && ends[a].group === ends[b].group) continue;
            const pa = ends[a].index, pb = ends[b].index;
            const distance = Math.hypot(pa % w - pb % w, Math.floor(pa / w) - Math.floor(pb / w));
            if (distance < best) { best = distance; pair = [a, b]; }
          }
          if (!pair) break;
          const [a, b] = pair, pa = ends[a].index, pb = ends[b].index;
          const ax = pa % w, ay = Math.floor(pa / w), bx = pb % w, by = Math.floor(pb / w);
          for (let k = 0; k <= Math.ceil(best * 2); k++) {
            const t = k / Math.max(1, Math.ceil(best * 2));
            closed[Math.round(ay + (by - ay) * t) * w + Math.round(ax + (bx - ax) * t)] = 1;
          }
          const oldGroup = ends[b].group, group = ends[a].group;
          ends.forEach(e => { if (e.group === oldGroup) e.group = group; });
          ends.splice(b, 1); ends.splice(a, 1);
        }
        const outside = new Uint8Array(n), flood = [0]; outside[0] = 1;
        for (let k = 0; k < flood.length; k++) {
          const i = flood[k], x = i % w, y = Math.floor(i / w);
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
            if (j >= 0 && !closed[j] && !outside[j]) { outside[j] = 1; flood.push(j); }
        }
        const regions = [], visited = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (!closed[i] && !outside[i] && !visited[i]) {
          const q = [i]; visited[i] = 1;
          for (let k = 0; k < q.length; k++) for (const j of [q[k] - 1, q[k] + 1, q[k] - w, q[k] + w])
            if (!closed[j] && !outside[j] && !visited[j]) { visited[j] = 1; q.push(j); }
          regions.push(q);
        }
        const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16));
        const out = ctx.createImageData(w, h);
        const paint = (i, hex, alpha = 255) => { out.data.set([...rgb(hex), alpha], i * 4); };
        for (const region of regions) {
          const cx = region.reduce((s, i) => s + i % w, 0) / region.length / w;
          const cy = region.reduce((s, i) => s + Math.floor(i / w), 0) / region.length / h;
          let color = colors.base;
          if (character === 'lenny') {
            if (id === 'body' && cx > .25 && cx < .75) color = colors.cream;
            if (id === 'head' && cy < .43 && region.length < n * .2) color = colors.cream;
            if (id === 'head' && cy >= .43 && cy < .78 && region.length < n * .015) color = colors.eye;
          }
          for (const i of region) paint(i, color === colors.base && i % w > w * .78 ? colors.shade : color);
        }
        // Include seam fill pixels without adding a new outline across an articulation.
        for (let i = 0; i < n; i++) if (closed[i] && !mask[i]) paint(i, colors.base);
        for (let i = 0; i < n; i++) {
          const alpha = original.data[i * 4 + 3]; if (!alpha) continue;
          if (character === 'human' && id.endsWith('Foot')) {
            const interior = [-2, 2, -2*w, 2*w].every(d => mask[i + d]);
            paint(i, interior ? colors.base : colors.outline, alpha);
          } else if (character === 'human' && id === 'body' && original.data[i*4] > 180 && original.data[i*4+1] > 120 && original.data[i*4+2] < 100) {
            out.data.set(original.data.slice(i*4, i*4+4), i*4);
          } else {
            const ink = rgb(colors.outline), a = alpha / 255;
            const fillAlpha = out.data[i*4+3] / 255, resultAlpha = a + fillAlpha * (1-a);
            for (let c=0;c<3;c++) out.data[i*4+c] = (ink[c]*a + out.data[i*4+c]*fillAlpha*(1-a)) / resultAlpha;
            out.data[i*4+3] = resultAlpha * 255;
          }
        }
        ctx.putImageData(out, 0, 0);
        const result = document.createElement('canvas'); result.width = image.width; result.height = image.height;
        result.getContext('2d').drawImage(canvas, -2, -2);
        return result.toDataURL('image/png').split(',')[1];
      }, { png, character, id, colors: palette[character] });
      await writeFile(file, Buffer.from(output, 'base64'));
    }
    console.log(`Baked ${character}: ${Object.keys(manifest).length} registered sprites.`);
  }
} finally { await browser.close(); }
