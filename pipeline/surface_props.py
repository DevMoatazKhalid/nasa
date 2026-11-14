"""Surface-property, composition and hydrogen grids.

Inputs (all real, unmodified source files):
  GRS  : h2o_2x2.tab, h2o_sr_5x5.tab  (ODY-M-GRS-5-ELEMENTS-V1.0, PDS Geosciences)
  ASU  : MESIS_<layer>.vic VICAR grids from the ASU Mars Space Flight Facility WMS
         (TES thermal inertia, Lambert albedo, dust cover index, rock abundance,
          neutron-spectrometer epithermal counts, Kreslavsky & Head 0.6 km roughness,
          TES mineral abundances).
All grids are re-expressed on the shared convention (row 0 = north, col 0 = 0E) with an
explicit nodata value; values are NOT rescaled or "corrected".
"""
import os, sys, glob
import numpy as np
from common import write_grid, parse_vicar, save_json


def grs_table(path, deg):
    H, W = 180 // deg, 360 // deg
    conc = np.full((H, W), np.nan, np.float32); sig = np.full((H, W), np.nan, np.float32)
    for line in open(path):
        p = line.split()
        if len(p) < 5:
            continue
        la, lo, c, s, scfs = map(float, p[:5])
        r = int((90 - la) // deg); k = int((lo % 360) // deg)
        if c < 9000:
            conc[r, k] = c
            sig[r, k] = scfs if scfs < 9000 else s
    return conc, sig


def asu_grid(path, nodata_test=lambda a: (a <= -1) | ~np.isfinite(a)):
    a, h = parse_vicar(path)
    a = a.astype(np.float32)
    a[nodata_test(a)] = np.nan
    # ASU WMS requests used BBOX=0,-90,360,90 so column 0 is already 0E; row 0 is north
    return a


# Verified by latitude-band analysis: the floor values occur only poleward of ~60 deg (no data).
FLOOR_NODATA = {'TES_Thermal_Inertia_numeric': 25.0, 'TES_Lambert_Albedo_numeric': 0.08,
                'TES_dust_index_16ppd_numeric': 0.85}


def to_u16(a, lo, hi):
    """Quantise to uint16 with 65535 = nodata. Returns (array, scale, offset)."""
    sc = (hi - lo) / 65000.0
    q = np.where(np.isnan(a), 65535, np.clip(np.round((a - lo) / sc), 0, 65000)).astype(np.uint16)
    return q, sc, lo


def main(srcdir, outdir):
    meta = {}
    f2 = os.path.join(srcdir, 'MESIS_h2o_2x2.tab')
    f5 = os.path.join(srcdir, 'MESIS_h2o_sr_5x5.tab')
    if os.path.exists(f5):
        c5, s5 = grs_table(f5, 5)
        meta['grs_h2o_5'] = write_grid(outdir, 'grs_h2o_5deg.bin', np.nan_to_num(c5, nan=-1), 'float32', ppd=0.2,
                                       nodata=-1, units='wt% H2O', extra={'sigma_file': 'grs_h2o_5deg_sigma.bin'})
        np.nan_to_num(s5, nan=-1).astype('<f4').tofile(os.path.join(outdir, 'grs_h2o_5deg_sigma.bin'))
        meta['grs_h2o_5']['stats'] = [float(np.nanmin(c5)), float(np.nanmax(c5))]
    if os.path.exists(f2):
        c2, s2 = grs_table(f2, 2)
        meta['grs_h2o_2'] = write_grid(outdir, 'grs_h2o_2deg.bin', np.nan_to_num(c2, nan=-1), 'float32', ppd=0.5,
                                       nodata=-1, units='wt% H2O', extra={'sigma_file': 'grs_h2o_2deg_sigma.bin'})
        np.nan_to_num(s2, nan=-1).astype('<f4').tofile(os.path.join(outdir, 'grs_h2o_2deg_sigma.bin'))
        meta['grs_h2o_2']['stats'] = [float(np.nanmin(c2)), float(np.nanmax(c2))]

    specs = {  # layer: (outfile, lo, hi, units, ppd, extra nodata rule)
        'TES_Thermal_Inertia_numeric': ('tes_ti_8ppd.bin', 0, 3000, 'J m-2 K-1 s-1/2', 8),
        'TES_Lambert_Albedo_numeric': ('tes_albedo_8ppd.bin', 0, 1, 'unitless', 8),
        'TES_dust_index_16ppd_numeric': ('tes_dci_8ppd.bin', 0.8, 1.05, 'emissivity index', 8),
        'NS_Epithermal_numeric': ('ns_epithermal_2ppd.bin', 0, 30, 'counts/s (normalised)', 2),
        'tes_rock_abundance_filled_numeric': ('tes_rock_4ppd.bin', 0, 100, '% area', 4),
        'TES_Hematite_numeric': ('tes_hematite_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Olivine_numeric': ('tes_olivine_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Sulfate_numeric': ('tes_sulfate_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Glass_Clay_numeric': ('tes_glassclay_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Carbonate_numeric': ('tes_carbonate_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Feldspar_numeric': ('tes_feldspar_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Clinopyroxene_numeric': ('tes_cpx_4ppd.bin', 0, 1, 'fraction', 4),
        'TES_Dust_numeric': ('tes_dust_4ppd.bin', 0, 1, 'fraction', 4),
    }
    for layer, (fn, lo, hi, units, ppd) in specs.items():
        p = os.path.join(srcdir, f'MESIS_{layer}.vic')
        if not os.path.exists(p):
            continue
        a = asu_grid(p)
        if layer in FLOOR_NODATA:  # 8-bit stretched products: floor value marks polar no-data
            a[np.isclose(a, FLOOR_NODATA[layer])] = np.nan
        if layer == 'NS_Epithermal_numeric':
            a[a < -1000] = np.nan
        raw = {'min': float(np.nanmin(a)), 'max': float(np.nanmax(a)),
               'p01': float(np.nanpercentile(a, 1)), 'p50': float(np.nanpercentile(a, 50)),
               'p99': float(np.nanpercentile(a, 99)), 'valid_frac': float(np.isfinite(a).mean()),
               'shape': list(a.shape)}
        if hi - lo > 100 or raw['max'] > hi or raw['min'] < lo:  # widen to the real range, never clip data
            lo, hi = min(lo, raw['min']), max(hi, raw['max'])
        q, sc, off = to_u16(a, lo, hi)
        meta[layer] = write_grid(outdir, fn, q, 'uint16', scale=sc, offset=off, nodata=65535, ppd=ppd, units=units)
        meta[layer]['raw_stats'] = raw
    save_json(os.path.join(outdir, 'surface_meta.json'), meta)
    for k, v in meta.items():
        print(k, v.get('raw_stats') or v.get('stats'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
