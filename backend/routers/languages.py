import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin, get_current_user
from services.versioning import record_version

ID_MAX_LEN = 10  # Length(Language.id) — vincolo schema

router = APIRouter(prefix="/api", tags=["Languages"])


class LanguageBase(BaseModel):
    id: str
    name_full: str
    position: int
    family: str = ""
    top_level_family: str = ""
    grp: str = ""
    # FK opzionali alla tassonomia (preferite rispetto alle stringhe se passate)
    top_family_id: Optional[int] = None
    family_id: Optional[int] = None
    group_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    historical_language: bool = False
    assigned_user_id: Optional[int] = None
    # Campi metadata aggiuntivi
    isocode: str = ""
    glottocode: str = ""
    informant: str = ""
    supervisor: str = ""
    source: str = ""
    location: str = ""


def validate_coordinates(latitude: Optional[float], longitude: Optional[float]):
    if latitude is not None and not -90 <= latitude <= 90:
        raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90")
    if longitude is not None and not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180")


def ensure_assigned_user_exists(user_id: Optional[int], db: Session):
    if user_id is None:
        return
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Assigned user not found")


def resolve_taxonomy(item: "LanguageBase", db: Session) -> dict:
    """
    Risolve la gerarchia top → family → group:
    - se arriva una stringa senza FK (es. da import Excel/migration o edit
      manuale), prova a risolvere l'FK cercando l'entità con lo stesso nome
      (case-sensitive, coerente con il vincolo unique sui dizionari)
    - se passi group_id, deduce family_id e top_family_id dai parent
    - se passi family_id, deduce top_family_id dal parent
    - sincronizza i campi stringa (top_level_family, family, grp) con i nomi delle entità
    Ritorna un dict {top_family_id, family_id, group_id, top_level_family, family, grp}.
    """
    top_id = item.top_family_id
    fam_id = item.family_id
    grp_id = item.group_id
    top_str = item.top_level_family or ""
    fam_str = item.family or ""
    grp_str = item.grp or ""

    # Reverse lookup: stringa → FK quando la stringa è popolata e l'FK no.
    # Se la stringa non corrisponde a nessuna entità lasciamo l'FK a None: lo
    # stato "stringa unnormalized" resta lecito ed è visibile in /taxonomy.
    # Il forward propagation sotto può comunque sovrascrivere l'FK appena
    # trovato (es. group → family) per garantire la consistenza gerarchica.
    if grp_id is None and grp_str:
        g = db.query(models.Group).filter(models.Group.name == grp_str).first()
        if g:
            grp_id = g.id
    if fam_id is None and fam_str:
        f = db.query(models.Family).filter(models.Family.name == fam_str).first()
        if f:
            fam_id = f.id
    if top_id is None and top_str:
        t = db.query(models.TopFamily).filter(models.TopFamily.name == top_str).first()
        if t:
            top_id = t.id

    if grp_id is not None:
        g = db.get(models.Group, grp_id)
        if not g:
            raise HTTPException(status_code=400, detail="Group not found")
        grp_str = g.name
        if g.family_id is not None:
            fam_id = g.family_id
        elif fam_id is None:
            fam_id = None  # group orfano: lascia family vuota se non specificata

    if fam_id is not None:
        f = db.get(models.Family, fam_id)
        if not f:
            raise HTTPException(status_code=400, detail="Family not found")
        fam_str = f.name
        if f.top_family_id is not None:
            top_id = f.top_family_id

    if top_id is not None:
        t = db.get(models.TopFamily, top_id)
        if not t:
            raise HTTPException(status_code=400, detail="Top-family not found")
        top_str = t.name

    return {
        "top_family_id": top_id,
        "family_id": fam_id,
        "group_id": grp_id,
        "top_level_family": top_str,
        "family": fam_str,
        "grp": grp_str,
    }


@router.get("/public/languages")
def get_public_languages(db: Session = Depends(get_db)):
    langs = db.query(models.Language).all()
    return [
        {
            "id": l.id,
            "name": l.name_full,
            "lat": float(l.latitude) if l.latitude else None,
            "lng": float(l.longitude) if l.longitude else None,
            "family": l.top_level_family,
        }
        for l in langs
    ]


