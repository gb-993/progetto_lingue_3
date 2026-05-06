#!/usr/bin/env bash

if test "$#" -ne 1 ; then
    echo -e "Usage:\n\t${0} INPUT_DIR" >&2
    exit 1
fi
if ! test -d "${1}"; then
    echo -e "Error:\tINPUT_DIR=${1} not found" >&2
    exit 2
fi

DATASET_DIR="${1}"
INPUT_FILE_LIST=$(cd "${DATASET_DIR}" && ls -v1 0[1234]_*.xlsx | fgrep -v "~")
PLOT_SCRIPT="${PLOT_SCRIPT:-src/02_carta_diocesi.py}"
SHAPEFILE="${SHAPEFILE:-shapefile_diocese_cipro_close/cipro.shp}"

echo "Using PLOT_SCRIPT=${PLOT_SCRIPT}" >&2
echo "Using SHAPEFILE=${SHAPEFILE}" >&2

sleep 3

PLOT_DIR="out_plot"
PREPROCESSED_DIR="out_preprocess"
PYTHON_FILE_MAP="${PLOT_SCRIPT}"
SCRIPT_DIR="src"

rm -rf   ${PREPROCESSED_DIR} ${PLOT_DIR}
mkdir -p ${PREPROCESSED_DIR} ${PLOT_DIR}

# Preprocess all dataset with knn-imputer
for file in ${INPUT_FILE_LIST}; do
    python3 ${SCRIPT_DIR}/preprocessing.py        \
        -i ${DATASET_DIR}"/"${file}               \
        -o ${PREPROCESSED_DIR}"/"${file}          \
        -k 5                                      \
        -v                                        \
    || exit 1;
done

python3 ${SCRIPT_DIR}/01_plot_clusters.py         \
    -i ${PREPROCESSED_DIR}                        \
    -o ${PLOT_DIR}                                \
    -p                                            \
    -v                                            \
|| exit 2

for extra_args in                                 \
    "--do-areas False --do-markers True"          \
    "--do-areas True  --do-markers False"         \
    "--do-areas True  --do-markers True"          ;
do
    SUBPLOT_DIR="${PLOT_DIR}/${extra_args}"
    mkdir -p "${SUBPLOT_DIR}"
    python3 ${PYTHON_FILE_MAP}                            \
        -i ${PLOT_DIR}/clusters.txt                       \
        -o "${SUBPLOT_DIR}"/mappa_clusters.pdf            \
        -m "${SHAPEFILE}"                                 \
        -v                                                \
        ${extra_args}                                     \
    || exit 3

    for i in `seq 0 3`; do
        if [ -f ${PLOT_DIR}/clusters_${i}.txt ]; then
            python3 ${PYTHON_FILE_MAP}                        \
                -i ${PLOT_DIR}/clusters_${i}.txt              \
                -o "${SUBPLOT_DIR}"/mappa_clusters_${i}.pdf   \
                -m "${SHAPEFILE}"                             \
                -v                                            \
                ${extra_args}                                 \
            || exit 4;
        fi
    done
done

find "${PLOT_DIR}" -iname '*_0*' -execdir rename -v 's/.*_0\./01_Pellegrini_1970./' {} +
find "${PLOT_DIR}" -iname '*_1*' -execdir rename -v 's/.*_1\./02_Pellegrini_1977./' {} +
find "${PLOT_DIR}" -iname '*_2*' -execdir rename -v 's/.*_2\./03_SSWL./' {} +
find "${PLOT_DIR}" -iname '*_3*' -execdir rename -v 's/.*_3\./04_TableA_2025_SI./' {} +
find "${PLOT_DIR}" -iname '*_clusters.*' -execdir rename -v 's/.*_clusters\./Four Tables fused./' {} +

mkdir -p "${PLOT_DIR}/dendrograms"
mv "${PLOT_DIR}/"*.svg "${PLOT_DIR}/dendrograms/"

mkdir -p "${PLOT_DIR}/clusters"
mv -v "${PLOT_DIR}/clusters.txt" "${PLOT_DIR}/clusters/Four Tables fused.txt"
mv -v "${PLOT_DIR}/"*.txt        "${PLOT_DIR}/clusters/"

mv -v "${PLOT_DIR}/"*areas*False*markers*True    "${PLOT_DIR}/only_markers"
mv -v "${PLOT_DIR}/"*do-areas*True*markers*False "${PLOT_DIR}/only_areas"
if echo "${SHAPEFILE}" | fgrep -i new; then
    mv -v "${PLOT_DIR}/"*areas*True*markers*True "${PLOT_DIR}/markers_with_distinct_areas"
else
    mv -v "${PLOT_DIR}/"*areas*True*markers*True "${PLOT_DIR}/markers_with_overlapping_areas"
fi
