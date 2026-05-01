from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import io
import csv
import math
import zipfile
from itertools import combinations
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg') # Necessario per il rendering server-side
import matplotlib.pyplot as plt
from scipy.cluster.hierarchy import linkage, dendrogram
from scipy.spatial.distance import squareform
from scipy.stats import pearsonr, spearmanr, kendalltau
import plotly.express as px
from openpyxl import Workbook
from adjustText import adjust_text

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/tablea", tags=["Table A"])

# --- SCHEMI PYDANTIC ---
class TableAFilterRequest(BaseModel):
    view: str = "params"
    f_lang_top_family: Optional[str] = ""
    f_lang_family: Optional[str] = ""
    f_lang_grp: Optional[str] = ""
    f_lang_hist: Optional[str] = "all"
    f_lang_specific: List[str] = []
    f_p_schema: Optional[str] = ""
    f_p_type: Optional[str] = ""
    f_p_level: Optional[str] = ""
    f_q_template: Optional[str] = ""
    f_q_stop: Optional[str] = "all"
    selected_ids: List[str] = []


class MantelRequest(TableAFilterRequest):
    include_gcd: bool = True
    include_hamming: bool = True
    include_jaccard: bool = True

# --- FUNZIONI CORE (PORTING MATEMATICO ESATTO) ---

def _hamming_core(P1, P2) -> float:
    """Calcola distanza di Hamming su simboli + e -."""
    identities, differences = 0.0, 0.0
    for v1, v2 in zip(P1, P2):
        if v1 == v2 and v1 in ("+", "-"): identities += 1
        elif (v1 == "+" and v2 == "-") or (v1 == "-" and v2 == "+"): differences += 1
    return differences / (identities + differences) if (identities + differences) > 0 else 0.0

def _jaccard_core(P1, P2, identity="+") -> float:
    """Calcola distanza di Jaccard sull'identità scelta."""
    identities, differences = 0.0, 0.0
    for v1, v2 in zip(P1, P2):
        if v1 == v2 == identity: identities += 1
        elif (v1 == "+" and v2 == "-") or (v1 == "-" and v2 == "+"): differences += 1
    return differences / (identities + differences) if (identities + differences) > 0 else 0.0

