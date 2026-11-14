#!/usr/bin/env bash
# Rebuild the processed data + web data package from source files.
# Usage: pipeline/run_all.sh <downloads_dir> <crater_csv> <swim_dir> <names_dir>
#   downloads_dir : folder holding MESIS_* source files (MOLA .img, ASU .vic, GRS .tab, SIM3292 geojson, MMGIS json, images)
set -euo pipefail
cd "$(dirname "$0")/.."
DL=${1:?downloads dir}; CSV=${2:?crater csv}; SWIM=${3:?unzipped SWIM dir}; NAMES=${4:?unzipped nomenclature dir}
OUT=data/processed; mkdir -p "$OUT"
python3 pipeline/craters.py "$CSV" "$OUT"
python3 pipeline/mola.py "$DL/MESIS_megt90n000eb.img" "$OUT"
python3 pipeline/surface_props.py "$DL" "$OUT"
python3 pipeline/geology.py "$DL/MESIS_sim3292_units.geojson" "$OUT"
python3 pipeline/ice_names_rovers.py "$SWIM" "$NAMES" "$DL" "$OUT"
python3 pipeline/build_package.py "$OUT" web/public/data
echo "Data package ready in web/public/data"
