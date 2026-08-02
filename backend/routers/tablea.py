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

router = APIRouter(prefix="/api/tablea", tags=["Table A"])

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


def _hamming_core(symbols_a, symbols_b) -> float:
    """Calcola distanza di Hamming su simboli + e -."""
    identities, differences = 0.0, 0.0
    for symbol_a, symbol_b in zip(symbols_a, symbols_b):
        if symbol_a == symbol_b and symbol_a in ("+", "-"): identities += 1
        elif (symbol_a == "+" and symbol_b == "-") or (symbol_a == "-" and symbol_b == "+"): differences += 1
    return differences / (identities + differences) if (identities + differences) > 0 else 0.0

def _jaccard_core(symbols_a, symbols_b, identity="+") -> float:
    """Calcola distanza di Jaccard sull'identità scelta."""
    identities, differences = 0.0, 0.0
    for symbol_a, symbol_b in zip(symbols_a, symbols_b):
        if symbol_a == symbol_b == identity: identities += 1
        elif (symbol_a == "+" and symbol_b == "-") or (symbol_a == "-" and symbol_b == "+"): differences += 1
    return differences / (identities + differences) if (identities + differences) > 0 else 0.0

def _get_filtered_data(db: Session, filters: TableAFilterRequest):
    """Replicazione esatta della logica get_tablea_filtered_data."""
    language_query = db.query(models.Language)
    if filters.f_lang_top_family: language_query = language_query.filter(models.Language.top_level_family == filters.f_lang_top_family)
    if filters.f_lang_family: language_query = language_query.filter(models.Language.family == filters.f_lang_family)
    if filters.f_lang_grp: language_query = language_query.filter(models.Language.grp == filters.f_lang_grp)
    if filters.f_lang_hist == "yes": language_query = language_query.filter(models.Language.historical_language == True)
    elif filters.f_lang_hist == "no": language_query = language_query.filter(models.Language.historical_language == False)
    if filters.f_lang_specific: language_query = language_query.filter(models.Language.id.in_(filters.f_lang_specific))

    languages = language_query.order_by(func.lower(models.Language.id)).all()
    lang_ids = [language.id for language in languages]

    matrix = []
    if filters.view == "questions":
        question_query = db.query(models.Question).join(models.ParameterDef).filter(
            models.ParameterDef.is_active == True,
            models.Question.is_active == True,
        )
        if filters.f_q_template: question_query = question_query.filter(models.Question.template_type == filters.f_q_template)
        if filters.f_q_stop == "yes": question_query = question_query.filter(models.Question.is_stop_question == True)
        elif filters.f_q_stop == "no": question_query = question_query.filter(models.Question.is_stop_question == False)
        if filters.selected_ids: question_query = question_query.filter(models.Question.id.in_(filters.selected_ids))

        items = question_query.order_by(models.ParameterDef.position, models.Question.id).all()
        item_ids = [question.id for question in items]
        answers = db.query(models.Answer).filter(models.Answer.question_id.in_(item_ids), models.Answer.language_id.in_(lang_ids)).all()
        answer_by_question_and_lang = {(answer.question_id, answer.language_id): (answer.response_text or "").upper() for answer in answers}

        for question in items:
            matrix.append({
                "id": question.id, "name": question.text, "extra": "",
                "cells": [answer_by_question_and_lang.get((question.id, lid), "") for lid in lang_ids]
            })
    else:
        parameter_query = db.query(models.ParameterDef).filter(models.ParameterDef.is_active == True)
        if filters.f_p_schema: parameter_query = parameter_query.filter(models.ParameterDef.schema == filters.f_p_schema)
        if filters.f_p_type: parameter_query = parameter_query.filter(models.ParameterDef.param_type == filters.f_p_type)
        if filters.f_p_level: parameter_query = parameter_query.filter(models.ParameterDef.level_of_comparison == filters.f_p_level)
        if filters.selected_ids: parameter_query = parameter_query.filter(models.ParameterDef.id.in_(filters.selected_ids))

        items = parameter_query.order_by(models.ParameterDef.position).all()
        item_ids = [parameter.id for parameter in items]
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
        eval_by_param_and_lang = {(parameter_id, language_id): val for (parameter_id, language_id, val) in eval_rows}

        for parameter in items:
            matrix.append({
                "id": parameter.id, "name": parameter.name, "extra": parameter.implicational_condition or "",
                "cells": [eval_by_param_and_lang.get((parameter.id, lid), "") for lid in lang_ids]
            })

    return languages, matrix

