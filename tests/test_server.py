"""API tests: python3 -m unittest tests/test_server.py  (requires a built web/dist)"""
import json, os, sys, threading, unittest, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import server  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

class TestAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dist = os.path.join(ROOT, 'web', 'dist')
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.make_handler(server.Package(os.path.join(ROOT, 'web', 'public', 'data') if os.path.exists(os.path.join(ROOT, 'web', 'public', 'data', 'dem_8ppd.bin.gz')) else os.path.join(dist, 'data')), dist))
        cls.base = f'http://127.0.0.1:{cls.srv.server_address[1]}'
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()
    def get(self, p):
        try: return json.load(urllib.request.urlopen(self.base + p))
        except urllib.error.HTTPError as e: return {'_code': e.code, **json.load(e)}
    def test_health(self): self.assertTrue(self.get('/api/health')['ok'])
    def test_point_jezero(self):
        v = self.get('/api/point?lat=18.44&lon=77.45')['values']
        self.assertAlmostEqual(v['dem']['value'], -2554, delta=300); self.assertEqual(v['dem']['status'], 'published')
    def test_point_missing_is_null(self):
        v = self.get('/api/point?lat=85&lon=30')['values']['ti']
        self.assertIsNone(v['value']); self.assertEqual(v['status'], 'unavailable')
    def test_negative_longitude_wraps(self):
        a = self.get('/api/point?lat=-4.6&lon=-222.56')['values']['dem']['value']; b = self.get('/api/point?lat=-4.6&lon=137.44')['values']['dem']['value']
        self.assertEqual(a, b)
    def test_bad_input(self): self.assertEqual(self.get('/api/point?lat=99&lon=0')['_code'], 400)
    def test_craters_gale(self):
        c = self.get('/api/craters?lat=-5.37&lon=137.81&km=10')['craters']
        self.assertTrue(any(abs(x['diameter_km'] - 154) < 5 for x in c))

if __name__ == '__main__': unittest.main()
