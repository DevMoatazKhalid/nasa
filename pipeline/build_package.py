"""Assemble the web data package + central data registry (manifest.json).

Every layer the app can show or query is described here: source organisation, URL/DOI,
instrument, product, dates, coverage, resolution, units, CRS, processing, data status,
limitations and confidence. Datasets that were investigated but could NOT be integrated are
registered too (status 'unavailable') so the interface can say so instead of inventing values.

Grids are gzip-compressed (*.bin.gz); the browser inflates them with DecompressionStream.
"""
import gzip, json, os, shutil, sys
from common import save_json

CRS = 'Mars 2000 sphere, planetocentric lat, east-positive lon 0-360, simple cylindrical'


def gz(src, dst):
    with open(src, 'rb') as f, gzip.open(dst, 'wb', compresslevel=9) as g:
        shutil.copyfileobj(f, g)
    return os.path.getsize(dst)


def L(**k):
    k.setdefault('crs', CRS)
    return k


def main(proc, out):
    os.makedirs(out, exist_ok=True)
    mola = json.load(open(os.path.join(proc, 'mola_meta.json')))
    surf = json.load(open(os.path.join(proc, 'surface_meta.json')))
    inr = json.load(open(os.path.join(proc, 'ice_names_rovers_meta.json')))
    geo = json.load(open(os.path.join(proc, 'geology_units.json')))
    crat = json.load(open(os.path.join(proc, 'craters_meta.json')))

    MOLA_SRC = dict(org='NASA GSFC / MGS MOLA Science Team; archived at PDS Geosciences Node (WUSTL)',
                    url='https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
                    doi='10.17189/1519460', instrument='MGS Mars Orbiter Laser Altimeter (MOLA)',
                    product='MEGDR MEGT90N000EB (16 ppd median topography, v2.0)',
                    acquired='1997-09-15 to 2001-06-30', processed_by_source='2003-04-03')
    TES = dict(org='Arizona State University, Mars Space Flight Facility (MGS TES)',
               url='https://www.mars.asu.edu/data/', instrument='MGS Thermal Emission Spectrometer (TES)')
    layers = [
        L(id='dem', group='terrain', status='published', name='Elevation (MOLA)', name_ar='الارتفاع (MOLA)',
          source=MOLA_SRC, grid=mola['dem'], resolution_km=7.4, coverage='global',
          temporal='static (1997-2001 mapping)', units='m above MOLA areoid',
          processing='16 ppd MEGDR block-averaged 2x2 to 8 ppd. Source values otherwise unchanged.',
          limitations='Cells near the equator are partly interpolated in the source (~55% of 16 ppd bins hold a shot). 7.4 km cells hide local relief.',
          confidence='high', legend=dict(ramp='elev', min=-8000, max=21000)),
        L(id='slope', group='terrain', status='derived', name='Slope', name_ar='الانحدار',
          source=MOLA_SRC, grid=mola['slope'], resolution_km=7.4, coverage='global', temporal='static', units='degrees',
          processing='Central-difference gradient on the 16 ppd (~3.7 km) DEM with metric pixel spacing, maximum of the 2x2 block retained (conservative).',
          limitations='A 3.7 km baseline strongly under-estimates metre-scale slopes; values >~5 deg already indicate rugged terrain. Not a rover-traverse safety product.',
          confidence='medium', legend=dict(ramp='hazard', min=0, max=15)),
        L(id='rough', group='terrain', status='derived', name='Terrain roughness', name_ar='خشونة التضاريس',
          source=MOLA_SRC, grid=mola['rough'], resolution_km=7.4, coverage='global', temporal='static', units='m (local std. dev.)',
          processing='Standard deviation of elevation in a 3x3 window at 16 ppd, averaged to 8 ppd.',
          limitations='Kilometre-scale relief index only; boulder- and dune-scale roughness are not represented.',
          confidence='medium', legend=dict(ramp='hazard', min=0, max=400)),
        L(id='crater_density', group='terrain', status='derived', name='Crater density (≥1 km)', name_ar='كثافة الفوهات',
          source=dict(org='Robbins & Hynek (2012), Mars crater database 2020 release (user-supplied CSV)',
                      url='https://doi.org/10.1029/2011JE003966', doi='10.1029/2011JE003966',
                      product='Catalog_Mars_Release_2020_1kmPlus_FullMorphData.csv'),
          grid=dict(file='crater_density_1deg.bin', dtype='float32', width=360, height=180, ppd=1, lon0=0, lat0=90,
                    scale=1, offset=0, nodata=None, units='craters per 10^4 km2'),
          resolution_km=59, coverage='global', temporal='static', units='craters ≥1 km per 10,000 km²',
          processing='Crater centres binned per 1° cell and divided by true spherical cell area.',
          limitations='Uses crater centres only (no rim polygons). Density reflects surface age as well as hazard.',
          confidence='high', legend=dict(ramp='hazard', min=0, max=80)),
        L(id='ti', group='environment', status='published', name='Thermal inertia (TES)', name_ar='القصور الحراري',
          source=dict(TES, product='TES_Thermal_Inertia_numeric (Christensen et al. 2001)', doi='10.1029/2000JE001370',
                      acquired='1997-2003'),
          grid=surf['TES_Thermal_Inertia_numeric'], resolution_km=7.4, coverage='~78% (no data poleward of ~60-80°)',
          temporal='multi-year composite', units='J m⁻² K⁻¹ s⁻½ (tiu)',
          processing='ASU numeric product is an 8-bit stretch (256 levels) clipped to 27-602 tiu; floor value 25 masked as polar no-data after latitude-band verification.',
          limitations='Surface property, NOT temperature. Values above ~602 tiu are clipped in this product.',
          confidence='medium', legend=dict(ramp='seq', min=30, max=600)),
        L(id='albedo', group='environment', status='published', name='Albedo (TES Lambert)', name_ar='الوضاءة',
          source=dict(TES, product='TES_Lambert_Albedo_numeric', doi='10.1029/2000JE001370'),
          grid=surf['TES_Lambert_Albedo_numeric'], resolution_km=7.4, coverage='~97%', temporal='multi-year composite', units='unitless',
          processing='8-bit stretch (0.08-0.32) from ASU; floor 0.08 masked as no-data at the poles.',
          limitations='Bright = dusty in most mid-latitude regions; polar frost contaminates high latitudes.',
          confidence='medium', legend=dict(ramp='grey', min=0.09, max=0.32)),
        L(id='dci', group='environment', status='published', name='Dust cover index (TES)', name_ar='مؤشر الغطاء الغباري',
          source=dict(TES, product='TES_dust_index_16ppd_numeric (Ruff & Christensen 2002)', doi='10.1029/2001JE001580'),
          grid=surf['TES_dust_index_16ppd_numeric'], resolution_km=7.4, coverage='~79%', temporal='multi-year composite', units='emissivity index',
          processing='Resampled by the ASU map server from 16 to 8 ppd; floor 0.85 masked as polar no-data.',
          limitations='Lower values (<~0.94) indicate dust-mantled surfaces. Describes surface dust cover, not atmospheric dust or storms.',
          confidence='medium', legend=dict(ramp='seq_r', min=0.92, max=0.985)),
        L(id='rock', group='environment', status='published', name='Rock abundance (TES)', name_ar='وفرة الصخور',
          source=dict(TES, product='tes_rock_abundance_filled_numeric (Nowicki & Christensen 2007)', doi='10.1029/2006JE002798'),
          grid=surf['tes_rock_abundance_filled_numeric'], resolution_km=15, coverage='global (gap-filled)', temporal='composite',
          units='% of surface covered by rocks', processing='Re-expressed on the shared grid; values unchanged.',
          limitations='"Filled" product interpolates gaps. Rocks are >~0.1-0.15 m blocks inferred thermally.',
          confidence='medium', legend=dict(ramp='hazard', min=0, max=30)),
        L(id='rad', group='environment', status='modeled', name='GCR dose rate (model)', name_ar='جرعة الإشعاع الكوني (نموذج)',
          source=dict(org='Model in this platform, anchored to MSL RAD (Hassler et al. 2014) and the column-depth dependence of Guo et al. (2017)',
                      url='https://doi.org/10.1002/2016JE005206', doi='10.1126/science.1244797; 10.1002/2016JE005206',
                      instrument='MSL Radiation Assessment Detector (anchor only)'),
          grid=None, derived_from='dem', resolution_km=7.4, coverage='global', temporal='solar-cycle average; not live',
          units='mGy/day (absorbed, GCR, surface)',
          processing='column = P0·exp(-z/H)/g with P0=610 Pa, H=11.1 km, g=3.71 m/s²; dose = 0.21 mGy/day × (1 − k·(column − 22.9 g/cm²)), k = 0.015 per g/cm² (range 0.010-0.020).',
          limitations='GCR only — excludes solar particle events (see SEP study in sources). Ignores seasonal pressure cycle, terrain shielding and solar modulation (±~30%). Valid only as a relative indicator.',
          confidence='low', legend=dict(ramp='hazard', min=0.17, max=0.30)),
        L(id='swim01', group='resources', status='published', name='Ice consistency 0-1 m (SWIM)', name_ar='توافق الجليد ٠-١ م (SWIM)',
          source=dict(org='Mars Subsurface Water Ice Mapping (SWIM), Planetary Science Institute', url='https://swim.psi.edu/SWIM4MIMProducts.php',
                      doi='10.1038/s41550-020-01290-z; 10.3847/PSJ/ad9b24', product='SWIM4MIM Combined Ice Consistency Map (0-1 m), GeoTIFF',
                      instrument='Composite: Odyssey neutron, thermal, geomorphology, SHARAD radar surface power'),
          grid=inr['swim']['0_1'], resolution_km=15, coverage='60°S-60°N', temporal='static composite (2025 release)',
          units='consistency −1 (inconsistent) … +1 (consistent with ice)',
          processing='20 ppd GeoTIFF block-averaged 5x5 to 4 ppd and shifted to 0-360°E.',
          limitations='Consistency with ice is not confirmation of ice. Not mapped poleward of 60°.',
          confidence='medium', legend=dict(ramp='div', min=-1, max=1)),
        L(id='swim15', group='resources', status='published', name='Ice consistency 1-5 m (SWIM)', name_ar='توافق الجليد ١-٥ م',
          source=dict(org='SWIM, Planetary Science Institute', url='https://swim.psi.edu/SWIM4MIMProducts.php', doi='10.3847/PSJ/ad9b24',
                      product='SWIM4MIM Combined Ice Consistency Map (1-5 m)', instrument='Composite incl. SHARAD dielectric estimates'),
          grid=inr['swim']['1_5'], resolution_km=15, coverage='60°S-60°N', temporal='static composite', units='consistency −1…+1',
          processing='As 0-1 m map.', limitations='As 0-1 m map; radar dielectric inputs are sparse.', confidence='medium',
          legend=dict(ramp='div', min=-1, max=1)),
        L(id='swim5', group='resources', status='published', name='Ice consistency >5 m (SWIM)', name_ar='توافق الجليد >٥ م',
          source=dict(org='SWIM, Planetary Science Institute', url='https://swim.psi.edu/SWIM4MIMProducts.php', doi='10.3847/PSJ/ad9b24',
                      product='SWIM4MIM Combined Ice Consistency Map (>5 m)'),
          grid=inr['swim']['5'], resolution_km=15, coverage='60°S-60°N', temporal='static composite', units='consistency −1…+1',
          processing='As 0-1 m map.', limitations='Deep geomorphology + radar only.', confidence='low-medium',
          legend=dict(ramp='div', min=-1, max=1)),
        L(id='grs_h2o', group='resources', status='published', name='Water-equivalent hydrogen (GRS)', name_ar='الهيدروجين المكافئ للماء',
          source=dict(org='Univ. of Arizona / Mars Odyssey GRS team; PDS Geosciences Node', url='https://pds-geosciences.wustl.edu/missions/odyssey/grs_elements.html',
                      doi='10.17189/1519480', instrument='Mars Odyssey Gamma Ray Spectrometer', product='H2O_SR_5X5.TAB (ODY-M-GRS-5-ELEMENTS-V1.0)',
                      acquired='2002-06-04 to 2005-04-03'),
          grid=surf['grs_h2o_5'], resolution_km=300, coverage='~±57° (polar regions masked by source)', temporal='2002-2005 average',
          units='wt% H2O equivalent (upper ~1 m)', processing='5°x5° smoothed bins placed on a 0.2 ppd grid; 1σ uncertainty kept.',
          limitations='Hydrogen may be bound in hydrated minerals — NOT direct evidence of ice. Footprint ~ hundreds of km.',
          confidence='medium', legend=dict(ramp='seq', min=2, max=8)),
        L(id='ns_epi', group='resources', status='published', name='Epithermal neutrons (Odyssey NS)', name_ar='النيوترونات فوق الحرارية',
          source=dict(org='Los Alamos NL / Mars Odyssey NS; served by ASU MSFF', url='https://www.mars.asu.edu/data/',
                      instrument='Mars Odyssey Neutron Spectrometer', product='NS_Epithermal_numeric'),
          grid=surf['NS_Epithermal_numeric'], resolution_km=30, coverage='global (incl. poles)', temporal='multi-year average',
          units='counts/s (lower = more hydrogen)', processing='Values unchanged; −32768 masked.',
          limitations='Indirect hydrogen proxy with ~600 km footprint; the grid is finer than the physical resolution.',
          confidence='medium', legend=dict(ramp='seq_r', min=1.5, max=10)),
    ]
    minerals = [('TES_Hematite_numeric', 'hematite', 'Hematite', 'الهيماتيت'), ('TES_Olivine_numeric', 'olivine', 'Olivine', 'الأوليفين'),
                ('TES_Sulfate_numeric', 'sulfate', 'Sulfate', 'الكبريتات'), ('TES_Glass_Clay_numeric', 'glassclay', 'Glass / clay (high-Si)', 'الزجاج/الطين'),
                ('TES_Carbonate_numeric', 'carbonate', 'Carbonate', 'الكربونات'), ('TES_Feldspar_numeric', 'feldspar', 'Plagioclase feldspar', 'الفلسبار'),
                ('TES_Clinopyroxene_numeric', 'cpx', 'High-Ca pyroxene', 'البيروكسين')]
    for key, mid, nm, ar in minerals:
        layers.append(L(id=mid, group='resources', status='published', name=f'{nm} abundance (TES)', name_ar=f'وفرة {ar}',
                        source=dict(TES, product=key + ' (Bandfield 2002 spectral unmixing)', doi='10.1029/2001JE001510'),
                        grid=surf[key], resolution_km=15, coverage='~72% (dusty regions and poles excluded)', temporal='composite',
                        units='areal fraction', processing='Values unchanged; −1 masked.',
                        limitations='Spectral deconvolution abundances ±~0.05-0.10; detection limit ~0.10-0.15 for many phases. Not ore grades.',
                        confidence='low-medium', legend=dict(ramp='seq', min=0, max=0.15)))
    layers.append(L(id='geology', group='geology', status='derived', name='Geologic units (SIM 3292)', name_ar='الوحدات الجيولوجية',
                    source=dict(org='USGS Astrogeology — Tanaka et al. (2014), Geologic Map of Mars, SIM 3292', doi='10.3133/sim3292',
                                url='https://astrogeology.usgs.gov/pygeoapi/collections/mars/sim3292_global_geologic_map/units',
                                product='SIM3292 units (1,311 polygons, 1:20M)'),
                    grid=geo['grid'], resolution_km=7.4, coverage='global', temporal='static', units='categorical unit',
                    processing='Polygons rasterised at 8 ppd (point-in-polygon at cell centres, holes respected).',
                    limitations='1:20,000,000 map: contacts accurate to tens of km. Unit ages from crater statistics.',
                    confidence='high (at map scale)', legend=dict(ramp='cat')))
    unavailable = [
        dict(id='mcs_dust', name='Atmospheric dust opacity / storms (MCS)', reason='MCS retrievals are along-track vertical profiles (DDR/EDR). No gridded, time-resolved product could be retrieved and validated in this build; the 2018 storm is covered by the user-supplied papers only.',
             url='https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/aerosols.html'),
        dict(id='sharad', name='SHARAD radargrams', reason='Radargrams require per-track interpretation; integrated indirectly through the SWIM composite which uses SHARAD surface power and dielectric estimates.', url='https://sharad.psi.edu/'),
        dict(id='crism', name='CRISM targeted observations / MTRDR', reason='Footprint-level products are tens of GB; not retrievable here. TES global mineral abundances are used instead and labelled with their detection limits.', url='https://pds-geosciences.wustl.edu/missions/mro/crism.htm'),
        dict(id='temp', name='Gridded surface temperature', reason='No gridded temperature product integrated. Thermal inertia is a material property, not temperature. Survival module uses published RAD/REMS ranges.', url=''),
        dict(id='rad_rdr', name='RAD RDR time series', reason='PDS PPI RDR tables not retrieved; the radiation model is anchored to published RAD results instead.', url='https://search-pdsppi.igpp.ucla.edu/ditdos/readme?id=pds://PPI/MSL-M-RAD-3-RDR-V1.0'),
        dict(id='soil_eng', name='Soil engineering properties (cohesion, bearing capacity)', reason='No global measured dataset exists. Values in reports are labelled as literature ranges from rover sites.', url=''),
    ]
    vectors = dict(
        craters=dict(file='craters.bin', meta=crat, status='published',
                     source=dict(org='Robbins & Hynek 2012 (2020 release), user-supplied', doi='10.1029/2011JE003966')),
        names=dict(file='names.json', status='published', count=inr['names_count'],
                   source=dict(org='IAU WGPSN / USGS Gazetteer of Planetary Nomenclature', url='https://planetarynames.wr.usgs.gov/GIS_Downloads')),
        rovers=dict(file='rovers.json', status='measured', images=inr['images'],
                    source=dict(org='NASA/JPL MMGIS (Mars 2020, MSL localization) and NASA raw image API',
                                url='https://mars.nasa.gov/mars2020/multimedia/raw-images/')),
        geology_units=dict(file='geology_units.json'))
    # copy + compress
    sizes = {}
    files = set()
    for l in layers:
        if l.get('grid'):
            files.add(l['grid']['file'])
            if l['grid'].get('sigma_file'):
                files.add(l['grid']['sigma_file'])
    files |= {'craters.bin', 'dem_2ppd.bin'}
    for f in sorted(files):
        sizes[f + '.gz'] = gz(os.path.join(proc, f), os.path.join(out, f + '.gz'))
    for f in ('names.json', 'rovers.json', 'geology_units.json', 'basemap_8ppd.jpg'):
        shutil.copy(os.path.join(proc, f), os.path.join(out, f)); sizes[f] = os.path.getsize(os.path.join(out, f))
    if os.path.isdir(os.path.join(proc, 'img')):
        shutil.copytree(os.path.join(proc, 'img'), os.path.join(out, 'img'), dirs_exist_ok=True)
    manifest = dict(version='1.0', built='2026-11-14', grid_convention=CRS + '; row 0 = north edge, col 0 = 0°E',
                    radius_km=3389.5, layers=layers, vectors=vectors, unavailable=unavailable,
                    synthetic=[], note='No synthetic data is used in this build.', overview_dem=mola['dem2'])
    save_json(os.path.join(out, 'manifest.json'), manifest)
    tot = sum(sizes.values())
    print(json.dumps(sizes, indent=1)); print('total MB', round(tot / 1e6, 1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
