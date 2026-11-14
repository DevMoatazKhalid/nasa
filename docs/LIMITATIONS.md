# Scientific limitations

**Resolution.** Elevation, slope and roughness are on an 8 ppd grid (~7.4 km). Slope is computed on a 3.7 km baseline and badly underestimates metre-scale slopes, so routes are strategic corridors only. Mission candidates are scored on 1° cells (~59 km at the equator).

**Water ice.** SWIM ice-consistency maps (60°S–60°N) are composites of indirect evidence: consistency with ice is not confirmation of ice. GRS water-equivalent hydrogen (5° bins, polar regions masked by the source) can come from hydrated minerals. Odyssey epithermal neutron counts are a hydrogen proxy with a ~600 km footprint; the north residual cap shows relatively high counts in this multi-season product. Only mapped polar cap and polar layered deposit units (lApc, Ap) and polar neutron suppression are classed as *strong* evidence.

**Radiation.** Modeled, GCR-only. The model is anchored to RAD at Gale (0.21 ± 0.04 mGy/day) and scaled by atmospheric column depth (Guo et al. 2017, 1–2 %/g cm⁻²). It ignores solar-cycle modulation (±~30 %, shown as a range), seasonal pressure, terrain shielding and solar particle events.

**Thermal inertia and albedo.** The ASU numeric products are 8-bit stretches: 256 levels, TI clipped at 602 tiu and albedo at 0.32. Floor values at high latitudes are masked as no-data. Thermal inertia is a material property, not temperature.

**Minerals.** TES spectral-unmixing abundances (~16 km) have detection limits around 0.10–0.15 areal fraction. They indicate surface mineralogy, not ore grades. CRISM and OMEGA footprint-level detections are not integrated.

**Geology.** SIM 3292 is a 1:20,000,000 map, rasterised at 8 ppd. Contacts are accurate to tens of kilometres.

**Craters.** The catalogue gives centres and diameters only. "Inside a crater" is a centre-distance test.

**Not integrated.** These are listed with reasons in the app:
- MCS dust and temperature profiles
- SHARAD radargrams (used only via SWIM)
- CRISM/OMEGA cubes
- Gridded surface temperature
- RAD RDR time series
- Soil engineering properties
- THEMIS mosaics and Trek tiles (the hosting environment cannot load remote tiles)

**Images.** 32 real Perseverance raw images are placed at the rover's waypoint by matching site and drive. Their target locations are *not* computed because range data is unavailable; the mast azimuth is reported instead.

**Time.** All observations are archival. The rover "last positions" are the latest localisations in the downloaded MMGIS files (Perseverance sol 2022, Curiosity sol 5073), not live positions.

**Prototypes.** The two HTML prototypes named in the brief were not present in the supplied export or locally, so they could not be reviewed.