def _get_filtered_data(db: Session, filters: TableAFilterRequest):
    """Replicazione esatta della logica get_tablea_filtered_data."""
    # 1. Filtro Lingue
    l_query = db.query(models.Language)
    if filters.f_lang_top_family: l_query = l_query.filter(models.Language.top_level_family == filters.f_lang_top_family)
    if filters.f_lang_family: l_query = l_query.filter(models.Language.family == filters.f_lang_family)
    if filters.f_lang_grp: l_query = l_query.filter(models.Language.grp == filters.f_lang_grp)
    if filters.f_lang_hist == "yes": l_query = l_query.filter(models.Language.historical_language == True)
    elif filters.f_lang_hist == "no": l_query = l_query.filter(models.Language.historical_language == False)
    if filters.f_lang_specific: l_query = l_query.filter(models.Language.id.in_(filters.f_lang_specific))

    languages = l_query.order_by(models.Language.position).all()
    lang_ids = [l.id for l in languages]

    # 2. Filtro Item (Parametri o Domande)
    matrix = []
    if filters.view == "questions":
        q_query = db.query(models.Question).join(models.ParameterDef).filter(
            models.ParameterDef.is_active == True,
            models.Question.is_active == True,
        )
        if filters.f_q_template: q_query = q_query.filter(models.Question.template_type == filters.f_q_template)
        if filters.f_q_stop == "yes": q_query = q_query.filter(models.Question.is_stop_question == True)
        elif filters.f_q_stop == "no": q_query = q_query.filter(models.Question.is_stop_question == False)
        if filters.selected_ids: q_query = q_query.filter(models.Question.id.in_(filters.selected_ids))

        items = q_query.order_by(models.ParameterDef.position, models.Question.id).all()
        item_ids = [q.id for q in items]
        ans = db.query(models.Answer).filter(models.Answer.question_id.in_(item_ids), models.Answer.language_id.in_(lang_ids)).all()
        ans_dict = {(a.question_id, a.language_id): (a.response_text or "").upper() for a in ans}

        for q in items:
            matrix.append({
                "id": q.id, "name": q.text, "extra": "",
                "cells": [ans_dict.get((q.id, lid), "") for lid in lang_ids]
            })
    else:
        p_query = db.query(models.ParameterDef).filter(models.ParameterDef.is_active == True)
        if filters.f_p_schema: p_query = p_query.filter(models.ParameterDef.schema == filters.f_p_schema)
        if filters.f_p_type: p_query = p_query.filter(models.ParameterDef.param_type == filters.f_p_type)
        if filters.f_p_level: p_query = p_query.filter(models.ParameterDef.level_of_comparison == filters.f_p_level)
        if filters.selected_ids: p_query = p_query.filter(models.ParameterDef.id.in_(filters.selected_ids))

        items = p_query.order_by(models.ParameterDef.position).all()
        item_ids = [p.id for p in items]
        # Query a colonne (niente lazy-load di e.language_parameter): evita
        # l'N+1 storico — con N lingue × M parametri si emetteva 1 SELECT per ogni eval.
        eval_rows = db.query(
            models.LanguageParameter.parameter_id,
            models.LanguageParameter.language_id,
            models.LanguageParameterEval.value_eval,
        ).join(
            models.LanguageParameterEval,
            models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id,
        ).filter(
            models.LanguageParameter.parameter_id.in_(item_ids),
            models.LanguageParameter.language_id.in_(lang_ids),
        ).all()
        ev_dict = {(p_id, l_id): val for (p_id, l_id, val) in eval_rows}

        for p in items:
            matrix.append({
                "id": p.id, "name": p.name, "extra": p.implicational_condition or "",
                "cells": [ev_dict.get((p.id, lid), "") for lid in lang_ids]
            })

    return languages, matrix

# ==========================================
# ENDPOINT: VISUALIZZAZIONE E TENDINE
# ==========================================

@router.get("/options")
def get_tablea_options(db: Session = Depends(get_db)):
    """Restituisce le opzioni univoche per popolare i filtri."""
    def distinct(col): return [r[0] for r in db.query(col).filter(col != None, col != "", col != "none").distinct().order_by(col).all()]
    return {
        "opt_top_families": distinct(models.Language.top_level_family),
        "opt_families": distinct(models.Language.family),
        "opt_groups": distinct(models.Language.grp),
        "opt_schemas": distinct(models.ParamSchema.label),
        "opt_types": distinct(models.ParamType.label),
        "opt_levels": distinct(models.ParamLevelOfComparison.label),
        "opt_templates": distinct(models.Question.template_type),
        "opt_all_languages": [{"id": l.id, "name": l.name_full} for l in db.query(models.Language).order_by(models.Language.name_full).all()]
    }

