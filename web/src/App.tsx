import React, { useEffect, useMemo, useState } from 'react';
import { DataStore } from './engine/data';
import { Engine } from './engine/query';
import { MissionAnalyzer, MissionConfig, Candidate, MissionId } from './engine/missions';
import { Router, Mobility, Profile, RouteResult } from './engine/route';
import { buildReport, Report } from './engine/report';
import { parseCoord, fmtCoord, wrapLon } from './engine/geo';
import { DICT, Lang, Key } from './i18n';
import { LangCtx } from './ui/common';
import { MapView, Overlay, MapMarker, MapLine } from './ui/MapView';
import { LayerPanel } from './ui/LayerPanel';
import { LocationPanel } from './ui/LocationPanel';
import { MissionPanel } from './ui/MissionPanel';
import { NavPanel, ROUTE_COLORS } from './ui/NavPanel';
import { Overview, Survival, DataSources, Reports } from './ui/Pages';
// import { Assistant } from './ui/Assistant';

const ROUTES = ['overview', 'explorer', 'location', 'missions', 'navigation', 'survival', 'data', 'reports'] as const;
type RouteId = typeof ROUTES[number];
const MAP_ROUTES: RouteId[] = ['explorer', 'location', 'missions', 'navigation'];
const store = { get(k: string) { try { return JSON.parse(localStorage.getItem('mesis:' + k) || 'null'); } catch { return null; } },
                set(k: string, v: any) { try { localStorage.setItem('mesis:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };

export function App() {
  const [ds] = useState(() => new DataStore('data/'));
  const [eng, setEng] = useState<Engine | null>(null); const [err, setErr] = useState<string | null>(null);
  const ma = useMemo(() => eng && new MissionAnalyzer(ds, eng), [eng]); const router = useMemo(() => new Router(ds), []);
  const [lang, setLang] = useState<Lang>(store.get('lang') || 'en');
  const [route, setRoute] = useState<RouteId>(() => (ROUTES as readonly string[]).includes(location.hash.slice(1)) ? location.hash.slice(1) as RouteId : 'overview');
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({ names: true, craters: false, rovers: true, images: false });
  const [sel, setSel] = useState<{ lat: number; lon: number } | null>(null); const [q, setQ] = useState<any>(null); const [qBusy, setQBusy] = useState(false);
  const [focus, setFocus] = useState<any>(null); const [pickMode, setPickMode] = useState<string | null>(null);
  const [cfg, setCfg] = useState<MissionConfig>({ mission: 'water_ice', risk: 'medium', start: null, maxDistKm: null, region: null, count: 8 });
  const [mres, setMres] = useState<any>(null); const [msel, setMsel] = useState(0); const [mBusy, setMBusy] = useState(false);
  const [pts, setPts] = useState<{ lat: number; lon: number }[]>([]); const [mob, setMob] = useState<Mobility>('crew_rover');
  const [routes, setRoutes] = useState<RouteResult[]>([]); const [rsel, setRsel] = useState<Profile>('safest'); const [rBusy, setRBusy] = useState(false);
  const [reports, setReports] = useState<Report[]>([]); const [repSel, setRepSel] = useState(0);
  const [recent, setRecent] = useState<any[]>(store.get('recent') || []);
  const [search, setSearch] = useState(''); const [aiPrompt, setAiPrompt] = useState<any>(null); const [navOpen, setNavOpen] = useState(false);
  const t = (k: Key) => DICT[lang][k];

  useEffect(() => { ds.init().then(() => new Engine(ds).init()).then(setEng).catch(e => setErr(String(e))); }, []);
  useEffect(() => { if (eng && ma) (window as any).__mesis = { ds, eng, ma, router }; }, [eng, ma]); // test/debug hook
  useEffect(() => { const h = () => { const r = location.hash.slice(1); if ((ROUTES as readonly string[]).includes(r)) setRoute(r as RouteId); }; addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; store.set('lang', lang); }, [lang]);
  const go = (r: RouteId) => { setRoute(r); setNavOpen(false); try { history.replaceState(null, '', '#' + r); } catch { location.hash = r; } };

  async function select(lat: number, lon: number, name?: string, toLoc = true) {
    if (!eng) return; lon = wrapLon(lon); setSel({ lat, lon }); setQBusy(true); setFocus({ lat, lon, t: Date.now() });
    if (toLoc && route !== 'location') go('location');
    try { const r = await eng.query(lat, lon); setQ(r);
      const rec = [{ lat, lon, name: name || (r.region?.within ? r.region.name : undefined) }, ...recent.filter(x => Math.abs(x.lat - lat) + Math.abs(x.lon - lon) > 0.05)].slice(0, 6);
      setRecent(rec); store.set('recent', rec); } finally { setQBusy(false); }
  }
  function onPick(lat: number, lon: number) {
    if (pickMode === 'mstart') { setCfg({ ...cfg, start: { lat, lon } }); setPickMode(null); return; }
    if (pickMode === 'mregion') { setCfg({ ...cfg, region: { lat, lon, radiusKm: cfg.region?.radiusKm || 800 } }); setPickMode(null); return; }
    if (pickMode === 'route' || route === 'navigation') { setPts(p => p.length < 2 ? [...p, { lat, lon }] : [...p.slice(0, -1), { lat, lon }, p[p.length - 1]]); setRoutes([]); if (pts.length >= 1) setPickMode(null); return; }
    select(lat, lon, undefined, route !== 'explorer' && route !== 'missions');
  }
  async function runMission() { if (!ma) return; setMBusy(true); await new Promise(r => setTimeout(r, 20)); try { setMres(await ma.rank(cfg)); setMsel(0); } finally { setMBusy(false); } }
  async function runRoutes(points = pts) { setRBusy(true); await new Promise(r => setTimeout(r, 20)); const out: RouteResult[] = [];
    try { for (const p of ['safest', 'shortest', 'science', 'resource'] as Profile[]) out.push(await router.multi(points, p, mob)); setRoutes(out); setRsel('safest'); } finally { setRBusy(false); } }
  function addReport(o: Partial<Report> & { mission: MissionId | null }) { const r = buildReport(ds.manifest, o); setReports([r, ...reports]); setRepSel(0); go('reports'); }
  async function save(name: string, data: string, mime: string): Promise<boolean> {
    const c = (window as any).claude; try { const d = c?.use ? await c.use('downloads') : null; if (d) { await d.save({ filename: name, data }); return true; } } catch { return false; }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; a.click(); return true; } catch { return false; }
  }
  function doSearch(e: React.FormEvent) { e.preventDefault(); if (!eng) return; const c = parseCoord(search); if (c) { select(c.lat, c.lon); return; }
    const f = eng.find(search)[0]; if (f) select(f.lat, f.lon, f.name); }

  if (err) return <div className="boot"><h1>MESIS</h1><p>Data package failed to load: {err}</p></div>;
  if (!eng || !ma) return <div className="boot"><h1>{t('app')}</h1><p className="muted">{t('loading')} MOLA, TES, SWIM, GRS, SIM 3292, 385,048 craters…</p></div>;

  const cand = mres?.candidates[msel] as Candidate | undefined;
  const markers: MapMarker[] = []; const lines: MapLine[] = []; const circles: any[] = [];
  if (sel && route !== 'navigation') markers.push({ ...sel, kind: 'select' });
  if (route === 'missions' && mres) mres.candidates.forEach((c: Candidate, i: number) => markers.push({ lat: c.lat, lon: c.lon, kind: 'cand', label: String(i + 1), color: i === msel ? '#ffd166' : '#ff9f5a' }));
  if (route === 'missions' && cfg.start) markers.push({ ...cfg.start, kind: 'start' });
  if (route === 'missions' && cfg.region) circles.push({ ...cfg.region, km: cfg.region.radiusKm, color: '#ffd166' });
  if (route === 'missions' && cfg.start && cfg.maxDistKm) circles.push({ ...cfg.start, km: cfg.maxDistKm, color: '#5fd38d' });
  if (route === 'navigation') { pts.forEach((p, i) => markers.push({ ...p, kind: i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'wp' }));
    routes.filter(r => r.ok).forEach(r => lines.push({ pts: r.path, color: ROUTE_COLORS[r.profile], width: r.profile === rsel ? 4 : 1.6, dash: r.profile === rsel ? [] : [5, 4] }));
    const r = routes.find(x => x.profile === rsel); r?.hazards.slice(0, 20).forEach(h => markers.push({ lat: h.lat, lon: h.lon, kind: 'wp', color: '#ff5d5d' }));
    r?.waypointsSci.forEach(w => markers.push({ lat: w.lat, lon: w.lon, kind: 'wp', color: w.what === 'ice' ? '#5cc8ff' : '#c49bff' })); }
  const context = `module=${route}; selected=${sel ? fmtCoord(sel.lat, sel.lon) : 'none'}; mission=${cfg.mission}; route points=${pts.map(p => fmtCoord(p.lat, p.lon)).join(' -> ') || 'none'}`;
  const isMap = MAP_ROUTES.includes(route);

  return <LangCtx.Provider value={lang}>
    <div className={'shell' + (isMap ? ' with-map' : '')}>
      <header className="top">
        <button className="burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu" aria-expanded={navOpen}>☰</button>
        <a className="brand" href="#overview" onClick={() => go('overview')}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#c1440e" /><path d="M4 10c4 2 9-1 16 1M5 15c5-1 9 2 14 0" stroke="#7a2a08" strokeWidth="1.6" fill="none" /></svg>
          <span>{t('short')}</span><span className="brand-l">{t('app')}</span></a>
        <form className="search" onSubmit={doSearch} role="search"><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search_ph')} aria-label={t('search_ph')} list="feat" />
          <datalist id="feat">{search.length > 1 && eng.find(search).map(p => <option key={p.name} value={p.name} />)}</datalist></form>
        <button className="btn ghost lang" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{t('lang')}</button>
      </header>
      <nav className={'side' + (navOpen ? ' open' : '')} aria-label="Modules">{ROUTES.map(r => <a key={r} href={'#' + r} className={r === route ? 'on' : ''} onClick={e => { e.preventDefault(); go(r); }}>{t(('nav_' + r) as Key)}</a>)}</nav>
      <main className="main">
        {isMap && <div className="work">
          <MapView ds={ds} eng={eng} overlays={overlays} markers={markers} lines={lines} circles={circles} focus={focus} onPick={onPick}
            showCraters={!!toggles.craters} showNames={!!toggles.names} showRovers={!!toggles.rovers} showImages={!!toggles.images} />
          {pickMode && <div className="pickhint">{pickMode === 'route' ? (pts.length ? t('destination') : t('start')) : pickMode === 'mstart' ? t('start') : t('region')}: {t('pick_map')} · <button className="link" onClick={() => setPickMode(null)}>{t('close')}</button></div>}
          <aside className="panel" aria-label={t(('nav_' + route) as Key)}>
            <h2 className="panel-h">{t(('nav_' + route) as Key)}</h2>
            {route === 'explorer' && <LayerPanel ds={ds} overlays={overlays} setOverlays={setOverlays} toggles={toggles} setToggle={(k, v) => setToggles({ ...toggles, [k]: v })} />}
            {route === 'location' && <LocationPanel q={q} ds={ds} busy={qBusy} aiOn={(window as any).claude?.use !== undefined}
              onAI={() => q && setAiPrompt({ text: `Explain the scientific significance and main mission considerations for ${fmtCoord(q.lat, q.lon)}${q.region ? ' (' + q.region.name + ')' : ''}. Use query_location first.`, t: Date.now() })}
              onReport={() => q && addReport({ mission: null, title: `Location report — ${q.region?.within ? q.region.name : fmtCoord(q.lat, q.lon)}`, loc: q, dest: { lat: q.lat, lon: q.lon, name: q.region?.name || '' } })} />}
            {route === 'missions' && <MissionPanel cfg={cfg} setCfg={setCfg} pickMode={pickMode} setPickMode={setPickMode} run={runMission} busy={mBusy} res={mres} sel={msel}
              setSel={i => { setMsel(i); const c = mres.candidates[i]; setFocus({ lat: c.lat, lon: c.lon, ppd: 8, t: Date.now() }); }}
              onRoute={c => { const p = [cfg.start!, { lat: c.lat, lon: c.lon }]; setPts(p); go('navigation'); runRoutes(p); }}
              onReport={async c => { const q2 = await eng.query(c.lat, c.lon); addReport({ mission: cfg.mission, title: `${t(('m_' + cfg.mission) as Key)} — ${c.name}`, candidate: c, loc: q2,
                alternatives: mres.candidates.filter((x: Candidate) => x !== c).slice(0, 4), start: cfg.start || null, dest: { lat: c.lat, lon: c.lon, name: c.name },
                routes: routes.length && pts.length && Math.abs(pts[pts.length - 1].lat - c.lat) < 0.01 ? routes : [], mobility: routes.length ? mob : null }); }} />}
            {route === 'navigation' && <NavPanel pts={pts} setPts={p => { setPts(p); setRoutes([]); }} pickMode={pickMode} setPickMode={setPickMode} mob={mob} setMob={m => { setMob(m); setRoutes([]); }}
              run={() => runRoutes()} busy={rBusy} routes={routes} sel={rsel} setSel={setRsel}
              onReport={() => addReport({ mission: cand ? cfg.mission : null, title: `Route report — ${fmtCoord(pts[0].lat, pts[0].lon)} → ${fmtCoord(pts[pts.length - 1].lat, pts[pts.length - 1].lon)}`,
                start: pts[0], dest: { ...pts[pts.length - 1], name: eng.regionName(pts[pts.length - 1].lat, pts[pts.length - 1].lon)?.name || '' }, routes, mobility: mob, candidate: cand || null })} />}
          </aside>
        </div>}
        {route === 'overview' && <Overview ds={ds} eng={eng} go={go as any} pick={(la, lo, n) => select(la, lo, n)} recent={recent} />}
        {route === 'survival' && <Survival ds={ds} sel={q} />}
        {route === 'data' && <DataSources ds={ds} />}
        {route === 'reports' && <Reports reports={reports} sel={repSel} setSel={setRepSel} save={save} />}
      </main>
      {/* <Assistant ds={ds} eng={eng} ma={ma} router={router} context={context} prompt={aiPrompt}
        onSites={(c, m) => { setCfg({ ...cfg, mission: m }); setMres({ candidates: c, scanned: 63360, excluded: { slope: 0, distance: 0, region: 0, polar: 0 } }); setMsel(0); go('missions'); }}
        onFocus={(la, lo) => setFocus({ lat: la, lon: lo, t: Date.now() })} /> */}
    </div>
  </LangCtx.Provider>;
}
