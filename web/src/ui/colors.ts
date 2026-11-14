// Colour ramps for scientific overlays (perceptually ordered; categorical for geology).
type Stop = [number, [number, number, number]];
const RAMPS: Record<string, Stop[]> = {
  elev: [[0, [38, 52, 92]], [0.25, [70, 110, 140]], [0.45, [150, 140, 100]], [0.6, [196, 140, 80]], [0.8, [220, 190, 150]], [1, [250, 246, 240]]],
  hazard: [[0, [30, 60, 50]], [0.3, [110, 150, 70]], [0.55, [230, 200, 70]], [0.8, [230, 110, 50]], [1, [180, 30, 40]]],
  seq: [[0, [20, 20, 60]], [0.3, [50, 90, 160]], [0.55, [40, 160, 160]], [0.8, [170, 210, 90]], [1, [250, 240, 110]]],
  seq_r: [[0, [250, 240, 110]], [0.2, [170, 210, 90]], [0.45, [40, 160, 160]], [0.7, [50, 90, 160]], [1, [20, 20, 60]]],
  div: [[0, [140, 80, 40]], [0.35, [200, 160, 120]], [0.5, [235, 235, 230]], [0.65, [140, 200, 230]], [1, [20, 90, 200]]],
  grey: [[0, [20, 20, 20]], [1, [245, 245, 245]]],
};
export function ramp(name: string, t: number): [number, number, number] {
  const s = RAMPS[name] || RAMPS.seq; t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < s.length; i++) if (t <= s[i][0]) {
    const [a, ca] = s[i - 1], [b, cb] = s[i], f = (t - a) / (b - a || 1);
    return [0, 1, 2].map(k => Math.round(ca[k] + (cb[k] - ca[k]) * f)) as [number, number, number];
  }
  return s[s.length - 1][1];
}
export function cssGradient(name: string) {
  const s = RAMPS[name] || RAMPS.seq; return `linear-gradient(90deg, ${s.map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(',')})`;
}
// Stable categorical palette (geology): golden-angle hues, muted.
export function cat(i: number): [number, number, number] {
  const h = (i * 137.508) % 360, s = 0.45, l = 0.52;
  const f = (n: number) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
export const STATUS_COLOR: Record<string, string> = {
  measured: '#4fb3a9', published: '#6f9fd8', derived: '#b39ddb', modeled: '#e0a458', inferred: '#d98b8b', synthetic: '#e05b9b', unavailable: '#6b6f78',
};
