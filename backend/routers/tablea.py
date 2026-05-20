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
from scipy.cluster.hierarchy import linkage, dendrogram, fcluster
from scipy.spatial.distance import squareform
from scipy.stats import pearsonr, spearmanr, kendalltau
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from collections import Counter
import plotly.express as px
from openpyxl import Workbook
from adjustText import adjust_text

import models
from dependencies import get_db, get_current_user, require_admin
from services.citation import (
    apply_excel_citation,
    apply_matplotlib_citation,
    build_citation_comment,
    inject_html_citation,
)

# Tutti gli endpoint di TableA sono admin-only (la pagina /tablea nella SPA è
# riservata agli admin e i payload — matrice cross-language, export, distanze,
# Mantel, PCA — non vanno esposti a utenti non admin né tantomeno al pubblico),
# TRANNE `/options` che è chiamato anche da LanguageList per popolare i filtri
# top_family/family/group e quindi richiede solo `get_current_user`.
# Le dipendenze sono dichiarate per-view invece che a livello di router perché
# in FastAPI le dependencies del router sono additive: non c'è modo di
# "togliere" require_admin da una singola route.
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


class ClusterMapRequest(TableAFilterRequest):
    distance: str = "hamming"          # "hamming" | "jaccard"
    threshold_coeff: float = 0.56      # cluster cut at coeff * max(linkage_distance), come 01_plot_clusters.py

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

