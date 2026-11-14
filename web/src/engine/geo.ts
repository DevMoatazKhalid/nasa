// Geodesy helpers on the Mars sphere (IAU 2000 mean radius).
export const R_KM = 3389.5;
const D2R = Math.PI / 180;

export const wrapLon = (lon: number) => ((lon % 360) + 360) % 360;

/** Great-circle distance in km. Longitudes east-positive, any range. */
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (deg from north, clockwise). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

export function fmtLat(lat: number) { return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`; }
export function fmtLon(lon: number) { return `${wrapLon(lon).toFixed(3)}°E`; }
export function fmtCoord(lat: number, lon: number) { return `${fmtLat(lat)}, ${fmtLon(lon)}`; }

/** Round to a number of significant figures appropriate to the stated uncertainty. */
export function sig(v: number, digits = 2): string {
  if (!isFinite(v)) return '—';
  if (v === 0) return '0';
  const m = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(v))));
  return String(Math.round(v * m) / m);
}

/** Parse "18.4N 77.5E", "-4.6, 137.4", "18.4, -282.5" etc. Returns null when not understood. */
export function parseCoord(s: string): { lat: number; lon: number } | null {
  const t = s.trim().toUpperCase().replace(/°/g, ' ');
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*([EW])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]); let lon = parseFloat(m[3]);
  if (m[2] === 'S') lat = -Math.abs(lat);
  if (m[4] === 'W') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon: wrapLon(lon) };
}