@router.post("/matrix")
def get_tablea_matrix(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    langs, rows = _get_filtered_data(db, filters)
    return {
        "languages": [{"id": l.id, "name": l.name_full} for l in langs],
        "rows": [{"item": {"id": r["id"], "name": r["name"], "extra": r["extra"]},
                  "cells": [{"lang_id": lid, "val": val} for lid, val in zip([l.id for l in langs], r["cells"])]}
                 for r in rows]
    }

# ==========================================
# ENDPOINT: EXPORT STANDARD (EXCEL/CSV)
# ==========================================

@router.post("/export/xlsx")
def export_tablea_xlsx(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    """Export XLSX standard con gestione colonne differenziata."""
    langs, rows = _get_filtered_data(db, filters)
    wb = Workbook()
    ws = wb.active

    # Intestazione specifica per vista
    if filters.view == "questions":
        ws.append(["Label", "Question text"] + [l.id for l in langs])
        for r in rows: ws.append([r["id"], r["name"]] + r["cells"])
    else:
        ws.append(["Label", "Parameter", "Implicational Condition(s)"] + [l.id for l in langs])
        for r in rows: ws.append([r["id"], r["name"], r["extra"]] + r["cells"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename=tableA_{filters.view}.xlsx"})

@router.post("/export/csv")
def export_tablea_csv(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    """Export CSV Trasposto: righe=lingue, colonne=parametri."""
    langs, rows = _get_filtered_data(db, filters)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Language"] + [r["id"] for r in rows])
    for i, l in enumerate(langs):
        writer.writerow([l.id] + [r["cells"][i] for r in rows])

    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=tableA_{filters.view}_transposed.csv"})

# ==========================================
# ENDPOINT: ANALISI COMPUTAZIONALE (ZIP/PNG)
# ==========================================

@router.post("/export/distances")
def export_distances_txt(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    """Genera le matrici di distanza tabulari in formato .txt."""
    if filters.view != "params": raise HTTPException(400, "Distances only for Parameters View")
    langs, rows = _get_filtered_data(db, filters)

    lang_vectors = [[r["cells"][i] for r in rows] for i in range(len(langs))]
    ids = [l.id for l in langs]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, func in [("hamming", _hamming_core), ("jaccard[+]", _jaccard_core)]:
            out = "Language\t" + "\t".join(ids) + "\n"
            for i, id1 in enumerate(ids):
                row_vals = [id1]
                for j, _ in enumerate(ids):
                    d = func(lang_vectors[i], lang_vectors[j])
                    row_vals.append(str(d))
                out += "\t".join(row_vals) + "\n"
            zf.writestr(f"{name}.txt", out)

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=distances_txt.zip"})

@router.post("/export/dendrograms")
def export_dendrograms_png(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    """Genera i Dendrogrammi con metodo 'average'."""
    langs, rows = _get_filtered_data(db, filters)
    lang_vectors = [[r["cells"][i] for r in rows] for i in range(len(langs))]
    labels = [l.id for l in langs]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, func, title in [
            ("hamming", _hamming_core, "Dendrogram, hamming, average"),
            ("jaccard[+]", _jaccard_core, "Dendrogram, jaccard[+], average")
        ]:
            dist_matrix = [[func(v1, v2) for v2 in lang_vectors] for v1 in lang_vectors]
            linkage_matrix = linkage(squareform(dist_matrix), method='average')

            plt.figure(figsize=(12, 8))
            dendrogram(linkage_matrix, labels=labels, orientation='top', distance_sort='descending', show_leaf_counts=True, color_threshold=0, above_threshold_color='black')
            plt.title(title)
            plt.xlabel("Languages")
            plt.ylabel("Distance")
            plt.tight_layout()

            img_buf = io.BytesIO()
            plt.savefig(img_buf, format='png', dpi=300, bbox_inches="tight")
            plt.close()
            zf.writestr(f"dendrogram_{name}_average.png", img_buf.getvalue())

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=dendrograms.zip"})

@router.post("/export/pca")
def export_pca_png(filters: TableAFilterRequest, db: Session = Depends(get_db)):
    """Analisi PCA via SVD manuale con etichette varianza esatte."""
    langs, rows = _get_filtered_data(db, filters)
    if not langs or len(rows) < 2: raise HTTPException(400, "Insufficient data for PCA")

    # Conversione numerica: + -> 1.0, altrimenti 0.0
    data = np.array([[1.0 if r["cells"][i] == "+" else 0.0 for r in rows] for i in range(len(langs))])

    # Rimuove varianza zero e standardizza
    data = data[:, np.var(data, axis=0) > 0]
    if data.shape[1] < 2: raise HTTPException(400, "Insufficient variance for PCA")
    data_std = (data - np.mean(data, axis=0)) / np.std(data, axis=0)

    # SVD manuale
    U, S, Vt = np.linalg.svd(data_std, full_matrices=False)
    f1, f2 = (U * S)[:, 0], (U * S)[:, 1]

    # Calcolo % varianza spiegata
    exp_var = (S ** 2) / (data_std.shape[0] - 1)
    total_v = np.sum(exp_var)
    v1_pct, v2_pct = (exp_var[0]/total_v)*100, (exp_var[1]/total_v)*100

    plt.figure(figsize=(12, 8))
    plt.scatter(f1, f2, c='black', s=10, alpha=0.75)
    texts = [plt.text(x, y, l.id, fontsize=9) for x, y, l in zip(f1, f2, langs)]
    adjust_text(texts, arrowprops=dict(arrowstyle='-', color='gray', lw=0.5))

    plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.75)
    plt.xlabel(f'F1 ({v1_pct:.2f}%)')
    plt.ylabel(f'F2 ({v2_pct:.2f}%)')
    plt.axhline(0, color='gray', lw=0.5); plt.axvline(0, color='gray', lw=0.5)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=300, bbox_inches="tight")
    plt.close()
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/png",
                    headers={"Content-Disposition": f"attachment; filename=pca_scatterplot_{filters.view}.png"})


# ==========================================
# ENDPOINT: MANTEL TEST (ZIP)
# ==========================================

def _gcd_nautical_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (miglia nautiche) via legge dei coseni.

    Porting esatto da gcd.py (Ceolin): conversione gradi→radianti, arrotondamento
    a 5 decimali per evitare argomenti >1 dell'acos dovuti al floating point,
    output gradi×60 (1° = 60 nautical miles).
    """
    x1, y1 = math.radians(lat1), math.radians(lon1)
    x2, y2 = math.radians(lat2), math.radians(lon2)
    cos_val = math.sin(x1) * math.sin(x2) + math.cos(x1) * math.cos(x2) * math.cos(y1 - y2)
    return 60.0 * math.degrees(math.acos(round(cos_val, 5)))


def _matrix_to_tsv(ids: List[str], mat: np.ndarray) -> str:
    """Serializza una matrice quadrata in TSV con header come gcd.py / distance.py."""
    lines = ["Language\t" + "\t".join(ids)]
    for i, id1 in enumerate(ids):
        lines.append(id1 + "\t" + "\t".join(str(mat[i, j]) for j in range(len(ids))))
    return "\n".join(lines) + "\n"


_CORR_FUNCS = {
    "pearson": lambda x, y: pearsonr(x, y)[0],
    "spearman": lambda x, y: spearmanr(x, y)[0],
    "kendalltau": lambda x, y: kendalltau(x, y)[0],
}


def _mantel_test(mat_a: np.ndarray, mat_b: np.ndarray, method: str,
                 permutations: int = 999, seed: int = 42):
    """Mantel test two-sided con permutation test (default skbio: 999 perm, seed=42).

    P-value = (count(|r_perm| >= |r_obs|) + 1) / (permutations + 1).
    Permuto contemporaneamente righe e colonne di B per preservare la simmetria.
    """
    n = mat_a.shape[0]
    iu = np.triu_indices(n, k=1)
    a_flat = mat_a[iu]
    b_flat = mat_b[iu]
    corr = _CORR_FUNCS[method]
    obs = corr(a_flat, b_flat)

    rng = np.random.default_rng(seed)
    count = 0
    abs_obs = abs(obs)
    for _ in range(permutations):
        perm = rng.permutation(n)
        b_perm = mat_b[perm][:, perm]
        r = corr(a_flat, b_perm[iu])
        if abs(r) >= abs_obs:
            count += 1
    p_value = (count + 1) / (permutations + 1)
    return obs, p_value, n


@router.post("/export/mantel")
def export_mantel_zip(filters: MantelRequest, db: Session = Depends(get_db)):
    """Mantel test su sottoinsieme di {GCD, Hamming, Jaccard[+]}.

    Restituisce uno zip con matrici .txt, scatterplot PNG (matplotlib) +
    HTML interattivi (plotly), e mantel_results.csv (pearson/spearman/kendalltau
    con permutation test 999 perm, seed=42, two-sided).
    """
    if filters.view != "params":
        raise HTTPException(400, "Mantel test only available for Parameters View")

    selected = []
    if filters.include_gcd: selected.append("gcd")
    if filters.include_hamming: selected.append("hamming")
    if filters.include_jaccard: selected.append("jaccard[+]")
    if len(selected) < 2:
        raise HTTPException(400, "Select at least 2 distances for the Mantel test.")

    langs, rows = _get_filtered_data(db, filters)
    if not langs or not rows:
        raise HTTPException(400, "No data available with the current filters.")

    # Esclude lingue senza coords se è inclusa la GCD (così tutte le matrici
    # sono allineate sulle stesse lingue)
    skipped: List[str] = []
    if filters.include_gcd:
        keep_idx = [i for i, l in enumerate(langs) if l.latitude is not None and l.longitude is not None]
        skipped = [langs[i].id for i in range(len(langs)) if i not in keep_idx]
        if skipped:
            langs = [langs[i] for i in keep_idx]
            for r in rows:
                r["cells"] = [r["cells"][i] for i in keep_idx]

    n = len(langs)
    if n < 3:
        raise HTTPException(400, "Need at least 3 languages with coordinates to run Mantel.")

    ids = [l.id for l in langs]

    # Costruisce le matrici richieste
    matrices: Dict[str, np.ndarray] = {}

    if filters.include_gcd:
        coords = [(float(l.latitude), float(l.longitude)) for l in langs]
        m = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                d = _gcd_nautical_miles(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
                m[i, j] = m[j, i] = d
        matrices["gcd"] = m

    if filters.include_hamming or filters.include_jaccard:
        lang_vectors = [[r["cells"][i] for r in rows] for i in range(n)]
        if filters.include_hamming:
            m = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    d = _hamming_core(lang_vectors[i], lang_vectors[j])
                    m[i, j] = m[j, i] = d
            matrices["hamming"] = m
        if filters.include_jaccard:
            m = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    d = _jaccard_core(lang_vectors[i], lang_vectors[j])
                    m[i, j] = m[j, i] = d
            matrices["jaccard[+]"] = m

    # Costruisce lo zip
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        for name, mat in matrices.items():
            zf.writestr(f"{name}.txt", _matrix_to_tsv(ids, mat))

        names_sorted = sorted(matrices.keys())  # gcd < hamming < jaccard[+]
        results = []
        iu = np.triu_indices(n, k=1)
        pair_labels = [f"{ids[i]} - {ids[j]}" for i, j in zip(*iu)]

        for n1, n2 in combinations(names_sorted, 2):
            mat1, mat2 = matrices[n1], matrices[n2]
            v1 = mat1[iu]
            v2 = mat2[iu]

            for method in ("pearson", "spearman", "kendalltau"):
                corr, p, samples = _mantel_test(mat1, mat2, method)
                results.append({"matrix1": n1, "matrix2": n2, "method": method,
                                "correlation": corr, "p_value": p})

            # Scatterplot PNG (matplotlib)
            fig = plt.figure(figsize=(12, 8))
            plt.scatter(v1, v2, s=10, alpha=0.75)
            plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.75)
            plt.xlabel(n1); plt.ylabel(n2)
            png_buf = io.BytesIO()
            plt.savefig(png_buf, format='png', dpi=300, bbox_inches='tight')
            plt.close(fig)
            zf.writestr(f"{n1}-{n2}_mantel_scatterplot.png", png_buf.getvalue())

            # Scatterplot HTML interattivo (plotly)
            df_plot = pd.DataFrame({"x": v1, "y": v2, "pair": pair_labels})
            fig_pl = px.scatter(df_plot, x="x", y="y", hover_data=["pair"],
                                labels={"x": n1, "y": n2})
            fig_pl.update_traces(marker=dict(size=10, opacity=0.75))
            zf.writestr(f"{n1}-{n2}_mantel_scatterplot_interactive.html",
                        fig_pl.to_html(include_plotlyjs="cdn"))

        zf.writestr("mantel_results.csv", pd.DataFrame(results).to_csv(index=False))

        if skipped:
            zf.writestr(
                "mantel_warnings.txt",
                "The following languages were excluded because they have no coordinates:\n"
                + "\n".join(skipped) + "\n"
            )

    zip_buf.seek(0)
    headers = {"Content-Disposition": "attachment; filename=mantel_test.zip"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return StreamingResponse(zip_buf, media_type="application/zip", headers=headers)