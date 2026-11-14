// Scientific scenario tests run against the real engine + data package in headless Chromium.
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:8765/';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(base + '#overview'); await p.waitForFunction(() => window.__mesis, null, { timeout: 60000 });
const R = await p.evaluate(async () => {
  const { eng, ma, router } = window.__mesis; const out = {};
  const q = async (la, lo) => eng.query(la, lo);
  // 1. Known elevations (MOLA): Olympus Mons summit ~ +21 km, Hellas floor ~ -7 km, Jezero floor ~ -2.6 km
  const oly = await q(18.65, 226.2), hel = await q(-42.4, 70.5), jez = await q(18.44, 77.45);
  const dem = await window.__mesis.ds.grid('dem');
  out.elev = { olympus: dem.stats(18.65, 226.2, 60).max, hellas: dem.stats(-42.4, 70.5, 600).min, jezero: jez.elev.value };
  // 2. Radiation model: lower elevation -> lower dose; Gale anchor ~0.21
  const gale = await q(-4.59, 137.44); out.dose = { hellas: hel.rad.dose, gale: gale.rad.dose, olympus: oly.rad.dose };
  // 3. Ice: Arcadia (SWIM high) vs Meridiani (dry) vs north polar (neutron)
  const arc = await q(45, 190), mer = await q(-2, 354.5), np = await q(87, 0), n65 = await q(65, 0); out.ns65 = n65.ns.value;
  out.ice = { arcadia: [arc.s01.value, arc.iceEvidence.level], meridiani: [mer.s01.value, mer.iceEvidence.level], northpole: [np.ns.value, np.iceEvidence.level] };
  // 4. Missing data honesty: TI at 85N must be null; GRS at 75S null (masked by source)
  const p85 = await q(85, 30), s75 = await q(-75, 100); out.missing = { ti85: p85.ti.value, grs75S: s75.h2o.value, status: p85.ti.status };
  // 5. Mission weights change rankings
  const r1 = await ma.rank({ mission: 'water_ice', risk: 'medium', count: 5 }), r2 = await ma.rank({ mission: 'agriculture', risk: 'medium', count: 5 });
  out.rank = { ice: r1.candidates.map(c => [c.name, Math.round(c.lat), Math.round(c.lon), +c.score.toFixed(2)]), agri: r2.candidates.map(c => [c.name, Math.round(c.lat), Math.round(c.lon), +c.score.toFixed(2)]) };
  out.iceMeanLat = r1.candidates.reduce((a, c) => a + Math.abs(c.lat), 0) / r1.candidates.length;
  out.agriMeanLat = r2.candidates.reduce((a, c) => a + Math.abs(c.lat), 0) / r2.candidates.length;
  // 6. Distance constraint respected
  const r3 = await ma.rank({ mission: 'science', risk: 'medium', start: { lat: 18.44, lon: 77.45 }, maxDistKm: 800, count: 5 });
  out.maxDistOk = r3.candidates.every(c => c.distFromStart <= 800); out.sci = r3.candidates.map(c => [c.name, Math.round(c.distFromStart)]);
  // 7. Routing across Valles Marineris (Melas Chasma rims): safest must avoid steep walls; shortest vs safest
  const A = { lat: 18.0, lon: 214.0 }, B = { lat: 18.0, lon: 238.0 };
  const s = await router.plan(A, B, 'safest', 'crew_rover'), sh = await router.plan(A, B, 'shortest', 'crew_rover');
  const gc = (await import('./data/manifest.json', { with: { type: 'json' } }).catch(() => null)) ? 0 : 0;
  out.vm = { safest: s.ok ? [Math.round(s.distanceKm), +s.maxSlope.toFixed(1), Math.round(s.cost)] : s.reason, shortest: sh.ok ? [Math.round(sh.distanceKm), +sh.maxSlope.toFixed(1), Math.round(sh.cost)] : sh.reason };
  // 8. Route on flat plains is near great-circle
  const f = await router.plan({ lat: 45, lon: 185 }, { lat: 47, lon: 195 }, 'shortest', 'crew_rover');
  const d = 2 * 3389.5 * Math.asin(Math.sqrt(Math.sin((2 * Math.PI / 180) / 2) ** 2 + Math.cos(45 * Math.PI / 180) * Math.cos(47 * Math.PI / 180) * Math.sin((10 * Math.PI / 180) / 2) ** 2));
  out.flat = { route: Math.round(f.distanceKm), greatCircle: Math.round(d), ratio: +(f.distanceKm / d).toFixed(3) };
  // 9. Impassable start detection (Olympus Mons scarp)
  const sc = await router.plan({ lat: 18.0, lon: 223.2 }, { lat: 18.6, lon: 226.2 }, 'safest', 'eva'); out.scarp = sc.ok ? 'routed ' + Math.round(sc.distanceKm) : sc.reason;
  // 10. Geology at Gale and craters inside Gale
  out.galeUnit = gale.unit?.unit; out.galeInside = gale.inside?.d;
  return out;
});
console.log(JSON.stringify(R, null, 1));
const checks = [
  ['Olympus summit > 20 km', R.elev.olympus > 20000], ['Hellas floor < -6.5 km', R.elev.hellas < -6500], ['Jezero ~ -2.6 km', Math.abs(R.elev.jezero + 2600) < 300],
  ['dose ordered hellas<gale<olympus', R.dose.hellas < R.dose.gale && R.dose.gale < R.dose.olympus], ['Gale dose ~0.21', Math.abs(R.dose.gale - 0.21) < 0.02],
  ['Arcadia SWIM > Meridiani SWIM', R.ice.arcadia[0] > R.ice.meridiani[0]], ['north polar cap strong ice evidence', R.ice.northpole[1] === 'strong'],
  ['TI at 85N unavailable', R.missing.ti85 === null && R.missing.status === 'unavailable'], ['GRS masked at 75S', R.missing.grs75S === null],
  ['ice missions favour higher latitudes than agriculture', R.iceMeanLat > R.agriMeanLat], ['max distance respected', R.maxDistOk],
  ['flat-plain route within 3% of great circle', R.flat.ratio < 1.03 && R.flat.ratio >= 0.99],
  ['Olympus Mons crossing: both routes found', Array.isArray(R.vm.safest) && Array.isArray(R.vm.shortest)],
  ['safest route avoids steeper terrain than shortest', Array.isArray(R.vm.safest) && R.vm.safest[1] <= R.vm.shortest[1] + 0.01],
  ['shortest is not longer than safest', Array.isArray(R.vm.safest) && R.vm.shortest[0] <= R.vm.safest[0]],
  ['Gale centre inside 154 km crater', R.galeInside > 140],
];
let ok = true; for (const [n, c] of checks) { console.log((c ? 'PASS ' : 'FAIL ') + n); ok = ok && c; }
await b.close(); process.exit(ok ? 0 : 1);
