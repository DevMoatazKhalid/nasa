"""Pipeline + data package tests.  Run:  python3 -m unittest tests/test_pipeline.py -v  (from the repo root)"""
import gzip, json, math, os, struct, sys, tempfile, unittest
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
from common import parse_vicar, block_reduce, MARS_R_M  # noqa: E402
import mola, surface_props, ice_names_rovers, geology  # noqa: E402

PKG = os.path.join(ROOT, 'web', 'public', 'data')
if not os.path.exists(os.path.join(PKG, 'dem_8ppd.bin.gz')):      # shipped zip: grids live in web/dist/data as base64 JSON
    PKG = os.path.join(ROOT, 'web', 'dist', 'data')
sys.path.insert(0, os.path.join(ROOT, 'server'))
from server import _read_gz  # noqa: E402


class TestReaders(unittest.TestCase):
    def test_vicar_roundtrip_real(self):
        a = (np.arange(12, dtype='<f4').reshape(3, 4) - 1)
        hdr = "LBLSIZE=128 FORMAT='REAL' TYPE='IMAGE' ORG='BSQ' NL=3 NS=4 NB=1 RECSIZE=16 NBB=0 NLB=0 REALFMT='RIEEE' INTFMT='LOW'"
        hdr = hdr.ljust(128).encode()
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(hdr + a.tobytes())
        b, h = parse_vicar(f.name)
        self.assertEqual(b.shape, (3, 4)); np.testing.assert_allclose(a, b)

    def test_vicar_int32_and_byte(self):
        for fmt, dt in (('FULL', '<i4'), ('BYTE', 'u1'), ('HALF', '<i2')):
            a = np.arange(6).astype(dt).reshape(2, 3)
            hdr = f"LBLSIZE=96 FORMAT='{fmt}' NL=2 NS=3 NB=1 RECSIZE={3 * a.itemsize} INTFMT='LOW'".ljust(96).encode()
            with tempfile.NamedTemporaryFile(delete=False) as f:
                f.write(hdr + a.tobytes())
            b, _ = parse_vicar(f.name)
            np.testing.assert_array_equal(a.astype(np.float32), b)

    def test_grs_table(self):
        rows = ["-2.5  2.5  4.000  0.500  0.600", "-2.5  7.5  9999.999  9999.999  9999.999", " 87.5 357.5 3.000 0.4 9999.999"]
        with tempfile.NamedTemporaryFile('w', delete=False) as f:
            f.write("\n".join(rows))
        c, s = surface_props.grs_table(f.name, 5)
        self.assertEqual(c.shape, (36, 72))
        self.assertAlmostEqual(c[18, 0], 4.0); self.assertAlmostEqual(s[18, 0], 0.6)   # sigma-with-CFS preferred
        self.assertTrue(np.isnan(c[18, 1]))                                            # NA constant -> NaN, not 0
        self.assertAlmostEqual(c[0, 71], 3.0); self.assertAlmostEqual(s[0, 71], 0.4)   # falls back to sigma

    def test_block_reduce_nodata(self):
        a = np.array([[1, 2, -1, -1], [3, 4, -1, -1]], float)
        r = block_reduce(a, 2, 'mean', nodata=-1)
        self.assertAlmostEqual(r[0, 0], 2.5); self.assertTrue(np.isnan(r[0, 1]))


class TestTerrain(unittest.TestCase):
    def test_slope_of_known_plane(self):
        ppd = 16; H, W = 64, 64
        lat = 90 - (np.arange(H) + 0.5) / ppd                      # near pole rows are irrelevant: use equatorial strip
        dy = MARS_R_M * math.radians(1 / ppd)
        dem = np.tile((np.arange(H)[::-1] * dy * math.tan(math.radians(5)))[:, None], (1, W)).astype(np.float32)
        s = mola.slope_deg(dem, ppd)
        self.assertAlmostEqual(float(np.median(s[2:-2])), 5.0, delta=0.05)

    def test_dbf_reader_real_file(self):
        p = '/home/claude/raw/nomen/MARS_nomenclature_center_pts.dbf'
        if not os.path.exists(p):
            self.skipTest('gazetteer not present')
        fields, rows = ice_names_rovers.read_dbf(p)
        names = {r['clean_name']: r for r in rows}
        self.assertIn('Olympus Mons', names)
        self.assertAlmostEqual(names['Olympus Mons']['center_lat'], 18.65, delta=0.1)

    def test_geology_age_parsing(self):
        self.assertEqual(geology.age_of('lApc')[0], 'Late Amazonian')
        self.assertEqual(geology.age_of('HNt')[0], 'Hesperian and Noachian')
        self.assertEqual(geology.age_of('eNh')[0], 'Early Noachian')


class TestPackage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.load(open(os.path.join(PKG, 'manifest.json'), encoding='utf-8'))

    def test_every_grid_file_matches_its_metadata(self):
        size = {'int16': 2, 'uint16': 2, 'uint8': 1, 'float32': 4}
        for L in self.m['layers']:
            g = L['grid']
            if not g:
                self.assertEqual(L['status'], 'modeled', L['id']); continue
            raw = _read_gz(PKG, g['file'])
            self.assertEqual(len(raw), g['width'] * g['height'] * size[g['dtype']], L['id'])
            self.assertEqual(g['width'], round(360 * g['ppd']), L['id'])

    def test_provenance_complete(self):
        for L in self.m['layers']:
            for k in ('status', 'source', 'coverage', 'resolution_km', 'units', 'processing', 'limitations', 'confidence', 'crs'):
                self.assertTrue(L.get(k) not in (None, ''), f"{L['id']} missing {k}")
            self.assertTrue(L['source'].get('org'), L['id'])
            self.assertIn(L['status'], ('measured', 'published', 'derived', 'modeled', 'inferred', 'synthetic'))

    def test_no_synthetic_data(self):
        self.assertEqual(self.m['synthetic'], [])
        self.assertFalse(any(L['status'] == 'synthetic' for L in self.m['layers']))

    def test_unavailable_registered_with_reasons(self):
        self.assertTrue(all(u['reason'] for u in self.m['unavailable']))

    def test_dem_values_plausible(self):
        g = next(L['grid'] for L in self.m['layers'] if L['id'] == 'dem')
        a = np.frombuffer(_read_gz(PKG, g['file']), '<i2').reshape(g['height'], g['width'])
        self.assertGreater(a.max(), 20000); self.assertLess(a.min(), -8000)
        # Hellas basin (42.4S, 70.5E) is lower than Tharsis (0, 247E)
        self.assertLess(a[int((90 + 42.4) * 8), int(70.5 * 8)], a[int(90 * 8), int(247 * 8)])

    def test_swim_outside_coverage_is_nodata(self):
        g = next(L['grid'] for L in self.m['layers'] if L['id'] == 'swim01')
        a = np.frombuffer(_read_gz(PKG, g['file']), '<i2').reshape(g['height'], g['width'])
        self.assertTrue((a[:100] == -32768).all())      # north of ~65N: not mapped by SWIM -> nodata, never 0

    def test_rover_images_positioned(self):
        rv = json.load(open(os.path.join(PKG, 'rovers.json'), encoding='utf-8'))
        for im in rv['images']:
            self.assertTrue(os.path.exists(os.path.join(PKG, 'img', im['file'])))
            self.assertAlmostEqual(im['rover_lat'], 18.4, delta=0.5)      # all Perseverance images are in/near Jezero
            self.assertEqual(im['target_location'], 'not computed (no range data)')


if __name__ == '__main__':
    unittest.main()
