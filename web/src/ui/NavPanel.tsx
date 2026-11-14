import React from 'react';
import { useT, ProfileChart } from './common';
import { MOBILITY, Mobility, Profile, RouteResult, PROFILES } from '../engine/route';
import { fmtCoord } from '../engine/geo';
import { Key } from '../i18n';

export const ROUTE_COLORS: Record<Profile, string> = { safest: '#5fd38d', shortest: '#f2f2f2', science: '#c49bff', resource: '#5cc8ff' };

export function NavPanel(p: {
  pts: { lat: number; lon: number }[]; setPts: (x: { lat: number; lon: number }[]) => void; pickMode: string | null; setPickMode: (m: string | null) => void;
  mob: Mobility; setMob: (m: Mobility) => void; run: () => void; busy: boolean; routes: RouteResult[]; sel: Profile; setSel: (p: Profile) => void; onReport: () => void;
}) {
  const t = useT(); const r = p.routes.find(x => x.profile === p.sel);
  const label = (i: number) => (i === 0 ? t('start') : i === p.pts.length - 1 && p.pts.length > 1 ? t('destination') : `${t('waypoint')} ${i}`);
  return <div className="panel-scroll">
    <div className="warn">{t('not_rover_grade')}</div>
    <div className="form">
      <div className="pts">{p.pts.map((x, i) => <div key={i} className="pt"><span className="dot" style={{ background: i === 0 ? '#5fd38d' : i === p.pts.length - 1 ? '#ff5d5d' : '#f2c94c' }} />
        <span>{label(i)}</span><span className="num muted">{fmtCoord(x.lat, x.lon)}</span>
        <button className="btn small ghost" onClick={() => p.setPts(p.pts.filter((_, j) => j !== i))} aria-label="Remove point">×</button></div>)}</div>
      <div className="actions"><button className={'btn small' + (p.pickMode === 'route' ? ' on' : '')} onClick={() => p.setPickMode(p.pickMode === 'route' ? null : 'route')}>
        {p.pts.length === 0 ? `${t('start')}: ${t('pick_map')}` : p.pts.length === 1 ? `${t('destination')}: ${t('pick_map')}` : t('add_wp')}</button>
        {p.pts.length > 0 && <button className="btn small ghost" onClick={() => p.setPts([])}>{t('clear')}</button>}</div>
      {p.pts.length > 2 && <p className="note">Points are visited in order; new clicks are inserted before the destination.</p>}
      <label>{t('mobility_cap')}<select value={p.mob} onChange={e => p.setMob(e.target.value as Mobility)}>
        {Object.entries(MOBILITY).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></label>
      <p className="note">{MOBILITY[p.mob].basis}</p>
      <button className="btn primary" disabled={p.pts.length < 2 || p.busy} onClick={p.run}>{p.busy ? t('loading') + '…' : t('compute')}</button>
    </div>
    {p.routes.length > 0 && <>
      <div className="rt-tabs" role="tablist">{p.routes.map(x => <button key={x.profile} role="tab" aria-selected={x.profile === p.sel} className={x.profile === p.sel ? 'on' : ''} onClick={() => p.setSel(x.profile)}>
        <span className="dot" style={{ background: ROUTE_COLORS[x.profile] }} />{t(('p_' + x.profile) as Key)}
        <span className="num small">{x.ok ? `${Math.round(x.distanceKm)} km` : '—'}</span></button>)}</div>
      <table className="cmp"><thead><tr><th></th>{p.routes.map(x => <th key={x.profile}>{t(('p_' + x.profile) as Key)}</th>)}</tr></thead><tbody>
        {([['distance', (x: RouteResult) => `${Math.round(x.distanceKm)} km`], ['est_time', (x: RouteResult) => `~${x.sols} ${t('sols')}`], ['climb', (x: RouteResult) => `${Math.round(x.climbM)} m`],
          ['max_slope', (x: RouteResult) => `${x.maxSlope.toFixed(1)}°`], ['hazards', (x: RouteResult) => String(x.hazards.length)], ['sci_wp', (x: RouteResult) => String(x.waypointsSci.length)],
          ['cost', (x: RouteResult) => Math.round(x.cost).toLocaleString()]] as [Key, (x: RouteResult) => string][]).map(([k, f]) =>
          <tr key={k}><td>{t(k)}</td>{p.routes.map(x => <td key={x.profile} className="num">{x.ok ? f(x) : '—'}</td>)}</tr>)}
      </tbody></table>
      {r && !r.ok && <p className="warn">{r.reason}</p>}
      {r && r.ok && <div className="rt-d">
        <div className="sub">{t('profile')}</div>
        <ProfileChart cum={r.cum} elev={r.elev} slope={r.slope} maxSlope={MOBILITY[p.mob].maxSlope} />
        <div className="sub">Why this path</div>
        <p className="small">{explain(r, p.mob)}</p>
        <div className="sub">{t('hazards')}</div>
        {r.hazards.length ? <ul className="small">{r.hazards.slice(0, 8).map((h, i) => <li key={i}>km {Math.round(h.km)} — {h.kind === 'steep' ? `slope ${h.value.toFixed(1)}°` : `rock cover ${Math.round(h.value)}%`} <span className="muted num">{fmtCoord(h.lat, h.lon)}</span></li>)}</ul>
          : <p className="muted small">No cells above 70% of the slope limit or {'>'}20% rock cover on this path.</p>}
        <div className="sub">{t('sci_wp')}</div>
        {r.waypointsSci.length ? <ul className="small">{r.waypointsSci.slice(0, 8).map((w, i) => <li key={i}>km {Math.round(w.km)} — {w.what === 'ice' ? 'SWIM ice consistency > 0.4' : 'TES high-Si glass/clay > 0.15'} <span className="muted num">{fmtCoord(w.lat, w.lon)}</span></li>)}</ul>
          : <p className="muted small">No ice-consistency or hydrated-mineral indicators crossed.</p>}
        <p className="note">Estimated time is an estimate from the stated mobility assumption, slowed linearly with slope. Modeled GCR dose accumulated en route: {r.doseTotal?.toFixed(1)} mGy (excludes solar events).</p>
        <button className="btn ghost" onClick={p.onReport}>{t('make_report')}</button>
      </div>}
    </>}
  </div>;
}

function explain(r: RouteResult, mob: Mobility) {
  const w = PROFILES[r.profile];
  const parts = [`A* search over ${r.path.length} cells (7.4 km). Cost = distance × (1 + ${w.slope}·(slope/limit)² + ${w.rough}·roughness + ${w.crater}·crater density + ${w.rad}·dose excess + ${w.dust}·dust)`];
  if (w.bonus === 'ice') parts.push('with cost reduced by up to 40% through cells whose SWIM 0–1 m ice consistency exceeds 0.3');
  if (w.bonus === 'science') parts.push('with cost reduced by 25% through cells showing TES high-silica glass/clay signals');
  parts.push(`Cells steeper than ${MOBILITY[mob].maxSlope}° are impassable for this mobility class. Mean slope along the path ${r.meanSlope.toFixed(1)}°.`);
  return parts.join(', ') + '.';
}