_ANSWER_TO_SYMBOL = {"YES": "+", "NO": "-"}

def _get_symbol_data(db: Session, filters: TableAFilterRequest):
    langs, rows = _get_filtered_data(db, filters)
    if filters.view == "questions":
        for row in rows:
            row["cells"] = [_ANSWER_TO_SYMBOL.get(cell, "0") for cell in row["cells"]]
    return langs, rows


@router.get("/options")
def get_tablea_options(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Restituisce le opzioni univoche per popolare i filtri."""
    def distinct(col): return [row[0] for row in db.query(col).filter(col != None, col != "", col != "none").distinct().order_by(col).all()]
    return {
        "opt_top_families": distinct(models.Language.top_level_family),
        "opt_families": distinct(models.Language.family),
        "opt_groups": distinct(models.Language.grp),
        "opt_schemas": distinct(models.ParamSchema.label),
        "opt_types": distinct(models.ParamType.label),
        "opt_levels": distinct(models.ParamLevelOfComparison.label),
        "opt_templates": distinct(models.Question.template_type),
        "opt_all_languages": [{
            "id": language.id,
            "name": language.name_full,
            "top_family": language.top_level_family or "",
            "family": language.family or "",
            "grp": language.grp or "",
            "historical": bool(language.historical_language),
        } for language in db.query(models.Language).order_by(func.lower(models.Language.id)).all()]
    }

def _compute_param_incomplete_map(db: Session, lang_ids: List[str], param_ids: List[str]) -> Dict[tuple, bool]:
  
    if not lang_ids or not param_ids:
        return {}

    flagged: set[tuple] = set()
    for language_id, parameter_id in db.query(
        models.LanguageParameterStatus.language_id,
        models.LanguageParameterStatus.parameter_id,
    ).filter(
        models.LanguageParameterStatus.language_id.in_(lang_ids),
        models.LanguageParameterStatus.parameter_id.in_(param_ids),
        models.LanguageParameterStatus.is_unsure == True,
    ).all():
        flagged.add((language_id, parameter_id))

    parameter_id_by_question_id: Dict[str, str] = {}
    total_questions_by_param: Dict[str, int] = {}
    for question_id, parameter_id in db.query(
        models.Question.id, models.Question.parameter_id,
    ).filter(
        models.Question.parameter_id.in_(param_ids),
        models.Question.is_active == True,
    ).all():
        parameter_id_by_question_id[question_id] = parameter_id
        total_questions_by_param[parameter_id] = total_questions_by_param.get(parameter_id, 0) + 1

    answered_count: Dict[tuple, int] = {}
    if parameter_id_by_question_id:
        for language_id, question_id in db.query(
            models.Answer.language_id, models.Answer.question_id,
        ).filter(
            models.Answer.language_id.in_(lang_ids),
            models.Answer.question_id.in_(list(parameter_id_by_question_id.keys())),
            models.Answer.response_text.in_(["yes", "no"]),
        ).all():
            parameter_id = parameter_id_by_question_id.get(question_id)
            if parameter_id is not None:
                key = (language_id, parameter_id)
                answered_count[key] = answered_count.get(key, 0) + 1

    result: Dict[tuple, bool] = {}
    for language_id in lang_ids:
        for parameter_id in param_ids:
            if (language_id, parameter_id) in flagged:
                result[(language_id, parameter_id)] = True
                continue
            answered = answered_count.get((language_id, parameter_id), 0)
            total = total_questions_by_param.get(parameter_id, 0)
            if answered > 0 and answered < total:
                result[(language_id, parameter_id)] = True
    return result


def _orphan_answers_report(db: Session, lang_ids: List[str], question_ids: List[str]) -> Dict[str, Any]:

    empty: Dict[str, Any] = {"count": 0, "languages": [], "parameters": []}
    if not lang_ids or not question_ids:
        return empty

    parameter_id_by_question_id: Dict[str, str] = {
        question_id: parameter_id for question_id, parameter_id in db.query(
            models.Question.id, models.Question.parameter_id,
        ).filter(models.Question.id.in_(question_ids)).all()
    }
    if not parameter_id_by_question_id:
        return empty

    zeroed = {
        (parameter_id, language_id) for parameter_id, language_id in db.query(
            models.LanguageParameter.parameter_id,
            models.LanguageParameter.language_id,
        ).join(
            models.LanguageParameterEval,
            models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id,
        ).filter(
            models.LanguageParameter.parameter_id.in_(list(set(parameter_id_by_question_id.values()))),
            models.LanguageParameter.language_id.in_(lang_ids),
            models.LanguageParameterEval.value_eval == "0",
        ).all()
    }
    if not zeroed:
        return empty

    count = 0
    langs_hit: set = set()
    params_hit: set = set()
    for language_id, question_id in db.query(
        models.Answer.language_id, models.Answer.question_id,
    ).filter(
        models.Answer.language_id.in_(lang_ids),
        models.Answer.question_id.in_(list(parameter_id_by_question_id.keys())),
        models.Answer.response_text.in_(["yes", "no"]),
    ).all():
        parameter_id = parameter_id_by_question_id.get(question_id)
        if parameter_id and (parameter_id, language_id) in zeroed:
            count += 1
            langs_hit.add(language_id)
            params_hit.add(parameter_id)

    return {"count": count, "languages": sorted(langs_hit), "parameters": sorted(params_hit)}


def _value_orig_map(db: Session, lang_ids: List[str], param_ids: List[str]) -> Dict[tuple, str]:

    value_orig_by_param_and_lang: Dict[tuple, str] = {}
    if param_ids and lang_ids:
        for parameter_id, language_id, value_orig in db.query(
            models.LanguageParameter.parameter_id,
            models.LanguageParameter.language_id,
            models.LanguageParameter.value_orig,
        ).filter(
            models.LanguageParameter.parameter_id.in_(param_ids),
            models.LanguageParameter.language_id.in_(lang_ids),
        ).all():
            value_orig_by_param_and_lang[(parameter_id, language_id)] = value_orig or ""
    return value_orig_by_param_and_lang


def _display_cell(value: str, initial_value: str) -> str:
    return "0+" if (value == "0" and initial_value == "+") else value


@router.post("/matrix")
def get_tablea_matrix(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_filtered_data(db, filters)
    lang_ids = [language.id for language in langs]

    incomplete_map: Dict[tuple, bool] = {}
    init_map: Dict[tuple, str] = {}
    if filters.view == "params":
        param_ids = [row["id"] for row in rows]
        incomplete_map = _compute_param_incomplete_map(db, lang_ids, param_ids)
        init_map = _value_orig_map(db, lang_ids, param_ids)

    orphan_answers = (
        _orphan_answers_report(db, lang_ids, [row["id"] for row in rows])
        if filters.view == "questions"
        else {"count": 0, "languages": [], "parameters": []}
    )

    return {
        "languages": [{"id": language.id, "name": language.name_full} for language in langs],
        "orphan_answers": orphan_answers,
        "rows": [{
            "item": {"id": row["id"], "name": row["name"], "extra": row["extra"]},
            "cells": [
                {
                    "lang_id": lang_id,
                    "val": value,
                    "init": init_map.get((row["id"], lang_id), ""),
                    "is_incomplete": incomplete_map.get((lang_id, row["id"]), False),
                }
                for lang_id, value in zip(lang_ids, row["cells"])
            ],
        } for row in rows]
    }


@router.post("/export/xlsx")
def export_tablea_xlsx(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_filtered_data(db, filters)
    lang_ids = [language.id for language in langs]
    workbook = Workbook()
    worksheet = workbook.active

    init_map = _value_orig_map(db, lang_ids, [row["id"] for row in rows]) if filters.view == "params" else {}

    if filters.view == "questions":
        worksheet.append(["Label", "Question text"] + lang_ids)
        for row in rows: worksheet.append([row["id"], row["name"]] + row["cells"])
    else:
        worksheet.append(["Label", "Parameter", "Implicational Condition(s)"] + lang_ids)
        for row in rows:
            cells = [_display_cell(value, init_map.get((row["id"], lang_ids[index]), "")) for index, value in enumerate(row["cells"])]
            worksheet.append([row["id"], row["name"], row["extra"]] + cells)

    apply_excel_citation(workbook)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename=tableA_{filters.view}.xlsx"})

@router.post("/export/csv")
def export_tablea_csv(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_filtered_data(db, filters)
    init_map = _value_orig_map(db, [language.id for language in langs], [row["id"] for row in rows]) if filters.view == "params" else {}
    buffer = io.StringIO()
    buffer.write(build_citation_comment())
    writer = csv.writer(buffer)
    writer.writerow(["Language"] + [row["id"] for row in rows])
    for index, language in enumerate(langs):
        writer.writerow([language.id] + [_display_cell(row["cells"][index], init_map.get((row["id"], language.id), "")) for row in rows])

    return Response(content=buffer.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=tableA_{filters.view}_transposed.csv"})


@router.post("/export/distances")
def export_distances_txt(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_symbol_data(db, filters)

    lang_vectors = [[row["cells"][lang_index] for row in rows] for lang_index in range(len(langs))]
    ids = [language.id for language in langs]

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zip_file:
        for name, distance_func in [("hamming", _hamming_core), ("jaccard[+]", _jaccard_core)]:
            output_text = "Language\t" + "\t".join(ids) + "\n"
            for i, id1 in enumerate(ids):
                row_vals = [id1]
                for j, _ in enumerate(ids):
                    distance = distance_func(lang_vectors[i], lang_vectors[j])
                    row_vals.append(str(distance))
                output_text += "\t".join(row_vals) + "\n"
            zip_file.writestr(f"{name}.txt", build_citation_comment() + output_text)

    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename=distances_txt_{filters.view}.zip"})

@router.post("/export/geo_distances")
def export_geo_distances_zip(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    langs, _rows = _get_filtered_data(db, filters)

    languages_with_coords = [(language, language.latitude, language.longitude) for language in langs
            if language.latitude is not None and language.longitude is not None]
    skipped = [language.id for language in langs if language.latitude is None or language.longitude is None]
    if len(languages_with_coords) < 2:
        raise HTTPException(400, "Need at least 2 languages with coordinates.")

    ids = [language.id for language, _, _ in languages_with_coords]
    coords = [(float(lat), float(lon)) for _, lat, lon in languages_with_coords]
    n = len(languages_with_coords)

    gcd_matrix = np.zeros((n, n))
    fly_matrix = np.zeros((n, n))
    for i in range(n):
        lat1, lon1 = coords[i]
        for j in range(i + 1, n):
            lat2, lon2 = coords[j]
            gcd_distance = round(_gcd_km(lat1, lon1, lat2, lon2), 3)
            fly_distance = round(_vincenty_km(lat1, lon1, lat2, lon2), 3)
            gcd_matrix[i, j] = gcd_matrix[j, i] = gcd_distance
            fly_matrix[i, j] = fly_matrix[j, i] = fly_distance

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zip_file:
        zip_file.writestr("gcd_km.txt", _matrix_to_tsv(ids, gcd_matrix))
        zip_file.writestr("crow_flies_km.txt", _matrix_to_tsv(ids, fly_matrix))
        if skipped:
            zip_file.writestr(
                "warnings.txt",
                "The following languages were excluded because they have no coordinates:\n"
                + "\n".join(skipped) + "\n"
            )

    buffer.seek(0)
    headers = {"Content-Disposition": "attachment; filename=geo_distances_km.zip"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return StreamingResponse(buffer, media_type="application/zip", headers=headers)

@router.post("/export/dendrograms")
def export_dendrograms_png(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_symbol_data(db, filters)
    lang_vectors = [[row["cells"][lang_index] for row in rows] for lang_index in range(len(langs))]
    labels = [language.id for language in langs]

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zip_file:
        for name, distance_func, title in [
            ("hamming", _hamming_core, "Dendrogram, hamming, average"),
            ("jaccard[+]", _jaccard_core, "Dendrogram, jaccard[+], average")
        ]:
            dist_matrix = [[distance_func(vector_a, vector_b) for vector_b in lang_vectors] for vector_a in lang_vectors]
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
            zip_file.writestr(f"dendrogram_{name}_average.png", img_buf.getvalue())

    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename=dendrograms_{filters.view}.zip"})

@router.post("/export/cluster_map")
def export_cluster_map_html(filters: ClusterMapRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    if filters.distance not in ("hamming", "jaccard"):
        raise HTTPException(400, "distance must be 'hamming' or 'jaccard'")
    if not (0.0 < filters.threshold_coeff <= 1.0):
        raise HTTPException(400, "threshold_coeff must be in (0, 1]")

    langs, rows = _get_symbol_data(db, filters)
    if not langs or not rows:
        raise HTTPException(400, "No data available with the current filters.")

    keep_indices = [index for index, language in enumerate(langs)
                if language.latitude is not None and language.longitude is not None]
    skipped = [langs[index].id for index in range(len(langs)) if index not in keep_indices]
    if len(keep_indices) < 3:
        raise HTTPException(400, "Need at least 3 languages with coordinates to build the cluster map.")

    langs = [langs[index] for index in keep_indices]
    for row in rows:
        row["cells"] = [row["cells"][index] for index in keep_indices]

    n = len(langs)
    lang_vectors = [[row["cells"][lang_index] for row in rows] for lang_index in range(n)]
    distance_func = _hamming_core if filters.distance == "hamming" else _jaccard_core
    dist_matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            distance = distance_func(lang_vectors[i], lang_vectors[j])
            dist_matrix[i, j] = dist_matrix[j, i] = distance

    Z = linkage(squareform(dist_matrix), method='average')
    max_distance = float(Z[:, 2].max()) if Z.size else 0.0
    threshold = filters.threshold_coeff * max_distance
    cluster_ids = fcluster(Z, t=threshold, criterion='distance') if max_distance > 0 else np.ones(n, dtype=int)

    counts = Counter(cluster_ids.tolist())
    df_plot = pd.DataFrame({
        "id": [language.id for language in langs],
        "name": [getattr(language, "name_full", None) or language.id for language in langs],
        "lat": [float(language.latitude) for language in langs],
        "lon": [float(language.longitude) for language in langs],
        "raw_cluster": cluster_ids,
    })
    df_plot["cluster"] = df_plot["raw_cluster"].apply(
        lambda cluster_id: f"Cluster {int(cluster_id)}" if counts[int(cluster_id)] > 1 else "No Cluster"
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
    headers = {"Content-Disposition": f"attachment; filename=cluster_map_{filters.view}.html"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return Response(content=html, media_type="text/html", headers=headers)

@router.post("/export/pca")
def export_pca_png(filters: TableAFilterRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    langs, rows = _get_symbol_data(db, filters)
    if not langs or len(rows) < 2: raise HTTPException(400, "Insufficient data for PCA")

    data = np.array([[1.0 if row["cells"][lang_index] == "+" else 0.0 for row in rows] for lang_index in range(len(langs))])

    data = data[:, np.var(data, axis=0) > 0]
    if data.shape[1] < 2: raise HTTPException(400, "Insufficient variance for PCA")

    scaler = StandardScaler()
    data_std = scaler.fit_transform(data)
    pca = PCA(n_components=2)
    scores = pca.fit_transform(data_std)

    f1, f2 = scores[:, 0], scores[:, 1]
    f1_variance_pct, f2_variance_pct = pca.explained_variance_ratio_[0] * 100, pca.explained_variance_ratio_[1] * 100

    fig = plt.figure(figsize=(12, 8))
    plt.scatter(f1, f2, c='black', s=10, alpha=0.75)
    texts = [plt.text(x, y, language.id, fontsize=9) for x, y, language in zip(f1, f2, langs)]
    adjust_text(texts, arrowprops=dict(arrowstyle='-', color='gray', lw=0.5))

    plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.75)
    plt.xlabel(f'F1 ({f1_variance_pct:.2f}%)')
    plt.ylabel(f'F2 ({f2_variance_pct:.2f}%)')
    plt.axhline(0, color='gray', lw=0.5); plt.axvline(0, color='gray', lw=0.5)
    plt.tight_layout()
    apply_matplotlib_citation(fig)

    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', dpi=300, bbox_inches="tight")
    plt.close()
    buffer.seek(0)
    return Response(content=buffer.getvalue(), media_type="image/png",
                    headers={"Content-Disposition": f"attachment; filename=pca_scatterplot_{filters.view}.png"})



def _gcd_nautical_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:

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

    lines = ["Language\t" + "\t".join(ids)]
    for i, row_id in enumerate(ids):
        lines.append(row_id + "\t" + "\t".join(str(mat[i, j]) for j in range(len(ids))))
    return build_citation_comment() + "\n".join(lines) + "\n"


_CORR_FUNCS = {
    "pearson": lambda x, y: pearsonr(x, y)[0],
    "spearman": lambda x, y: spearmanr(x, y)[0],
    "kendalltau": lambda x, y: kendalltau(x, y)[0],
}


def _mantel_test(mat_a: np.ndarray, mat_b: np.ndarray, method: str,
                 permutations: int = 999, seed: int = 42):

    n = mat_a.shape[0]
    upper_indices = np.triu_indices(n, k=1)
    a_flat = mat_a[upper_indices]
    b_flat = mat_b[upper_indices]
    corr = _CORR_FUNCS[method]
    obs = corr(a_flat, b_flat)

    rng = np.random.default_rng(seed)
    count = 0
    abs_obs = abs(obs)
    for _ in range(permutations):
        perm = rng.permutation(n)
        b_perm = mat_b[perm][:, perm]
        r = corr(a_flat, b_perm[upper_indices])
        if abs(r) >= abs_obs:
            count += 1
    p_value = (count + 1) / (permutations + 1)
    return obs, p_value, n


@router.post("/export/mantel")
def export_mantel_zip(filters: MantelRequest, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    selected = []
    if filters.include_gcd: selected.append("gcd")
    if filters.include_hamming: selected.append("hamming")
    if filters.include_jaccard: selected.append("jaccard[+]")
    if len(selected) < 2:
        raise HTTPException(400, "Select at least 2 distances for the Mantel test.")

    langs, rows = _get_symbol_data(db, filters)
    if not langs or not rows:
        raise HTTPException(400, "No data available with the current filters.")

    skipped: List[str] = []
    if filters.include_gcd:
        keep_indices = [index for index, language in enumerate(langs) if language.latitude is not None and language.longitude is not None]
        skipped = [langs[index].id for index in range(len(langs)) if index not in keep_indices]
        if skipped:
            langs = [langs[index] for index in keep_indices]
            for row in rows:
                row["cells"] = [row["cells"][index] for index in keep_indices]

    n = len(langs)
    if n < 3:
        raise HTTPException(400, "Need at least 3 languages with coordinates to run Mantel.")

    ids = [language.id for language in langs]

    matrices: Dict[str, np.ndarray] = {}

    if filters.include_gcd:
        coords = [(float(language.latitude), float(language.longitude)) for language in langs]
        distance_matrix = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                distance = _gcd_nautical_miles(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
                distance_matrix[i, j] = distance_matrix[j, i] = distance
        matrices["gcd"] = distance_matrix

    if filters.include_hamming or filters.include_jaccard:
        lang_vectors = [[row["cells"][lang_index] for row in rows] for lang_index in range(n)]
        if filters.include_hamming:
            distance_matrix = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    distance = _hamming_core(lang_vectors[i], lang_vectors[j])
                    distance_matrix[i, j] = distance_matrix[j, i] = distance
            matrices["hamming"] = distance_matrix
        if filters.include_jaccard:
            distance_matrix = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    distance = _jaccard_core(lang_vectors[i], lang_vectors[j])
                    distance_matrix[i, j] = distance_matrix[j, i] = distance
            matrices["jaccard[+]"] = distance_matrix

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zip_file:
        for name, mat in matrices.items():
            zip_file.writestr(f"{name}.txt", _matrix_to_tsv(ids, mat))

        names_sorted = sorted(matrices.keys())
        results = []
        upper_indices = np.triu_indices(n, k=1)
        pair_labels = [f"{ids[i]} - {ids[j]}" for i, j in zip(*upper_indices)]

        for n1, n2 in combinations(names_sorted, 2):
            mat1, mat2 = matrices[n1], matrices[n2]
            values1 = mat1[upper_indices]
            values2 = mat2[upper_indices]

            for method in ("pearson", "spearman", "kendalltau"):
                corr, p_value, samples = _mantel_test(mat1, mat2, method)
                results.append({"matrix1": n1, "matrix2": n2, "method": method,
                                "correlation": corr, "p_value": p_value})

            fig = plt.figure(figsize=(12, 8))
            plt.scatter(values1, values2, s=10, alpha=0.75)
            plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.75)
            plt.xlabel(n1); plt.ylabel(n2)
            apply_matplotlib_citation(fig)
            png_buf = io.BytesIO()
            plt.savefig(png_buf, format='png', dpi=300, bbox_inches='tight')
            plt.close(fig)
            zip_file.writestr(f"{n1}-{n2}_mantel_scatterplot.png", png_buf.getvalue())

            df_plot = pd.DataFrame({"x": values1, "y": values2, "pair": pair_labels})
            fig_pl = px.scatter(df_plot, x="x", y="y", hover_data=["pair"],
                                labels={"x": n1, "y": n2})
            fig_pl.update_traces(marker=dict(size=10, opacity=0.75))
            zip_file.writestr(f"{n1}-{n2}_mantel_scatterplot_interactive.html",
                        inject_html_citation(fig_pl.to_html(include_plotlyjs="cdn")))

        zip_file.writestr("mantel_results.csv",
                    build_citation_comment() + pd.DataFrame(results).to_csv(index=False))

        if skipped:
            zip_file.writestr(
                "mantel_warnings.txt",
                "The following languages were excluded because they have no coordinates:\n"
                + "\n".join(skipped) + "\n"
            )

    zip_buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=mantel_test_{filters.view}.zip"}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)
    return StreamingResponse(zip_buf, media_type="application/zip", headers=headers)