from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import io
import csv
import zipfile
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg') # Necessario per il rendering server-side
import matplotlib.pyplot as plt
from scipy.cluster.hierarchy import linkage, dendrogram
from scipy.spatial.distance import squareform
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
        q_query = db.query(models.Question).join(models.ParameterDef).filter(models.ParameterDef.is_active == True)
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
        evals = db.query(models.LanguageParameterEval).join(models.LanguageParameter).filter(
            models.LanguageParameter.parameter_id.in_(item_ids), models.LanguageParameter.language_id.in_(lang_ids)
        ).all()
        ev_dict = {(e.language_parameter.parameter_id, e.language_parameter.language_id): e.value_eval for e in evals}

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