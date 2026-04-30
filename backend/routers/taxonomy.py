from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import Optional

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/taxonomy", tags=["Taxonomy"])


# ==========================================
# Schemas
# ==========================================
class TopFamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class TopFamilyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    top_family_id: Optional[int] = None


class FamilyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    top_family_id: Optional[int] = None  # passare 0 o None? Usiamo None=non modificare; per scollegare usare /unassign
    set_top_family: bool = False  # se True, top_family_id (anche None) viene applicato


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    family_id: Optional[int] = None


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    family_id: Optional[int] = None
    set_family: bool = False


# ==========================================
# Helpers
# ==========================================
def _check_unique_top_family(db: Session, name: str, exclude_id: Optional[int] = None):
    q = db.query(models.TopFamily).filter(models.TopFamily.name == name)
    if exclude_id is not None:
        q = q.filter(models.TopFamily.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"Top-family '{name}' already exists.")


def _check_unique_family(db: Session, name: str, exclude_id: Optional[int] = None):
    q = db.query(models.Family).filter(models.Family.name == name)
    if exclude_id is not None:
        q = q.filter(models.Family.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"Family '{name}' already exists.")


def _check_unique_group(db: Session, name: str, exclude_id: Optional[int] = None):
    q = db.query(models.Group).filter(models.Group.name == name)
    if exclude_id is not None:
        q = q.filter(models.Group.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"Group '{name}' already exists.")


def _languages_using(db: Session, column, value: str) -> int:
    return db.query(func.count(models.Language.id)).filter(column == value).scalar() or 0


