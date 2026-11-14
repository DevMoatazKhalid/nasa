import React from 'react';
import { useT, ScoreBar } from './common';
import { MISSIONS, MissionId, Candidate, Criterion, MissionConfig } from '../engine/missions';
import { fmtCoord } from '../engine/geo';
import { Key } from '../i18n';

const CRIT_LABEL: Record<Criterion, string> = {
  ice: 'Ice evidence', terrain: 'Terrain ease', landing_elev: 'Low elevation', radiation: 'Low GCR dose', thermal_lat: 'Sunlight / warmth (latitude)',
  dust: 'Low surface dust', minerals: 'Primary minerals', hydrated: 'Aqueous-alteration indicators', diversity: 'Geologic diversity',
  ancient: 'Ancient terrain', firm_ground: 'Firm ground (TI)', rocks: 'Few rocks', access: 'Accessibility', ice_lat_window: 'Mid-latitude window',
};
export { CRIT_LABEL };

export function MissionPanel(p: {
  cfg: MissionConfig; setCfg: (c: MissionConfig) => void; pickMode: string | null; setPickMode: (m: string | null) => void;
  run: () => void; busy: boolean; res: { candidates: Candidate[]; scanned: number; excluded: Record<string, number> } | null;
  sel: number; setSel: (i: number) => void; onRoute: (c: Candidate) => void; onReport: (c: Candidate) => void;
}) {
  const t = useT(); const c = p.cfg;
  const up = (k: Partial<MissionConfig>) => p.setCfg({ ...c, ...k });
  const cand = p.res?.candidates[p.sel];
  return <div className="panel-scroll">
    <form className="form" onSubmit={e => { e.preventDefault(); p.run(); }}>
      <label>{t('mission_type')}<select value={c.mission} onChange={e => up({ mission: e.target.value as MissionId })}>
        {Object.keys(MISSIONS).map(m => <option key={m} value={m}>{t(('m_' + m) as Key)}</option>)}</select></label>
      <p className="note">{MISSIONS[c.mission].rationale}</p>
      <div className="two">
        <label>{t('start')}<div className="pick"><span className="num">{c.start ? fmtCoord(c.start.lat, c.start.lon) : '—'}</span>
          <button type="button" className={'btn small' + (p.pickMode === 'mstart' ? ' on' : '')} onClick={() => p.setPickMode(p.pickMode === 'mstart' ? null : 'mstart')}>{t('pick_map')}</button>
          {c.start && <button type="button" className="btn small ghost" onClick={() => up({ start: null })}>{t('clear')}</button>}</div></label>
        <label>{t('max_dist')}<input type="number" min={50} max={10000} step={50} value={c.maxDistKm ?? ''} placeholder="—" onChange={e => up({ maxDistKm: e.target.value ? +e.target.value : null })} /></label>
      </div>
      <div className="two">
        <label>{t('region')}<div className="pick"><span className="num">{c.region ? fmtCoord(c.region.lat, c.region.lon) : '—'}</span>
          <button type="button" className={'btn small' + (p.pickMode === 'mregion' ? ' on' : '')} onClick={() => p.setPickMode(p.pickMode === 'mregion' ? null : 'mregion')}>{t('pick_map')}</button>
          {c.region && <button type="button" className="btn small ghost" onClick={() => up({ region: null })}>{t('clear')}</button>}</div></label>
        {c.region && <label>{t('radius')}<input type="number" min={100} max={5000} step={50} value={c.region.radiusKm} onChange={e => up({ region: { ...c.region!, radiusKm: +e.target.value } })} /></label>}
      </div>
      <fieldset className="seg"><legend>{t('risk')}</legend>{(['low', 'medium', 'high'] as const).map(r =>
        <label key={r} className={c.risk === r ? 'on' : ''}><input type="radio" name="risk" checked={c.risk === r} onChange={() => up({ risk: r })} />{t(r)}</label>)}</fieldset>
      <p className="note">Risk sets the maximum mean slope of a 1° cell (low 4°, medium 7°, high 12°) and the latitude limit (70° / 80°).</p>
      <button className="btn primary" disabled={p.busy}>{p.busy ? t('loading') + '…' : t('run')}</button>
    </form>
    {p.res && <>
      <h4 className="h4">{t('results')} <span className="muted small">· {p.res.scanned.toLocaleString()} cells scanned · excluded: slope {p.res.excluded.slope}, distance {p.res.excluded.distance}, region {p.res.excluded.region}, polar {p.res.excluded.polar}</span></h4>
      {!p.res.candidates.length && <p className="muted">No location satisfies the constraints. Relax the risk tolerance, distance or region.</p>}
      <ol className="cands">{p.res.candidates.map((x, i) => <li key={i} className={i === p.sel ? 'on' : ''}><button onClick={() => p.setSel(i)}>
        <span className="rank num">{i + 1}</span><span className="cn">{x.name}<br /><span className="muted num small">{fmtCoord(x.lat, x.lon)}{x.distFromStart !== null ? ` · ${Math.round(x.distFromStart)} km` : ''}</span></span>
        <span className="cs"><span className="num big">{Math.round(x.score * 100)}</span><span className="muted small">{t('conf')} {Math.round(x.confidence * 100)}%</span></span></button></li>)}</ol>
      {cand && <div className="cand-d">
        <h4>{cand.name}</h4>
        <div className="sub">{t('why')}</div>
        {Object.entries(cand.parts).map(([k, v]) => <ScoreBar key={k} label={`${CRIT_LABEL[k as Criterion]} · w ${MISSIONS[c.mission].weights[k as Criterion]}`} v={v as number | null} />)}
        <div className="two-col">
          <div><div className="sub">{t('pros')}</div><ul>{Object.entries(cand.parts).filter(([, v]) => v !== null && (v as number) >= 0.7).map(([k]) => <li key={k}>{CRIT_LABEL[k as Criterion]}</li>)}</ul></div>
          <div><div className="sub">{t('cons')}</div><ul>{Object.entries(cand.parts).filter(([, v]) => v === null || (v as number) < 0.35).map(([k, v]) => <li key={k}>{CRIT_LABEL[k as Criterion]}{v === null ? ' — no data' : ''}</li>)}</ul></div>
        </div>
        <div className="sub">{t('hazards')}</div><p>{cand.hazards.length ? cand.hazards.join(' · ') : 'None flagged at 1° scale (sub-km hazards are not resolved).'}</p>
        <p className="note">Evidence: {cand.evidence}. Score is a weighted mean of available criteria; missing criteria are excluded and lower confidence. Raw values: elev {cand.raw.elev?.toFixed(0)} m, slope {cand.raw.slope?.toFixed(1)}°, ice consistency {cand.raw.swim?.toFixed(2) ?? '—'}, GRS H₂O {cand.raw.h2o?.toFixed(1) ?? '—'} wt%.</p>
        <div className="actions"><button className="btn" onClick={() => p.onRoute(cand)} disabled={!c.start}>{t('plan_route')}</button>
          <button className="btn ghost" onClick={() => p.onReport(cand)}>{t('make_report')}</button></div>
        {!c.start && <p className="muted small">Set a start point to plan a route.</p>}
      </div>}
    </>}
  </div>;
}
