import React, { createContext, useContext, useEffect, useRef } from 'react';
import { DICT, Key, Lang } from '../i18n';
import { LayerMeta, Status } from '../engine/data';
import { STATUS_COLOR, cssGradient } from './colors';
import { sig } from '../engine/geo';

export const LangCtx = createContext<Lang>('en');
export function useT() { const l = useContext(LangCtx); return (k: Key) => DICT[l][k] ?? DICT.en[k] ?? k; }
export function useLang() { return useContext(LangCtx); }

export function Badge({ s }: { s: Status }) {
  const t = useT();
  return <span className="badge" style={{ ['--c' as any]: STATUS_COLOR[s] }}>{t(('st_' + s) as Key)}</span>;
}

export function Row(p: { label: string; value: React.ReactNode; units?: string; status?: Status; note?: string; onInfo?: () => void }) {
  return <div className="row">
    <div className="row-l">{p.label}{p.onInfo && <button className="info" onClick={p.onInfo} aria-label="Source and method">i</button>}</div>
    <div className="row-v"><span className="num">{p.value}</span>{p.units && <span className="u"> {p.units}</span>}{p.status && <Badge s={p.status} />}</div>
    {p.note && <div className="row-n">{p.note}</div>}
  </div>;
}

export function Section(p: { title: string; children: React.ReactNode; open?: boolean }) {
  return <details className="sec" open={p.open ?? true}><summary>{p.title}</summary><div className="sec-b">{p.children}</div></details>;
}

export function Modal(p: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose(); addEventListener('keydown', h); ref.current?.focus(); return () => removeEventListener('keydown', h); }, []);
  return <div className="modal-bg" onClick={p.onClose}><div className="modal" role="dialog" aria-modal="true" aria-label={p.title} tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}>
    <div className="modal-h"><h3>{p.title}</h3><button onClick={p.onClose}>{t('close')}</button></div><div className="modal-b">{p.children}</div></div></div>;
}

export function LayerInfo({ L, onClose }: { L: LayerMeta; onClose: () => void }) {
  const t = useT(); const lang = useLang();
  const src = L.source || {};
  return <Modal title={lang === 'ar' ? L.name_ar : L.name} onClose={onClose}>
    <p><Badge s={L.status} /> <span className="muted">{t('confidence')}: {L.confidence}</span></p>
    <dl className="dl">
      <dt>{t('source')}</dt><dd>{src.org}{src.product ? <><br /><span className="muted">{src.product}</span></> : null}{src.instrument ? <><br /><span className="muted">{src.instrument}</span></> : null}
        {src.url ? <><br /><a href={src.url} target="_blank" rel="noreferrer">{src.url}</a></> : null}{src.doi ? <><br />DOI: {src.doi}</> : null}{src.acquired ? <><br />{src.acquired}</> : null}</dd>
      <dt>{t('coverage')}</dt><dd>{L.coverage}</dd>
      <dt>{t('resolution')}</dt><dd>~{L.resolution_km} km{L.grid ? ` (${L.grid.ppd} px/deg, ${L.grid.width}×${L.grid.height})` : ''}</dd>
      <dt>{t('temporal')}</dt><dd>{L.temporal}</dd>
      <dt>{t('units')}</dt><dd>{L.units}</dd>
      <dt>CRS</dt><dd>{L.crs}</dd>
      <dt>{t('processing')}</dt><dd>{L.processing}</dd>
      <dt>{t('limitations')}</dt><dd>{L.limitations}</dd>
    </dl>
    {L.legend.ramp !== 'cat' && L.legend.min !== undefined && <div className="legend"><div className="bar" style={{ background: cssGradient(L.legend.ramp) }} />
      <div className="lg-t"><span>{sig(L.legend.min!, 3)}</span><span>{L.units}</span><span>{sig(L.legend.max!, 3)}</span></div></div>}
  </Modal>;
}

/** Elevation + slope profile drawn at real pixel size. */
export function ProfileChart({ cum, elev, slope, maxSlope }: { cum: number[]; elev: number[]; slope: number[]; maxSlope: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const s = ref.current!; const draw = () => {
      const W = s.clientWidth, H = s.clientHeight, pl = 46, pr = 40, pt = 10, pb = 22; if (!cum.length) return;
      const X = (d: number) => pl + (d / cum[cum.length - 1]) * (W - pl - pr);
      const zmin = Math.min(...elev), zmax = Math.max(...elev), zr = Math.max(50, zmax - zmin);
      const Y = (z: number) => pt + (1 - (z - zmin) / zr) * (H - pt - pb);
      const Ys = (v: number) => pt + (1 - v / Math.max(maxSlope, 1)) * (H - pt - pb);
      const pe = elev.map((z, i) => `${i ? 'L' : 'M'}${X(cum[i]).toFixed(1)},${Y(z).toFixed(1)}`).join('');
      const ps = slope.map((v, i) => `${i ? 'L' : 'M'}${X(cum[i]).toFixed(1)},${Ys(v).toFixed(1)}`).join('');
      const small = W < 420;
      s.innerHTML = `<path d="${pe}L${X(cum[cum.length - 1])},${H - pb}L${pl},${H - pb}Z" fill="rgba(210,120,60,0.18)"/>
        <path d="${pe}" fill="none" stroke="#e08a4f" stroke-width="2"/><path d="${ps}" fill="none" stroke="#9ec7f0" stroke-width="1.2" opacity="0.9"/>
        <text x="4" y="${pt + 8}" class="ax">${Math.round(zmax)} m</text><text x="4" y="${H - pb}" class="ax">${Math.round(zmin)} m</text>
        <text x="${W - pr + 4}" y="${pt + 8}" class="ax" fill="#9ec7f0">${maxSlope.toFixed(0)}°</text><text x="${W - pr + 4}" y="${H - pb}" class="ax" fill="#9ec7f0">0°</text>
        ${small ? '' : `<text x="${pl}" y="${H - 6}" class="ax">0 km</text>`}<text x="${W - pr - 60}" y="${H - 6}" class="ax">${Math.round(cum[cum.length - 1])} km</text>`;
    }; draw(); const ro = new ResizeObserver(draw); ro.observe(s); return () => ro.disconnect();
  }, [cum, elev, slope, maxSlope]);
  return <div className="fig small"><svg ref={ref} role="img" aria-label="Elevation (orange, left axis) and slope (blue, right axis) along the route" /></div>;
}

export function ScoreBar({ v, label }: { v: number | null; label: string }) {
  return <div className="sbar"><span className="sb-l">{label}</span><span className="sb-t"><span style={{ width: `${v === null ? 0 : Math.round(v * 100)}%` }} className={v === null ? 'na' : ''} /></span>
    <span className="sb-v num">{v === null ? '—' : Math.round(v * 100)}</span></div>;
}