# ==========================================
# Tree (read)
# ==========================================
@router.get("/tree")
def get_tree(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Albero completo + sezioni "unassigned" e "non normalizzate":
      - top_families[].families[].groups[]
      - orphan_families: family senza top_family
      - orphan_groups: group senza family
      - unnormalized: stringhe usate su Language ma non corrispondenti a entità
    """
    top_families = db.query(models.TopFamily).order_by(
        models.TopFamily.position, models.TopFamily.name
    ).all()
    families = db.query(models.Family).order_by(
        models.Family.position, models.Family.name
    ).all()
    groups = db.query(models.Group).order_by(
        models.Group.position, models.Group.name
    ).all()

    # conteggi lingue per nome (case-sensitive, coerente con i filtri esistenti)
    def _lang_count_by(column) -> dict:
        rows = db.query(column, func.count(models.Language.id)).filter(
            column.isnot(None), column != ""
        ).group_by(column).all()
        return {n: c for n, c in rows}

    cnt_top = _lang_count_by(models.Language.top_level_family)
    cnt_fam = _lang_count_by(models.Language.family)
    cnt_grp = _lang_count_by(models.Language.grp)

    groups_by_family: dict[Optional[int], list] = {}
    for g in groups:
        groups_by_family.setdefault(g.family_id, []).append({
            "id": g.id,
            "name": g.name,
            "position": g.position,
            "family_id": g.family_id,
            "language_count": cnt_grp.get(g.name, 0),
        })

    families_by_top: dict[Optional[int], list] = {}
    for f in families:
        families_by_top.setdefault(f.top_family_id, []).append({
            "id": f.id,
            "name": f.name,
            "position": f.position,
            "top_family_id": f.top_family_id,
            "language_count": cnt_fam.get(f.name, 0),
            "groups": groups_by_family.get(f.id, []),
        })

    top_families_out = [{
        "id": tf.id,
        "name": tf.name,
        "position": tf.position,
        "language_count": cnt_top.get(tf.name, 0),
        "families": families_by_top.get(tf.id, []),
    } for tf in top_families]

    orphan_families = families_by_top.get(None, [])
    orphan_groups = groups_by_family.get(None, [])

    # Stringhe presenti su Language ma non normalizzate in entità
    known_top = {tf.name for tf in top_families}
    known_fam = {f.name for f in families}
    known_grp = {g.name for g in groups}

    unnormalized = {
        "top_families": sorted([
            {"name": n, "language_count": c}
            for n, c in cnt_top.items() if n not in known_top
        ], key=lambda x: x["name"]),
        "families": sorted([
            {"name": n, "language_count": c}
            for n, c in cnt_fam.items() if n not in known_fam
        ], key=lambda x: x["name"]),
        "groups": sorted([
            {"name": n, "language_count": c}
            for n, c in cnt_grp.items() if n not in known_grp
        ], key=lambda x: x["name"]),
    }

    return {
        "top_families": top_families_out,
        "orphan_families": orphan_families,
        "orphan_groups": orphan_groups,
        "unnormalized": unnormalized,
    }


# ==========================================
# Top-Families CRUD
# ==========================================
@router.post("/top-families")
def create_top_family(payload: TopFamilyCreate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_top_family(db, name)
    max_pos = db.query(func.coalesce(func.max(models.TopFamily.position), -1)).scalar()
    tf = models.TopFamily(name=name, position=int(max_pos) + 1)
    db.add(tf)
    db.commit()
    db.refresh(tf)
    return {"id": tf.id, "name": tf.name, "position": tf.position}


@router.patch("/top-families/{tf_id}")
def update_top_family(tf_id: int, payload: TopFamilyUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    tf = db.get(models.TopFamily, tf_id)
    if not tf:
        raise HTTPException(404, "Top-family not found")
    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name != tf.name:
            _check_unique_top_family(db, new_name, exclude_id=tf.id)
            old_name = tf.name
            tf.name = new_name
            # Propaga rinomina sulle Language che usano la stringa
            db.query(models.Language).filter(
                models.Language.top_level_family == old_name
            ).update({models.Language.top_level_family: new_name}, synchronize_session=False)
    db.commit()
    db.refresh(tf)
    return {"id": tf.id, "name": tf.name, "position": tf.position}


@router.delete("/top-families/{tf_id}")
def delete_top_family(tf_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    tf = db.get(models.TopFamily, tf_id)
    if not tf:
        raise HTTPException(404, "Top-family not found")
    child_count = db.query(func.count(models.Family.id)).filter(models.Family.top_family_id == tf.id).scalar() or 0
    if child_count > 0:
        raise HTTPException(400, f"Cannot delete: {child_count} sub-families still attached. Reassign them first.")
    lang_count = _languages_using(db, models.Language.top_level_family, tf.name)
    if lang_count > 0:
        raise HTTPException(400, f"Cannot delete: {lang_count} languages still reference '{tf.name}'.")
    db.delete(tf)
    db.commit()
    return {"ok": True}


# ==========================================
# Families CRUD
# ==========================================
@router.post("/families")
def create_family(payload: FamilyCreate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_family(db, name)
    if payload.top_family_id is not None:
        if not db.get(models.TopFamily, payload.top_family_id):
            raise HTTPException(400, "Top-family not found")
    max_pos = db.query(func.coalesce(func.max(models.Family.position), -1)).scalar()
    f = models.Family(name=name, top_family_id=payload.top_family_id, position=int(max_pos) + 1)
    db.add(f)
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name, "top_family_id": f.top_family_id, "position": f.position}


@router.patch("/families/{f_id}")
def update_family(f_id: int, payload: FamilyUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    f = db.get(models.Family, f_id)
    if not f:
        raise HTTPException(404, "Family not found")
    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name != f.name:
            _check_unique_family(db, new_name, exclude_id=f.id)
            old_name = f.name
            f.name = new_name
            db.query(models.Language).filter(
                models.Language.family == old_name
            ).update({models.Language.family: new_name}, synchronize_session=False)
    if payload.set_top_family:
        if payload.top_family_id is not None and not db.get(models.TopFamily, payload.top_family_id):
            raise HTTPException(400, "Top-family not found")
        f.top_family_id = payload.top_family_id
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name, "top_family_id": f.top_family_id, "position": f.position}


@router.delete("/families/{f_id}")
def delete_family(f_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    f = db.get(models.Family, f_id)
    if not f:
        raise HTTPException(404, "Family not found")
    child_count = db.query(func.count(models.Group.id)).filter(models.Group.family_id == f.id).scalar() or 0
    if child_count > 0:
        raise HTTPException(400, f"Cannot delete: {child_count} groups still attached. Reassign them first.")
    lang_count = _languages_using(db, models.Language.family, f.name)
    if lang_count > 0:
        raise HTTPException(400, f"Cannot delete: {lang_count} languages still reference '{f.name}'.")
    db.delete(f)
    db.commit()
    return {"ok": True}


# ==========================================
# Groups CRUD
# ==========================================
@router.post("/groups")
def create_group(payload: GroupCreate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_group(db, name)
    if payload.family_id is not None:
        if not db.get(models.Family, payload.family_id):
            raise HTTPException(400, "Family not found")
    max_pos = db.query(func.coalesce(func.max(models.Group.position), -1)).scalar()
    g = models.Group(name=name, family_id=payload.family_id, position=int(max_pos) + 1)
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"id": g.id, "name": g.name, "family_id": g.family_id, "position": g.position}


@router.patch("/groups/{g_id}")
def update_group(g_id: int, payload: GroupUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    g = db.get(models.Group, g_id)
    if not g:
        raise HTTPException(404, "Group not found")
    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name != g.name:
            _check_unique_group(db, new_name, exclude_id=g.id)
            old_name = g.name
            g.name = new_name
            db.query(models.Language).filter(
                models.Language.grp == old_name
            ).update({models.Language.grp: new_name}, synchronize_session=False)
    if payload.set_family:
        if payload.family_id is not None and not db.get(models.Family, payload.family_id):
            raise HTTPException(400, "Family not found")
        g.family_id = payload.family_id
    db.commit()
    db.refresh(g)
    return {"id": g.id, "name": g.name, "family_id": g.family_id, "position": g.position}


@router.delete("/groups/{g_id}")
def delete_group(g_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    g = db.get(models.Group, g_id)
    if not g:
        raise HTTPException(404, "Group not found")
    lang_count = _languages_using(db, models.Language.grp, g.name)
    if lang_count > 0:
        raise HTTPException(400, f"Cannot delete: {lang_count} languages still reference '{g.name}'.")
    db.delete(g)
    db.commit()
    return {"ok": True}


# ==========================================
# Promote unnormalized string -> entity
# ==========================================
class PromotePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[int] = None  # top_family_id per family, family_id per group


@router.post("/promote/top-family")
def promote_top_family(payload: PromotePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_top_family(db, name)
    max_pos = db.query(func.coalesce(func.max(models.TopFamily.position), -1)).scalar()
    tf = models.TopFamily(name=name, position=int(max_pos) + 1)
    db.add(tf)
    db.commit()
    db.refresh(tf)
    return {"id": tf.id, "name": tf.name}


@router.post("/promote/family")
def promote_family(payload: PromotePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_family(db, name)
    if payload.parent_id is not None and not db.get(models.TopFamily, payload.parent_id):
        raise HTTPException(400, "Top-family not found")
    max_pos = db.query(func.coalesce(func.max(models.Family.position), -1)).scalar()
    f = models.Family(name=name, top_family_id=payload.parent_id, position=int(max_pos) + 1)
    db.add(f)
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name, "top_family_id": f.top_family_id}


@router.post("/promote/group")
def promote_group(payload: PromotePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    name = payload.name.strip()
    _check_unique_group(db, name)
    if payload.parent_id is not None and not db.get(models.Family, payload.parent_id):
        raise HTTPException(400, "Family not found")
    max_pos = db.query(func.coalesce(func.max(models.Group.position), -1)).scalar()
    g = models.Group(name=name, family_id=payload.parent_id, position=int(max_pos) + 1)
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"id": g.id, "name": g.name, "family_id": g.family_id}


# ==========================================
# Reorder (drag & drop)
# ==========================================
class ReorderPayload(BaseModel):
    ids: list[int]


@router.post("/reorder/top-families")
def reorder_top_families(payload: ReorderPayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    for idx, tf_id in enumerate(payload.ids):
        db.query(models.TopFamily).filter(models.TopFamily.id == tf_id).update(
            {models.TopFamily.position: idx}, synchronize_session=False
        )
    db.commit()
    return {"ok": True}


@router.post("/reorder/families")
def reorder_families(payload: ReorderPayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    for idx, f_id in enumerate(payload.ids):
        db.query(models.Family).filter(models.Family.id == f_id).update(
            {models.Family.position: idx}, synchronize_session=False
        )
    db.commit()
    return {"ok": True}


@router.post("/reorder/groups")
def reorder_groups(payload: ReorderPayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    for idx, g_id in enumerate(payload.ids):
        db.query(models.Group).filter(models.Group.id == g_id).update(
            {models.Group.position: idx}, synchronize_session=False
        )
    db.commit()
    return {"ok": True}