@router.get("/admin/languages")
def get_admin_languages(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Restituisce le lingue.
    Se Admin: tutte.
    Se User: solo quelle assegnate.
    """
    query = db.query(models.Language)

    if current_user.role != "admin":
        query = query.filter(models.Language.assigned_user_id == current_user.id)

    languages = query.order_by(models.Language.position, models.Language.name_full).all()
    return [{
        "id": l.id,
        "name_full": l.name_full,
        "position": l.position,
        "family": l.family,
        "top_level_family": l.top_level_family,
        "grp": l.grp,
        "top_family_id": l.top_family_id,
        "family_id": l.family_id,
        "group_id": l.group_id,
        "latitude": float(l.latitude) if l.latitude is not None else None,
        "longitude": float(l.longitude) if l.longitude is not None else None,
        "historical_language": l.historical_language,
        "assigned_user_id": l.assigned_user_id,
        "isocode": l.isocode or "",
        "glottocode": l.glottocode or "",
        "informant": l.informant or "",
        "supervisor": l.supervisor or "",
        "source": l.source or "",
        "location": l.location or "",
        "status": l.status,
        "rejection_note": l.rejection_note,
        "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
        "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
    } for l in languages]


@router.get("/admin/languages/{id}")
def get_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Recupera una singola lingua con controllo permessi.
    """
    language = db.query(models.Language).filter(models.Language.id == id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    # Se non è admin, deve essere l'assegnatario
    if current_user.role != "admin" and language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this language.")

    return language


@router.post("/admin/languages", status_code=status.HTTP_201_CREATED)
def create_admin_language(item: LanguageBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    validate_coordinates(item.latitude, item.longitude)
    ensure_assigned_user_exists(item.assigned_user_id, db)
    tax = resolve_taxonomy(item, db)

    db_item = models.Language(
        id=item.id,
        name_full=item.name_full,
        position=item.position,
        family=tax["family"],
        top_level_family=tax["top_level_family"],
        grp=tax["grp"],
        top_family_id=tax["top_family_id"],
        family_id=tax["family_id"],
        group_id=tax["group_id"],
        latitude=item.latitude,
        longitude=item.longitude,
        historical_language=item.historical_language,
        assigned_user_id=item.assigned_user_id,
        isocode=item.isocode,
        glottocode=item.glottocode,
        informant=item.informant,
        supervisor=item.supervisor,
        source=item.source,
        location=item.location,
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="create", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create the language (duplicate ID or invalid data).")


@router.put("/admin/languages/{id}")
def update_admin_language(id: str, item: LanguageBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Language not found")

    validate_coordinates(item.latitude, item.longitude)
    ensure_assigned_user_exists(item.assigned_user_id, db)
    tax = resolve_taxonomy(item, db)

    # Gestione rename dell'id: il DB ha ON UPDATE CASCADE su tutte le FK verso
    # languages.id (answers, language_parameters, language_parameter_statuses,
    # submissions), quindi i record collegati vengono aggiornati nella stessa
    # transazione. Le tabelle storiche con language_id denormalizzato senza FK
    # (archived_answers, entity_versions) NON seguono: per design conservano
    # il valore al momento dell'archiviazione/log.
    new_id = (item.id or "").strip()
    if not new_id:
        raise HTTPException(status_code=422, detail="Language ID cannot be empty.")
    if len(new_id) > ID_MAX_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"Language ID exceeds the {ID_MAX_LEN}-character limit.",
        )
    rename_note = None
    old_id = db_item.id
    if new_id != old_id:
        existing = db.query(models.Language.id).filter(models.Language.id == new_id).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Language ID '{new_id}' is already in use.",
            )
        # Il nuovo id non puo' collidere con un alias di un'altra lingua,
        # altrimenti il resolver di restore/import diventerebbe ambiguo.
        conflicting_alias = (
            db.query(models.LanguageAlias)
            .filter(
                models.LanguageAlias.old_id == new_id,
                models.LanguageAlias.language_id != old_id,
            )
            .first()
        )
        if conflicting_alias:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Language ID '{new_id}' is already used as a historical alias "
                    f"of language '{conflicting_alias.language_id}'."
                ),
            )

        # Se il nuovo id era un alias di QUESTA stessa lingua (rename A->B->A),
        # rimuovi quell'alias adesso: tra poco l'id ridiventa "corrente", non
        # piu' "storico".
        db.query(models.LanguageAlias).filter(
            models.LanguageAlias.old_id == new_id,
            models.LanguageAlias.language_id == old_id,
        ).delete(synchronize_session=False)
        # Applica il rename PRIMA di registrare l'alias: cosi' la riga in
        # language_aliases punta direttamente al nuovo id ed evitiamo
        # dipendenze sull'ordine di flush della cascade SQLAlchemy.
        db_item.id = new_id
        db.flush()
        existing_alias = (
            db.query(models.LanguageAlias)
            .filter(models.LanguageAlias.old_id == old_id)
            .first()
        )
        if existing_alias is None:
            db.add(models.LanguageAlias(language_id=new_id, old_id=old_id))

        rename_note = f"Renamed from {old_id} to {new_id}"
    else:
        db_item.id = new_id
    db_item.name_full = item.name_full
    db_item.position = item.position
    db_item.family = tax["family"]
    db_item.top_level_family = tax["top_level_family"]
    db_item.grp = tax["grp"]
    db_item.top_family_id = tax["top_family_id"]
    db_item.family_id = tax["family_id"]
    db_item.group_id = tax["group_id"]
    db_item.latitude = item.latitude
    db_item.longitude = item.longitude
    db_item.historical_language = item.historical_language
    db_item.assigned_user_id = item.assigned_user_id
    db_item.isocode = item.isocode
    db_item.glottocode = item.glottocode
    db_item.informant = item.informant
    db_item.supervisor = item.supervisor
    db_item.source = item.source
    db_item.location = item.location

    try:
        db.commit()
        db.refresh(db_item)
        record_version(
            db, db_item, operation="update", source="manual",
            user_id=current_user.id, note=rename_note,
        )
        db.commit()
        return db_item
    except IntegrityError as e:
        db.rollback()
        # Conserva il messaggio originario del DB nel detail: aiuta a
        # diagnosticare violazioni di unique/FK quando capitano (sennò
        # tutti i 400 risultano indistinguibili).
        raise HTTPException(
            status_code=400,
            detail=f"Could not update the language: {getattr(e, 'orig', e)}",
        )


@router.delete("/admin/languages/{id}")
def delete_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Eliminazione "vera" della lingua: rimuove la riga e, per ON DELETE
    CASCADE a livello DB, tutte le righe figlie/nipote nelle tabelle
    operative (answers, examples, answer_motivations, language_parameters,
    language_parameter_evals, language_parameter_statuses, submissions e
    le loro children, language_aliases).

    NON viene toccato lo storico immutabile:
      - `entity_versions` (History): la timeline della lingua resta visibile;
        prima di cancellare registriamo una nuova entry operation=delete.
      - `archived_answers`: snapshot di question buttate via, language_id
        denormalizzato senza FK.
      - `motivations` (dizionario globale) e altre tabelle non FK.
    """
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Language not found")

    # Snapshot prima del delete: la History conserva il record di quando e
    # da chi e' stata cancellata e in che stato si trovava al momento.
    record_version(
        db, db_item, operation="delete", source="manual",
        user_id=current_user.id,
    )

    db.delete(db_item)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Could not delete the language: {getattr(e, 'orig', e)}",
        )
    return {"detail": "Language deleted successfully"}


# ==========================================
# DUPLICATE LANGUAGE
# Copia integrale della lingua con tutte le risposte, esempi, motivazioni
# e i parametri/eval. Non copia: Submissions (storico) ed EntityVersion (audit).
# Il nuovo ID e il nuovo nome ottengono un suffisso numerico progressivo a
# partire da 2 (es. "It"/"Italian" -> "It2"/"Italian2").
# ==========================================
def _strip_trailing_digits(s: str) -> str:
    return re.sub(r"\d+$", "", s or "")


def _next_duplicate_suffix(db: Session, base_id: str) -> int:
    """Trova il più piccolo N >= 2 tale che base_id+str(N) non sia già in uso."""
    n = 2
    while True:
        candidate = f"{base_id}{n}"
        exists = db.query(models.Language.id).filter(models.Language.id == candidate).first()
        if not exists:
            return n
        n += 1


@router.post("/admin/languages/{id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_admin_language(
    id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    src = db.query(models.Language).filter(models.Language.id == id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Language not found")

    base_id = _strip_trailing_digits(src.id) or src.id
    base_name = _strip_trailing_digits(src.name_full) or src.name_full

    n = _next_duplicate_suffix(db, base_id)
    new_id = f"{base_id}{n}"
    new_name = f"{base_name}{n}"

    if len(new_id) > ID_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Generated id '{new_id}' exceeds {ID_MAX_LEN} characters; rename the source language first.",
        )

    max_pos = db.query(models.Language.position).order_by(models.Language.position.desc()).first()
    new_position = (max_pos[0] if max_pos else 0) + 1

    new_lang = models.Language(
        id=new_id,
        name_full=new_name,
        position=new_position,
        family=src.family,
        top_level_family=src.top_level_family,
        grp=src.grp,
        top_family_id=src.top_family_id,
        family_id=src.family_id,
        group_id=src.group_id,
        latitude=src.latitude,
        longitude=src.longitude,
        historical_language=src.historical_language,
        isocode=src.isocode,
        glottocode=src.glottocode,
        informant=src.informant,
        supervisor=src.supervisor,
        source=src.source,
        location=src.location,
        assigned_user_id=src.assigned_user_id,
        status=src.status,
        rejection_note=src.rejection_note,
        submitted_at=src.submitted_at,
        reviewed_at=src.reviewed_at,
    )
    db.add(new_lang)
    db.flush()

    # Answers (+ esempi, + answer_motivations) — copia integrale.
    src_answers = db.query(models.Answer).filter(models.Answer.language_id == src.id).all()
    for a in src_answers:
        new_a = models.Answer(
            language_id=new_lang.id,
            question_id=a.question_id,
            status=a.status,
            response_text=a.response_text,
            comments=a.comments,
        )
        db.add(new_a)
        db.flush()

        for ex in a.examples:
            db.add(models.Example(
                answer_id=new_a.id,
                number=ex.number,
                textarea=ex.textarea,
                transliteration=ex.transliteration,
                gloss=ex.gloss,
                translation=ex.translation,
                reference=ex.reference,
            ))

        for am in a.answer_motivations:
            db.add(models.AnswerMotivation(
                answer_id=new_a.id,
                motivation_id=am.motivation_id,
            ))

    # Stato di compilazione per parametro (is_unsure)
    src_statuses = (
        db.query(models.LanguageParameterStatus)
        .filter(models.LanguageParameterStatus.language_id == src.id)
        .all()
    )
    for s in src_statuses:
        db.add(models.LanguageParameterStatus(
            language_id=new_lang.id,
            parameter_id=s.parameter_id,
            is_unsure=s.is_unsure,
        ))

    # Valori dei parametri + valutazione DAG
    src_params = (
        db.query(models.LanguageParameter)
        .filter(models.LanguageParameter.language_id == src.id)
        .all()
    )
    for lp in src_params:
        new_lp = models.LanguageParameter(
            language_id=new_lang.id,
            parameter_id=lp.parameter_id,
            value_orig=lp.value_orig,
            warning_orig=lp.warning_orig,
        )
        db.add(new_lp)
        db.flush()
        if lp.eval is not None:
            db.add(models.LanguageParameterEval(
                language_parameter_id=new_lp.id,
                value_eval=lp.eval.value_eval,
                warning_eval=lp.eval.warning_eval,
            ))

    try:
        db.commit()
        db.refresh(new_lang)
        record_version(
            db, new_lang, operation="create", source="manual",
            user_id=current_user.id, note=f"Duplicated from {src.id}",
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not duplicate the language (data conflict).")

    return {
        "id": new_lang.id,
        "name_full": new_lang.name_full,
        "source_id": src.id,
    }