# Accessibile a tutti gli utenti loggati (vedi nota sul router): LanguageList
# usa queste opzioni per popolare i filtri top_family/family/group anche per
# gli utenti non admin.
@router.get("/options")
def get_tablea_options(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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

def _compute_param_incomplete_map(db: Session, lang_ids: List[str], param_ids: List[str]) -> Dict[tuple, bool]:
    """Mappa (lang_id, param_id) -> bool dove True = "rosso" in TableA.

    Replica la stessa regola del wizard navigation in LanguageData
    (services/compilation _build_lang_data, classe CSS `is-incomplete`):
        red = is_unsure == True
              OR (answered > 0 AND answered < total)
    dove `answered` è il numero di question attive con `response_text` in
    ("yes","no") — unsure NON conta come risposta — e `total` è il numero
    di question attive del parametro.

    Costa 3 query batch (status, questions, answers): O(N×M) in memoria
    Python, niente N+1.
    """
    if not lang_ids or not param_ids:
        return {}

    # 1. is_unsure flags
    flagged: set[tuple] = set()
    for lid, pid in db.query(
        models.LanguageParameterStatus.language_id,
        models.LanguageParameterStatus.parameter_id,
    ).filter(
        models.LanguageParameterStatus.language_id.in_(lang_ids),
        models.LanguageParameterStatus.parameter_id.in_(param_ids),
        models.LanguageParameterStatus.is_unsure == True,
    ).all():
        flagged.add((lid, pid))

    # 2. Total question attive per parametro
    qid_to_param: Dict[str, str] = {}
    param_total: Dict[str, int] = {}
    for q_id, p_id in db.query(
        models.Question.id, models.Question.parameter_id,
    ).filter(
        models.Question.parameter_id.in_(param_ids),
        models.Question.is_active == True,
    ).all():
        qid_to_param[q_id] = p_id
        param_total[p_id] = param_total.get(p_id, 0) + 1

    # 3. answered count per (lang, param)
    answered_count: Dict[tuple, int] = {}
    if qid_to_param:
        for l_id, q_id in db.query(
            models.Answer.language_id, models.Answer.question_id,
        ).filter(
            models.Answer.language_id.in_(lang_ids),
            models.Answer.question_id.in_(list(qid_to_param.keys())),
            models.Answer.response_text.in_(["yes", "no"]),
        ).all():
            p_id = qid_to_param.get(q_id)
            if p_id is not None:
                key = (l_id, p_id)
                answered_count[key] = answered_count.get(key, 0) + 1

    # 4. Compose: True se flagged OR parzialmente compilato.
    result: Dict[tuple, bool] = {}
    for l_id in lang_ids:
        for p_id in param_ids:
            if (l_id, p_id) in flagged:
                result[(l_id, p_id)] = True
                continue
            answered = answered_count.get((l_id, p_id), 0)
            total = param_total.get(p_id, 0)
            if answered > 0 and answered < total:
                result[(l_id, p_id)] = True
    return result


@router.post("/matrix")
def get_tablea_matrix(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_filtered_data(db, filters)
    lang_ids = [l.id for l in langs]

    # Solo per vista params: calcoliamo se la cella va segnalata "rossa"
    # (incomplete o flagged unsure). La vista questions mostra le singole
    # Answer e non ha questo concetto.
    incomplete_map: Dict[tuple, bool] = {}
    if filters.view == "params":
        incomplete_map = _compute_param_incomplete_map(
            db, lang_ids, [r["id"] for r in rows],
        )

    return {
        "languages": [{"id": l.id, "name": l.name_full} for l in langs],
        "rows": [{
            "item": {"id": r["id"], "name": r["name"], "extra": r["extra"]},
            "cells": [
                {
                    "lang_id": lid,
                    "val": val,
                    "is_incomplete": incomplete_map.get((lid, r["id"]), False),
                }
                for lid, val in zip(lang_ids, r["cells"])
            ],
        } for r in rows]
    }

# ==========================================
# ENDPOINT: EXPORT STANDARD (EXCEL/CSV)
# ==========================================

@router.post("/export/xlsx")
def export_tablea_xlsx(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
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

    apply_excel_citation(wb)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename=tableA_{filters.view}.xlsx"})

@router.post("/export/csv")
def export_tablea_csv(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Export CSV Trasposto: righe=lingue, colonne=parametri."""
    langs, rows = _get_filtered_data(db, filters)
    buf = io.StringIO()
    buf.write(build_citation_comment())
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
def export_distances_txt(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
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
            zf.writestr(f"{name}.txt", build_citation_comment() + out)

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=distances_txt.zip"})

@router.post("/export/geo_distances")
def export_geo_distances_zip(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Matrici di distanza geografica in km (porting di 11_latitude_longitude_to_distance_matrix.py).

    Output zip con due TSV:
      - gcd_km.txt        : Great Circle Distance, modello sferico (R = 6371.0088 km)
      - crow_flies_km.txt : Geodesic su ellissoide WGS-84 via Vincenty inverso
    Lingue senza coordinate vengono escluse e segnalate.
    """
    if filters.view != "params":
        raise HTTPException(400, "Geo distances only available for Parameters View")

    langs, _rows = _get_filtered_data(db, filters)

    keep = [(l, l.latitude, l.longitude) for l in langs
            if l.latitude is not None and l.longitude is not None]
    skipped = [l.id for l in langs if l.latitude is None or l.longitude is None]
    if len(keep) < 2:
        raise HTTPException(400, "Need at least 2 languages with coordinates.")

    ids = [l.id for l, _, _ in keep]
    coords = [(float(lat), float(lon)) for _, lat, lon in keep]
    n = len(keep)

    gcd_mat = np.zeros((n, n))
    fly_mat = np.zeros((n, n))
    for i in range(n):
        lat1, lon1 = coords[i]
        for j in range(i + 1, n):
            lat2, lon2 = coords[j]
            d_gcd = round(_gcd_km(lat1, lon1, lat2, lon2), 3)
            d_fly = round(_vincenty_km(lat1, lon1, lat2, lon2), 3)
            gcd_mat[i, j] = gcd_mat[j, i] = d_gcd
            fly_mat[i, j] = fly_mat[j, i] = d_fly

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("gcd_km.txt", _matrix_to_tsv(ids, gcd_mat))
        zf.writestr("crow_flies_km.txt", _matrix_to_tsv(ids, fly_mat))
        if skipped:
            zf.writestr(
                "warnings.txt",
                "The following languages were excluded because they have no coordinates:\n"
                + "\n".join(skipped) + "\n"
            )

    buf.seek(0)
    headers = {"Content-Disposition": "attachment; filename=geo_distances_km.zip"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return StreamingResponse(buf, media_type="application/zip", headers=headers)

@router.post("/export/dendrograms")
def export_dendrograms_png(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
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

            fig = plt.figure(figsize=(12, 8))
            dendrogram(linkage_matrix, labels=labels, orientation='top', distance_sort='descending', show_leaf_counts=True, color_threshold=0, above_threshold_color='black')
            plt.title(title)
            plt.xlabel("Languages")
            plt.ylabel("Distance")
            plt.tight_layout()
            apply_matplotlib_citation(fig)

            img_buf = io.BytesIO()
            plt.savefig(img_buf, format='png', dpi=300, bbox_inches="tight")
            plt.close()
            zf.writestr(f"dendrogram_{name}_average.png", img_buf.getvalue())

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=dendrograms.zip"})

@router.post("/export/cluster_map")
def export_cluster_map_html(filters: ClusterMapRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Mappa interattiva HTML dei cluster UPGMA (porting di 02_carta_italia.py).

    Pipeline (replicata da 01_plot_clusters.py + 02_carta_italia.py):
      1. matrice di distanza (hamming default, oppure jaccard[+]) sui parametri filtrati
      2. linkage UPGMA (average)
      3. cluster ottenuti tagliando il dendrogramma a threshold_coeff * max(linkage_distance)
      4. plot scatter_geo (plotly) con un colore per cluster; singletoni → "No Cluster"
    Lingue senza coordinate vengono escluse e segnalate via header X-Skipped-Languages.
    """
    if filters.view != "params":
        raise HTTPException(400, "Cluster map only available for Parameters View")
    if filters.distance not in ("hamming", "jaccard"):
        raise HTTPException(400, "distance must be 'hamming' or 'jaccard'")
    if not (0.0 < filters.threshold_coeff <= 1.0):
        raise HTTPException(400, "threshold_coeff must be in (0, 1]")

    langs, rows = _get_filtered_data(db, filters)
    if not langs or not rows:
        raise HTTPException(400, "No data available with the current filters.")

    keep_idx = [i for i, l in enumerate(langs)
                if l.latitude is not None and l.longitude is not None]
    skipped = [langs[i].id for i in range(len(langs)) if i not in keep_idx]
    if len(keep_idx) < 3:
        raise HTTPException(400, "Need at least 3 languages with coordinates to build the cluster map.")

    langs = [langs[i] for i in keep_idx]
    for r in rows:
        r["cells"] = [r["cells"][i] for i in keep_idx]

    n = len(langs)
    lang_vectors = [[r["cells"][i] for r in rows] for i in range(n)]
    dist_func = _hamming_core if filters.distance == "hamming" else _jaccard_core
    dist_matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            d = dist_func(lang_vectors[i], lang_vectors[j])
            dist_matrix[i, j] = dist_matrix[j, i] = d

    Z = linkage(squareform(dist_matrix), method='average')
    max_d = float(Z[:, 2].max()) if Z.size else 0.0
    threshold = filters.threshold_coeff * max_d
    cluster_ids = fcluster(Z, t=threshold, criterion='distance') if max_d > 0 else np.ones(n, dtype=int)

    counts = Counter(cluster_ids.tolist())
    df_plot = pd.DataFrame({
        "id": [l.id for l in langs],
        "name": [getattr(l, "name_full", None) or l.id for l in langs],
        "lat": [float(l.latitude) for l in langs],
        "lon": [float(l.longitude) for l in langs],
        "raw_cluster": cluster_ids,
    })
    df_plot["cluster"] = df_plot["raw_cluster"].apply(
        lambda c: f"Cluster {int(c)}" if counts[int(c)] > 1 else "No Cluster"
    )
    df_plot = df_plot.sort_values(["cluster", "id"]).reset_index(drop=True)

    title = (
        f"UPGMA cluster map — distance: {filters.distance}, linkage: average, "
        f"cut: {filters.threshold_coeff:.2f} × max ({threshold:.3f})"
    )
    fig = px.scatter_geo(
        df_plot, lat="lat", lon="lon", color="cluster",
        hover_name="name",
        hover_data={"id": True, "cluster": True, "lat": ":.4f", "lon": ":.4f", "raw_cluster": False},
        title=title,
    )
    fig.update_traces(marker=dict(size=10, line=dict(width=0.5, color="black")))
    fig.update_geos(showcountries=True, showsubunits=True,
                    fitbounds="locations", resolution=50,
                    showland=True, landcolor="#f5f5f0",
                    showocean=True, oceancolor="#e6f2f7")
    fig.update_layout(margin=dict(r=10, t=60, l=10, b=10), height=720,
                      legend=dict(title="Cluster"))

    html = inject_html_citation(fig.to_html(include_plotlyjs="cdn"))
    headers = {"Content-Disposition": "attachment; filename=cluster_map.html"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return Response(content=html, media_type="text/html", headers=headers)

@router.post("/export/pca")
def export_pca_png(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Analisi PCA via sklearn.decomposition.PCA, allineata a pca1.py."""
    langs, rows = _get_filtered_data(db, filters)
    if not langs or len(rows) < 2: raise HTTPException(400, "Insufficient data for PCA")

    # Conversione numerica: + -> 1.0, altrimenti 0.0
    data = np.array([[1.0 if r["cells"][i] == "+" else 0.0 for r in rows] for i in range(len(langs))])

    # Rimuove colonne a varianza zero
    data = data[:, np.var(data, axis=0) > 0]
    if data.shape[1] < 2: raise HTTPException(400, "Insufficient variance for PCA")

    # Standardizzazione e PCA via sklearn
    scaler = StandardScaler()
    data_std = scaler.fit_transform(data)
    pca = PCA(n_components=2)
    scores = pca.fit_transform(data_std)

    f1, f2 = scores[:, 0], scores[:, 1]
    v1_pct, v2_pct = pca.explained_variance_ratio_[0] * 100, pca.explained_variance_ratio_[1] * 100

    fig = plt.figure(figsize=(12, 8))
    plt.scatter(f1, f2, c='black', s=10, alpha=0.75)
    texts = [plt.text(x, y, l.id, fontsize=9) for x, y, l in zip(f1, f2, langs)]
    adjust_text(texts, arrowprops=dict(arrowstyle='-', color='gray', lw=0.5))

    plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.75)
    plt.xlabel(f'F1 ({v1_pct:.2f}%)')
    plt.ylabel(f'F2 ({v2_pct:.2f}%)')
    plt.axhline(0, color='gray', lw=0.5); plt.axvline(0, color='gray', lw=0.5)
    plt.tight_layout()
    apply_matplotlib_citation(fig)

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


def _gcd_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (modello sferico, R = 6371.0088 km).

    Stesso raggio usato da geopy.distance.great_circle (script 11).
    """
    R_km = 6371.0088
    x1, y1 = math.radians(lat1), math.radians(lon1)
    x2, y2 = math.radians(lat2), math.radians(lon2)
    cos_val = math.sin(x1) * math.sin(x2) + math.cos(x1) * math.cos(x2) * math.cos(y1 - y2)
    return R_km * math.acos(max(-1.0, min(1.0, cos_val)))


def _vincenty_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Geodesic distance (km) su ellissoide WGS-84 via Vincenty inverso.

    Stessa metrica di geopy.distance.geodesic (script 11). Per coppie
    quasi antipodali la formula può non convergere: in tal caso ritorna
    il GCD sferico come fallback (caso non realistico per lingue terrestri).
    """
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    a = 6378137.0
    f = 1 / 298.257223563
    b = (1 - f) * a
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - f) * math.tan(math.radians(lat2)))
    sinU1, cosU1 = math.sin(U1), math.cos(U1)
    sinU2, cosU2 = math.sin(U2), math.cos(U2)
    lam = L
    for _ in range(200):
        sinLam, cosLam = math.sin(lam), math.cos(lam)
        sinSigma = math.sqrt((cosU2 * sinLam) ** 2 +
                             (cosU1 * sinU2 - sinU1 * cosU2 * cosLam) ** 2)
        if sinSigma == 0:
            return 0.0
        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLam
        sigma = math.atan2(sinSigma, cosSigma)
        sinAlpha = cosU1 * cosU2 * sinLam / sinSigma
        cosSqAlpha = 1 - sinAlpha ** 2
        cos2SigmaM = 0.0 if cosSqAlpha == 0 else cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha
        C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
        lamP = lam
        lam = L + (1 - C) * f * sinAlpha * (
            sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2))
        )
        if abs(lam - lamP) < 1e-12:
            break
    else:
        return _gcd_km(lat1, lon1, lat2, lon2)
    uSq = cosSqAlpha * (a ** 2 - b ** 2) / (b ** 2)
    A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
    B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
    deltaSigma = B * sinSigma * (
        cos2SigmaM + B / 4 * (
            cosSigma * (-1 + 2 * cos2SigmaM ** 2)
            - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)
        )
    )
    s = b * A * (sigma - deltaSigma)
    return s / 1000.0


def _matrix_to_tsv(ids: List[str], mat: np.ndarray) -> str:
    """Serializza una matrice quadrata in TSV con header come gcd.py / distance.py.

    Il blocco è preceduto dalla citazione di attribuzione (righe-commento ``#``).
    """
    lines = ["Language\t" + "\t".join(ids)]
    for i, id1 in enumerate(ids):
        lines.append(id1 + "\t" + "\t".join(str(mat[i, j]) for j in range(len(ids))))
    return build_citation_comment() + "\n".join(lines) + "\n"


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
def export_mantel_zip(filters: MantelRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
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
            apply_matplotlib_citation(fig)
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
                        inject_html_citation(fig_pl.to_html(include_plotlyjs="cdn")))

        zf.writestr("mantel_results.csv",
                    build_citation_comment() + pd.DataFrame(results).to_csv(index=False))

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