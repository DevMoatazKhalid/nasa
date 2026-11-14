// Mars map: simple-cylindrical (planetocentric, east-positive) canvas viewer with wrap-around.
import React, { useEffect, useRef, useState } from 'react';
import { DataStore, Grid, LayerMeta } from '../engine/data';
import { Engine } from '../engine/query';
import { ramp, cat } from './colors';
import { wrapLon, fmtCoord } from '../engine/geo';

export interface MapMarker { lat: number; lon: number; kind: 'select' | 'start' | 'end' | 'wp' | 'cand' | 'img'; label?: string; color?: string; }
export interface MapLine { pts: [number, number][]; color: string; width: number; dash?: number[]; }
export interface Overlay { id: string; opacity: number; }
interface View { lon: number; lat: number; ppd: number; } // centre + pixels per degree

const overlayCache = new Map<string, HTMLCanvasElement>();

async function renderOverlay(ds: DataStore, L: LayerMeta): Promise<HTMLCanvasElement> {
  const key = L.id; if (overlayCache.has(key)) return overlayCache.get(key)!;
  const g: Grid = await ds.grid(L.id);
  const cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h;
  const ctx = cv.getContext('2d')!, img = ctx.createImageData(g.w, g.h);
  const lo = L.legend.min ?? 0, hi = L.legend.max ?? 1;
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    const v = g.cell(r, c), o = (r * g.w + c) * 4;
    if (Number.isNaN(v)) { img.data[o + 3] = 0; continue; }
    const col = L.legend.ramp === 'cat' ? cat(v) : ramp(L.legend.ramp, (v - lo) / (hi - lo));
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); overlayCache.set(key, cv); return cv;
}

