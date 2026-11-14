// Modeled surface GCR dose rate as a function of atmospheric column depth.
// Anchor: MSL/RAD at Gale crater, 0.21 ± 0.04 mGy/day absorbed, 0.64 ± 0.12 mSv/day dose equivalent
// (Hassler et al. 2014, Science 343, doi:10.1126/science.1244797).
// Shielding: absorbed dose changes ~10-20% between 15 and 25 g/cm² column (Guo et al. 2017,
// JGR Planets 122, doi:10.1002/2016JE005206)  =>  k = 1-2 % per g/cm² (central 1.5 %).
// Column from MOLA elevation with an isothermal scale-height atmosphere (annual-mean reference).
export const RAD_MODEL = {
  P0_Pa: 610, H_km: 11.1, g: 3.71, anchorDose: 0.21, anchorDoseErr: 0.04, anchorDoseEq: 0.64,
  anchorColumn: 22.9, // g/cm² at Gale (~850 Pa) — consistent with REMS mean pressure
  k: 0.015, kLo: 0.010, kHi: 0.020, solarModulation: 0.3,
};

export function columnGcm2(elev_m: number): number {
  const P = RAD_MODEL.P0_Pa * Math.exp(-elev_m / 1000 / RAD_MODEL.H_km);
  return P / RAD_MODEL.g / 10; // kg/m² -> g/cm²
}
export function pressurePa(elev_m: number) { return RAD_MODEL.P0_Pa * Math.exp(-elev_m / 1000 / RAD_MODEL.H_km); }

export function gcrDose(elev_m: number) {
  const col = columnGcm2(elev_m), d = col - RAD_MODEL.anchorColumn, m = RAD_MODEL;
  const f = (k: number) => Math.max(0.3, 1 - k * d);
  const central = m.anchorDose * f(m.k);
  const a = m.anchorDose * f(m.kLo), b = m.anchorDose * f(m.kHi);
  const lo = Math.min(a, b) * (1 - m.solarModulation) , hi = Math.max(a, b) * (1 + m.solarModulation);
  return { column: col, pressure: pressurePa(elev_m), dose: central, lo, hi,
           doseEq: central * (m.anchorDoseEq / m.anchorDose), annual_mSv: central * (m.anchorDoseEq / m.anchorDose) * 668.6 * 1.0275 };
}