export function MapView(props: {
  ds: DataStore; eng: Engine; overlays: Overlay[]; markers: MapMarker[]; lines: MapLine[];
  showCraters: boolean; showNames: boolean; showRovers: boolean; showImages: boolean; focus?: { lat: number; lon: number; ppd?: number; t: number } | null;
  onPick: (lat: number, lon: number) => void; circles?: { lat: number; lon: number; km: number; color: string }[];
}) {
  const ref = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ lon: 180, lat: 0, ppd: 2.4 });
  const [hover, setHover] = useState<{ lat: number; lon: number; z: number | null } | null>(null);
  const base = useRef<HTMLImageElement | null>(null);
  const ovs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [tick, setTick] = useState(0);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const dem = useRef<Grid | null>(null);

  useEffect(() => { const im = new Image(); im.onload = () => { base.current = im; setTick(t => t + 1); }; im.src = props.ds.base + 'basemap_8ppd.jpg';
    props.ds.grid('dem').then(g => { dem.current = g; }); }, []);
  useEffect(() => { let alive = true;
    for (const o of props.overlays) if (!ovs.current.has(o.id)) { const L = props.ds.layer(o.id); if (L?.grid) renderOverlay(props.ds, L).then(cv => { if (alive) { ovs.current.set(o.id, cv); setTick(t => t + 1); } }); }
    return () => { alive = false; }; }, [props.overlays.map(o => o.id).join()]);
  useEffect(() => { if (props.focus) setView(v => ({ lon: props.focus!.lon, lat: props.focus!.lat, ppd: props.focus!.ppd ?? Math.max(v.ppd, 14) })); }, [props.focus?.t]);
  useEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setTick(t => t + 1)); ro.observe(el); return () => ro.disconnect(); }, []);

  const clampLat = (lat: number, ppd: number) => { const h = (wrap.current?.clientHeight || 600) / 2 / ppd; return h >= 90 ? 0 : Math.max(-90 + h, Math.min(90 - h, lat)); };
  useEffect(() => { const c = clampLat(view.lat, view.ppd); if (Math.abs(c - view.lat) > 1e-6) setView(v => ({ ...v, lat: c })); }, [view.lat, view.ppd, tick]);
  const toScreen = (lat: number, lon: number, W: number, H: number, off = 0): [number, number] => {
    let dl = wrapLon(lon) - view.lon + off; if (off === 0) { if (dl > 180) dl -= 360; if (dl < -180) dl += 360; }
    return [W / 2 + dl * view.ppd, H / 2 - (lat - view.lat) * view.ppd];
  };
  const toGeo = (x: number, y: number, W: number, H: number) => ({ lat: Math.max(-90, Math.min(90, view.lat - (y - H / 2) / view.ppd)), lon: wrapLon(view.lon + (x - W / 2) / view.ppd) });

  useEffect(() => {
    const cv = ref.current!, el = wrap.current!; const dpr = window.devicePixelRatio || 1;
    const W = el.clientWidth, H = el.clientHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, W, H);
    const x0 = W / 2 - view.lon * view.ppd, y0 = H / 2 - (90 - view.lat) * view.ppd, ww = 360 * view.ppd, hh = 180 * view.ppd;
    const copies = [-1, 0, 1, 2].map(k => x0 + k * ww).filter(x => x < W && x + ww > 0);
    ctx.imageSmoothingEnabled = view.ppd < 8;
    if (base.current) for (const x of copies) ctx.drawImage(base.current, x, y0, ww, hh);
    for (const o of props.overlays) { const ov = ovs.current.get(o.id); if (!ov) continue; ctx.globalAlpha = o.opacity; ctx.imageSmoothingEnabled = false;
      for (const x of copies) ctx.drawImage(ov, x, y0, ww, hh); ctx.globalAlpha = 1; }
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(232,225,214,0.55)'; ctx.font = '11px "IBM Plex Sans", sans-serif';
    const step = view.ppd > 20 ? 5 : view.ppd > 6 ? 10 : 30;
    for (const x of copies) for (let lo = 0; lo < 360; lo += step) { const X = x + lo * view.ppd; ctx.beginPath(); ctx.moveTo(X, Math.max(0, y0)); ctx.lineTo(X, Math.min(H, y0 + hh)); ctx.stroke(); if (X > 4 && X < W - 30) ctx.fillText(`${lo}°E`, X + 3, H - 8); }
    for (let la = -90 + step; la < 90; la += step) { const Y = y0 + (90 - la) * view.ppd; ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(W, Y); ctx.stroke(); if (Y > 12 && Y < H - 20) ctx.fillText(`${Math.abs(la)}°${la >= 0 ? 'N' : 'S'}`, 4, Y - 3); }
    // rover tracks
    if (props.showRovers && props.eng.rovers) for (const [name, rv] of Object.entries<any>(props.eng.rovers)) { if (name === 'images') continue;
      ctx.strokeStyle = name === 'perseverance' ? '#7fd3ff' : '#ffd27f'; ctx.lineWidth = 2; ctx.beginPath(); let first = true;
      for (const [lo, la] of rv.track) { const [X, Y] = toScreen(la, lo, W, H); if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y); } ctx.stroke();
      const [X, Y] = toScreen(rv.last.lat, rv.last.lon, W, H); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(X, Y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#f2ece4'; ctx.fillText(`${name === 'perseverance' ? 'Perseverance' : 'Curiosity'} · sol ${rv.last.sol}`, X + 8, Y - 6); }
    if (props.showImages && props.eng.rovers?.images) { ctx.fillStyle = '#e8b04a'; for (const im of props.eng.rovers.images) { const [X, Y] = toScreen(im.rover_lat, im.rover_lon, W, H); ctx.fillRect(X - 2, Y - 2, 4, 4); } }
    // craters
    if (props.showCraters && props.eng.craters && view.ppd > 3) { ctx.strokeStyle = 'rgba(255,230,200,0.5)'; ctx.lineWidth = 1;
      const minD = Math.max(1, 6 / (view.ppd / 59.16)); let n = 0;
      const vis = toGeo(0, 0, W, H), vis2 = toGeo(W, H, W, H);
      for (const c of props.eng.craters) { if (c.d < minD) break; if (c.lat > vis.lat + 5 || c.lat < vis2.lat - 5) continue;
        const [X, Y] = toScreen(c.lat, c.lon, W, H); if (X < -50 || X > W + 50) continue;
        const r = (c.d / 2 / 59.16) * view.ppd; ctx.beginPath(); ctx.ellipse(X, Y, r / Math.max(0.05, Math.cos(c.lat * Math.PI / 180)), r, 0, 0, 7); ctx.stroke(); if (++n > 4000) break; } }
    // circles (regions)
    for (const c of props.circles || []) { const [X, Y] = toScreen(c.lat, c.lon, W, H); const r = (c.km / 59.16) * view.ppd; ctx.strokeStyle = c.color; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.ellipse(X, Y, r / Math.max(0.05, Math.cos(c.lat * Math.PI / 180)), r, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    // lines (routes)
    for (const l of props.lines) { ctx.strokeStyle = l.color; ctx.lineWidth = l.width; ctx.setLineDash(l.dash || []); ctx.beginPath();
      let px: number | null = null; for (const [la, lo] of l.pts) { const [X, Y] = toScreen(la, lo, W, H); if (px === null || Math.abs(X - px) > W / 2) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); px = X; } ctx.stroke(); ctx.setLineDash([]); }
    // names
    if (props.showNames && props.eng.places) { ctx.font = '12px "IBM Plex Sans", "IBM Plex Sans Arabic", sans-serif'; const boxes: number[][] = [];
      const minDiam = 1200 / view.ppd;
      for (const p of props.eng.places) { if (p.diameter < minDiam) break; const [X, Y] = toScreen(p.lat, p.lon, W, H); if (X < 0 || X > W || Y < 0 || Y > H) continue;
        const tw = ctx.measureText(p.name).width, bx = [X - tw / 2 - 4, Y - 10, X + tw / 2 + 4, Y + 8];
        if (boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue; boxes.push(bx);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(X - tw / 2 - 3, Y - 9, tw + 6, 16);
        ctx.fillStyle = '#efe6d8'; ctx.fillText(p.name, X - tw / 2, Y + 3); if (boxes.length > 120) break; } }
    // markers
    for (const m of props.markers) { const [X, Y] = toScreen(m.lat, m.lon, W, H);
      const col = m.color || ({ select: '#ff7a3d', start: '#5fd38d', end: '#ff5d5d', wp: '#f2c94c', cand: '#ff9f5a', img: '#e8b04a' } as any)[m.kind];
      ctx.lineWidth = 2; ctx.strokeStyle = '#0b0d12'; ctx.fillStyle = col;
      if (m.kind === 'select') { ctx.beginPath(); ctx.arc(X, Y, 9, 0, 7); ctx.strokeStyle = col; ctx.stroke(); ctx.beginPath(); ctx.moveTo(X - 14, Y); ctx.lineTo(X + 14, Y); ctx.moveTo(X, Y - 14); ctx.lineTo(X, Y + 14); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(X, Y, m.kind === 'cand' ? 8 : 6, 0, 7); ctx.fill(); ctx.stroke(); }
      if (m.label) { ctx.font = '600 12px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#0b0d12'; const tw = ctx.measureText(m.label).width;
        ctx.fillStyle = col; ctx.fillRect(X + 10, Y - 9, tw + 8, 18); ctx.fillStyle = '#0b0d12'; ctx.fillText(m.label, X + 14, Y + 4); } }
    // scale bar
    const kmPerPx = 59.16 / view.ppd * Math.cos(view.lat * Math.PI / 180); const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
    const km = nice.find(k => k / kmPerPx > 80) || 2000; const px = km / kmPerPx;
    ctx.fillStyle = 'rgba(7,9,13,0.7)'; ctx.fillRect(W - px - 34, H - 34, px + 24, 24); ctx.strokeStyle = '#efe6d8'; ctx.beginPath(); ctx.moveTo(W - px - 22, H - 16); ctx.lineTo(W - 22, H - 16); ctx.stroke();
    ctx.fillStyle = '#efe6d8'; ctx.fillText(`${km} km`, W - px - 22, H - 20);
  }, [view, tick, props.overlays, props.markers, props.lines, props.showCraters, props.showNames, props.showRovers, props.showImages, props.circles]);

  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect(); const g = toGeo(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    setHover({ ...g, z: dem.current ? dem.current.at(g.lat, g.lon) : null });
    const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView({ ...d.v, lon: wrapLon(d.v.lon - dx / d.v.ppd), lat: Math.max(-85, Math.min(85, d.v.lat + dy / d.v.ppd)) });
  };
  const onUp = (e: React.PointerEvent) => { const d = drag.current; drag.current = null;
    if (d && !d.moved) { const rect = ref.current!.getBoundingClientRect(); const g = toGeo(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height); props.onPick(g.lat, g.lon); } };
  const zoom = (f: number, cx?: number, cy?: number) => setView(v => {
    const rect = ref.current!.getBoundingClientRect(); const W = rect.width, H = rect.height; const x = cx ?? W / 2, y = cy ?? H / 2;
    const g = toGeo(x, y, W, H); const ppd = Math.max(1.2, Math.min(160, v.ppd * f));
    return { ppd, lon: wrapLon(g.lon - (x - W / 2) / ppd), lat: Math.max(-85, Math.min(85, g.lat + (y - H / 2) / ppd)) }; });
  useEffect(() => { const cv = ref.current!; const h = (e: WheelEvent) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); };
    cv.addEventListener('wheel', h, { passive: false }); return () => cv.removeEventListener('wheel', h); });

  return (
    <div className="map" ref={wrap}>
      <canvas ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} aria-label="Mars map. Click to select a location." role="img" />
      <div className="map-zoom"><button onClick={() => zoom(1.5)} aria-label="Zoom in">+</button><button onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ lon: 180, lat: 0, ppd: 2.4 })} aria-label="Reset view">⟲</button></div>
      <div className="map-readout">{hover ? <>{fmtCoord(hover.lat, hover.lon)}{hover.z !== null && !Number.isNaN(hover.z) ? ` · ${Math.round(hover.z)} m` : ''}</> : 'MOLA areoid · planetocentric · 0–360°E'}</div>
    </div>
  );
}
