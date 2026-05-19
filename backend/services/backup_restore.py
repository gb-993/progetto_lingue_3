"""
Backup Restore: importa un bundle ZIP prodotto da `build_backup_zip_bytes` o
`build_full_backup_zip_bytes`.

Bundle base (PCM_backup_*.zip):

    ├── schema.xlsx              (4 sheet: Motivations, Parameters, Questions, QAM)
    ├── languages_metadata.xlsx  (1 sheet: Languages)
    ├── glossary.xlsx            (1 sheet: Glossary)
    └── languages/
        ├── <ID>.xlsx            (Database_model esteso, Answers, Examples, Admin Notes)
        └── ...

Bundle full (PCM_full_backup_*.zip): stesso contenuto del bundle base + cartella
`extras/` con site_content, submissions, parameter_submissions, archived_questions.

Strategia (sempre upsert, mai delete):
  1. schema.xlsx          -> upsert Motivations / Parameters / Questions / QAM
  2. languages_metadata   -> upsert Language per ID (creando o aggiornando metadata)
  3. glossary.xlsx        -> upsert Glossary per word
  4. languages/<id>.xlsx  -> REPLACE compilazione (Answer/Example/AnswerMotivation)
                            + ripristino admin_note per (lang, param)
  5. extras/* (se presenti):
     - site_content.xlsx       -> upsert per chiave naturale `key`
     - submissions/parameter_submissions/archived_questions: ripristinati SOLO
       se wipe=True. Hanno PK auto-increment senza chiave naturale: ricreare
       senza wipe genererebbe duplicati di snapshot. Le tabelle snapshot
       andrebbero rifatte fresche o non toccate, mai mergiate.

Le entità non menzionate restano in DB (no delete). Per un wipe-and-restore
totale usare `wipe=True`: tronca le tabelle dati prima di importare. Gli utenti
non vengono toccati.

Fasi tracciate via `services.migration_progress` (riusato — stesso pattern dei
job di Migration Import). Ogni xlsx del bundle è una "tick" individuale per la
fase di compilation; le altre fasi sono single-tick.

Endpoint chiamante: routers/backup_restore.py
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
import io
import os
import zipfile

from openpyxl import load_workbook
from sqlalchemy.orm import Session

import models
from services.language_alias import resolve_language
from services.excel_import import import_excel, ImportReport
from services.migration_progress import ProgressReporter, NULL_PROGRESS
from services.dag_eval import run_dag_for_language


# ============================================================================
# Report
# ============================================================================

@dataclass
class BackupRestoreReport:
    files_processed: List[str] = field(default_factory=list)
    files_skipped: List[str] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    by_file: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    languages_restored: List[str] = field(default_factory=list)
    languages_failed: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "files_processed": self.files_processed,
            "files_skipped": self.files_skipped,
            "errors": self.errors,
            "by_file": self.by_file,
            "languages_restored": self.languages_restored,
            "languages_failed": self.languages_failed,
            "total_errors": len(self.errors),
        }


def _absorb_sub_report(report: BackupRestoreReport, file_name: str, sub: ImportReport) -> None:
    """Copia gli errori e summary di una `import_excel` interna nel report globale."""
    report.files_processed.append(file_name)
    report.by_file[file_name] = {
        "sheets_processed": sub.sheets_processed,
        "by_sheet": {k: v.to_dict() for k, v in sub.by_sheet.items()},
        "errors_count": len(sub.errors),
    }
    for e in sub.errors:
        d = e.to_dict()
        d["_file"] = file_name
        report.errors.append(d)


# ============================================================================
# Wipe (operazione facoltativa, distruttiva)
# ============================================================================

# Stesse tabelle wipate da migration_import.import_migration_bundle (in ordine
# FK-safe). Le copio qui perché backup_restore non vuole dipendere dall'altro
# servizio: condividono solo lo schema dati.
_WIPE_TABLES_FK_SAFE = [
    "answer_motivations",
    "examples",
    "answers",
    "language_parameter_evals",
    "language_parameters",
    "language_parameter_statuses",
    "submission_answer_motivations",
    "submission_examples",
    "submission_params",
    "submission_answers",
    "submissions",
    # Archive question tree (figli prima dei genitori)
    "archived_answer_motivations",
    "archived_examples",
    "archived_answers",
    "archived_question_motivations",
    "archived_questions",
    # Parameter submissions (snapshot definizioni parametri)
    "parameter_submission_allowed_motivations",
    "parameter_submission_questions",
    "parameter_submissions",
    "question_allowed_motivations",
    "questions",
    "parameter_change_logs",
    "parameter_defs",
    "motivations",
    "languages",
    "groups",
    "families",
    "top_families",
    "glossary",
    # Contenuti dinamici editabili (HowToCite/About)
    "site_contents",
]


def _wipe_data(db: Session) -> None:
    from sqlalchemy import text
    for tbl in _WIPE_TABLES_FK_SAFE:
        try:
            db.execute(text(f"DELETE FROM {tbl}"))
        except Exception:
            # Tabella inesistente nel DB corrente: skip senza errore
            db.rollback()
    db.commit()


# ============================================================================
# Entry point
# ============================================================================

SCHEMA_FILE = "schema.xlsx"
METADATA_FILE = "languages_metadata.xlsx"
GLOSSARY_FILE = "glossary.xlsx"
LANG_DIR = "languages/"
EXTRAS_DIR = "extras/"


def restore_backup_bundle(
    db: Session,
    zip_bytes: bytes,
    current_user_id: int,
    *,
    wipe: bool = False,
    progress: ProgressReporter = NULL_PROGRESS,
) -> BackupRestoreReport:
    report = BackupRestoreReport()

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except zipfile.BadZipFile as e:
        report.errors.append({"_file": "(bundle)", "reason": f"Not a valid ZIP file: {e}"})
        return report

    namelist = zf.namelist()

    if wipe:
        progress.phase("wipe", "Wiping data tables…", total=1)
        try:
            _wipe_data(db)
            progress.tick(1)
        except Exception as e:
            report.errors.append({"_file": "(wipe)", "reason": f"Wipe failed: {e}"})
            return report

    # 1. Schema (richiesto)
    if SCHEMA_FILE in namelist:
        progress.phase("schema", "Importing schema…", total=1)
        with zf.open(SCHEMA_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, SCHEMA_FILE, sub)
        progress.tick(1)
    else:
        report.errors.append({"_file": SCHEMA_FILE, "reason": "Missing schema.xlsx in bundle"})

    # 2. Languages metadata
    if METADATA_FILE in namelist:
        progress.phase("metadata", "Importing languages metadata…", total=1)
        with zf.open(METADATA_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, METADATA_FILE, sub)
        progress.tick(1)
    else:
        report.files_skipped.append(METADATA_FILE)

    # 3. Glossary
    if GLOSSARY_FILE in namelist:
        progress.phase("glossary", "Importing glossary…", total=1)
        with zf.open(GLOSSARY_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, GLOSSARY_FILE, sub)
        progress.tick(1)
    else:
        report.files_skipped.append(GLOSSARY_FILE)

    # 4. Per-language compilation
    lang_files = sorted(
        n for n in namelist
        if n.startswith(LANG_DIR) and n.endswith(".xlsx") and not n.endswith("/")
    )
    total = len(lang_files)
    progress.phase("compilation", f"Restoring {total} language(s)…", total=total)
    for i, name in enumerate(lang_files, start=1):
        lang_id = os.path.splitext(os.path.basename(name))[0]
        progress.tick(current=i, label=f"Restoring {lang_id} ({i}/{total})")
        try:
            with zf.open(name) as f:
                sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        except Exception as e:
            report.errors.append({"_file": name, "reason": f"Cannot read entry: {e}"})
            report.languages_failed.append(lang_id)
            continue
        _absorb_sub_report(report, name, sub)
        if sub.errors:
            report.languages_failed.append(lang_id)
        else:
            report.languages_restored.append(lang_id)

    # 5. Extras (bundle full): site_content sempre upsertato, le tabelle
    # snapshot (submissions/parameter_submissions/archived_questions) solo se
    # wipe=True per evitare duplicati su PK auto-increment.
    extras_files = [n for n in namelist if n.startswith(EXTRAS_DIR) and n.endswith(".xlsx")]
    if extras_files:
        progress.phase("extras", f"Restoring {len(extras_files)} extra file(s)…", total=len(extras_files))
        for i, name in enumerate(extras_files, start=1):
            base = os.path.basename(name)
            progress.tick(current=i, label=f"Restoring {base} ({i}/{len(extras_files)})")
            try:
                with zf.open(name) as f:
                    data = f.read()
                handler = _EXTRAS_HANDLERS.get(base)
                if handler is None:
                    report.files_skipped.append(name)
                    continue
                handler(db, data, name, report, wipe=wipe)
            except Exception as e:
                report.errors.append({"_file": name, "reason": f"Cannot restore extras: {e}"})
                db.rollback()

    # 6. Recompute final values: il bundle contiene risposte/esempi/motivazioni
    # ma NON i value_orig/value_eval calcolati. Senza questo step, dopo un
    # wipe+restore la tabella `language_parameters` resta vuota e TableA /
    # dashboard / debug parametri appaiono "vuote". Eseguiamo il DAG per
    # ciascuna lingua restorata.
    if report.languages_restored:
        n_lang = len(report.languages_restored)
        progress.phase("recompute", f"Recomputing final values for {n_lang} language(s)…", total=n_lang)
        for i, lang_id in enumerate(report.languages_restored, start=1):
            progress.tick(current=i, label=f"Recomputing {lang_id} ({i}/{n_lang})")
            try:
                run_dag_for_language(lang_id, db)
                db.commit()
            except Exception as e:
                db.rollback()
                report.errors.append({"_file": f"recompute/{lang_id}", "reason": f"Recompute failed: {e}"})

    return report


# ============================================================================
# Extras handlers
# ============================================================================
#
# Ogni handler legge un xlsx in formato noto (vedi services/excel_export.py per
# la definizione dei sheet) e ripristina le righe nelle tabelle DB. Il pattern
# generale per le tabelle gerarchiche è: inserisci il parent senza id esplicito
# (così la PK auto-increment non collide con il valore originario), tieni una
# mappa `old_id -> new_id`, poi inserisci i child rimappando l'FK.
# ============================================================================


def _read_sheet_rows(data: bytes, sheet_name: str):
    """Restituisce (headers, rows) o (None, None) se lo sheet non esiste.

    `rows` è un generatore di dict header→value (esclusa l'intestazione).
    Le righe completamente vuote vengono filtrate."""
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    if sheet_name not in wb.sheetnames:
        return None, None
    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers = list(next(rows_iter))
    except StopIteration:
        return [], iter([])

    def _generator():
        for row in rows_iter:
            if not any(c is not None and c != "" for c in row):
                continue
            yield dict(zip(headers, row))

    return headers, _generator()


def _user_id_by_email(db: Session) -> Dict[str, int]:
    return {u.email: u.id for u in db.query(models.User).all() if u.email}


def _yn_to_bool(v) -> bool:
    s = (str(v) if v is not None else "").strip().lower()
    return s in ("yes", "true", "1", "y")


def _restore_site_content(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport", *, wipe: bool
) -> None:
    """Upsert per chiave naturale (`key`). Funziona sia con wipe sia senza."""
    headers, rows = _read_sheet_rows(data, "SiteContents")
    if rows is None:
        report.files_skipped.append(name)
        return

    user_id_by_email = _user_id_by_email(db)
    inserted = updated = 0
    for d in rows:
        key = d.get("Key")
        if not key:
            continue
        existing = db.query(models.SiteContent).filter(models.SiteContent.key == key).first()
        updated_by_id = user_id_by_email.get(d.get("Updated By Email")) if d.get("Updated By Email") else None
        if existing:
            existing.content = d.get("Content") or ""
            existing.page = d.get("Page")
            existing.updated_by_id = updated_by_id
            updated += 1
        else:
            db.add(models.SiteContent(
                key=key,
                content=d.get("Content") or "",
                page=d.get("Page"),
                updated_by_id=updated_by_id,
            ))
            inserted += 1
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {"inserted": inserted, "updated": updated}


def _restore_submissions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport", *, wipe: bool
) -> None:
    """Snapshot di lingue inviate per approvazione. Restorato SOLO con wipe=True."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    id_map: Dict[int, int] = {}

    # Master
    _, rows = _read_sheet_rows(data, "Submissions")
    if rows is None:
        report.files_skipped.append(name)
        return
    n_master = 0
    for d in rows:
        old_id = d.get("ID")
        if old_id is None:
            continue
        # Risoluzione del Language ID dal file: prima cerca l'id corrente,
        # poi gli alias storici (lingua rinominata dopo l'export). Se non
        # trovato, segnala l'errore e salta la submission.
        file_lang_id = d.get("Language ID") or ""
        resolved = resolve_language(db, file_lang_id)
        if resolved.language is None:
            report.errors.append({
                "_file": name, "_row_id": int(old_id),
                "reason": f"Language '{file_lang_id}' not found (no current id, no historical alias).",
            })
            continue
        s = models.Submission(
            language_id=resolved.language.id,
            submitted_by_id=user_id_by_email.get(d.get("Submitted By Email")) if d.get("Submitted By Email") else None,
            submitted_at=d.get("Submitted At"),
            note=d.get("Note") or "",
        )
        db.add(s)
        db.flush()
        id_map[int(old_id)] = s.id
        n_master += 1

    # Children: SubmissionAnswers
    n_ans = n_ex = n_amot = n_par = 0
    _, rows = _read_sheet_rows(data, "SubmissionAnswers")
    if rows is not None:
        for d in rows:
            new_sid = id_map.get(int(d["Submission ID"])) if d.get("Submission ID") is not None else None
            if new_sid is None:
                continue
            db.add(models.SubmissionAnswer(
                submission_id=new_sid,
                question_code=d.get("Question Code") or "",
                response_text=d.get("Response Text") or None,
                comments=d.get("Comments"),
            ))
            n_ans += 1

    _, rows = _read_sheet_rows(data, "SubmissionExamples")
    if rows is not None:
        for d in rows:
            new_sid = id_map.get(int(d["Submission ID"])) if d.get("Submission ID") is not None else None
            if new_sid is None:
                continue
            db.add(models.SubmissionExample(
                submission_id=new_sid,
                question_code=d.get("Question Code") or "",
                textarea=d.get("Textarea"),
                transliteration=d.get("Transliteration"),
                gloss=d.get("Gloss"),
                translation=d.get("Translation"),
                reference=d.get("Reference"),
            ))
            n_ex += 1

    _, rows = _read_sheet_rows(data, "SubmissionAnswerMotivations")
    if rows is not None:
        for d in rows:
            new_sid = id_map.get(int(d["Submission ID"])) if d.get("Submission ID") is not None else None
            if new_sid is None:
                continue
            db.add(models.SubmissionAnswerMotivation(
                submission_id=new_sid,
                question_code=d.get("Question Code") or "",
                motivation_code=d.get("Motivation Code") or "",
                motivation_label=d.get("Motivation Label"),
            ))
            n_amot += 1

    _, rows = _read_sheet_rows(data, "SubmissionParams")
    if rows is not None:
        for d in rows:
            new_sid = id_map.get(int(d["Submission ID"])) if d.get("Submission ID") is not None else None
            if new_sid is None:
                continue
            db.add(models.SubmissionParam(
                submission_id=new_sid,
                parameter_id=d.get("Parameter ID") or "",
                value_orig=d.get("Value Orig") or None,
                warning_orig=_yn_to_bool(d.get("Warning Orig")),
                value_eval=d.get("Value Eval") or None,
                warning_eval=_yn_to_bool(d.get("Warning Eval")),
                evaluated_at=d.get("Evaluated At"),
            ))
            n_par += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "submissions": n_master, "answers": n_ans,
        "examples": n_ex, "answer_motivations": n_amot, "params": n_par,
    }


def _restore_parameter_submissions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport", *, wipe: bool
) -> None:
    """Snapshot delle definizioni di parametri. Restorato SOLO con wipe=True."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    sub_id_map: Dict[int, int] = {}
    q_id_map: Dict[int, int] = {}

    _, rows = _read_sheet_rows(data, "ParameterSubmissions")
    if rows is None:
        report.files_skipped.append(name)
        return
    n_master = 0
    for d in rows:
        old_id = d.get("ID")
        if old_id is None:
            continue
        ps = models.ParameterSubmission(
            parameter_id=d.get("Parameter ID") or "",
            parameter_name=d.get("Parameter Name") or "",
            submitted_by_id=user_id_by_email.get(d.get("Submitted By Email")) if d.get("Submitted By Email") else None,
            submitted_at=d.get("Submitted At"),
            note=d.get("Note") or "",
            short_description=d.get("Short Description") or "",
            long_description=d.get("Long Description") or "",
            implicational_condition=d.get("Implicational Condition") or None,
            description_of_the_implicational_condition=d.get("Description Of Implicational Condition") or "",
            is_active=_yn_to_bool(d.get("Is Active")),
            position=int(d["Position"]) if d.get("Position") not in (None, "") else None,
            schema=d.get("Schema") or "",
            param_type=d.get("Param Type") or "",
            level_of_comparison=d.get("Level Of Comparison") or "",
        )
        db.add(ps)
        db.flush()
        sub_id_map[int(old_id)] = ps.id
        n_master += 1

    n_q = n_am = 0
    _, rows = _read_sheet_rows(data, "Questions")
    if rows is not None:
        for d in rows:
            old_id = d.get("ID")
            new_sid = sub_id_map.get(int(d["Submission ID"])) if d.get("Submission ID") is not None else None
            if old_id is None or new_sid is None:
                continue
            psq = models.ParameterSubmissionQuestion(
                submission_id=new_sid,
                question_code=d.get("Question Code") or "",
                text=d.get("Text") or "",
                template_type=d.get("Template Type") or "",
                instruction=d.get("Instruction"),
                instruction_yes=d.get("Instruction YES"),
                instruction_no=d.get("Instruction NO"),
                example_yes=d.get("Example YES"),
                help_info=d.get("Help Info"),
                is_stop_question=_yn_to_bool(d.get("Is Stop Question")),
                is_active=_yn_to_bool(d.get("Is Active")),
            )
            db.add(psq)
            db.flush()
            q_id_map[int(old_id)] = psq.id
            n_q += 1

    _, rows = _read_sheet_rows(data, "AllowedMotivations")
    if rows is not None:
        for d in rows:
            new_qid = q_id_map.get(int(d["Question ID"])) if d.get("Question ID") is not None else None
            if new_qid is None:
                continue
            db.add(models.ParameterSubmissionAllowedMotivation(
                question_id=new_qid,
                motivation_code=d.get("Motivation Code") or "",
                motivation_label=d.get("Motivation Label") or "",
            ))
            n_am += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "parameter_submissions": n_master, "questions": n_q, "allowed_motivations": n_am,
    }


def _restore_archived_questions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport", *, wipe: bool
) -> None:
    """Archivio di domande dismesse + answer/example/motivation collegate.
    Restorato SOLO con wipe=True (PK auto-increment, niente chiave naturale)."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    aq_map: Dict[int, int] = {}
    aa_map: Dict[int, int] = {}

    _, rows = _read_sheet_rows(data, "ArchivedQuestions")
    if rows is None:
        report.files_skipped.append(name)
        return
    n_q = 0
    for d in rows:
        old_id = d.get("ID")
        if old_id is None:
            continue
        aq = models.ArchivedQuestion(
            original_question_id=d.get("Original Question ID") or "",
            parameter_id=d.get("Parameter ID") or "",
            parameter_name=d.get("Parameter Name") or "",
            text=d.get("Text") or "",
            template_type=d.get("Template Type") or "",
            instruction=d.get("Instruction"),
            instruction_yes=d.get("Instruction YES"),
            instruction_no=d.get("Instruction NO"),
            example_yes=d.get("Example YES"),
            help_info=d.get("Help Info"),
            is_stop_question=_yn_to_bool(d.get("Is Stop Question")),
            is_active=_yn_to_bool(d.get("Is Active")),
            archived_at=d.get("Archived At"),
            archived_by_id=user_id_by_email.get(d.get("Archived By Email")) if d.get("Archived By Email") else None,
            archive_note=d.get("Archive Note") or "",
            answers_count=int(d.get("Answers Count") or 0),
            examples_count=int(d.get("Examples Count") or 0),
        )
        db.add(aq)
        db.flush()
        aq_map[int(old_id)] = aq.id
        n_q += 1

    n_qm = n_a = n_ex = n_am = 0

    _, rows = _read_sheet_rows(data, "ArchivedQuestionMotivations")
    if rows is not None:
        for d in rows:
            new_aqid = aq_map.get(int(d["Archived Question ID"])) if d.get("Archived Question ID") is not None else None
            if new_aqid is None:
                continue
            db.add(models.ArchivedQuestionMotivation(
                archived_question_id=new_aqid,
                motivation_code=d.get("Motivation Code") or "",
                motivation_label=d.get("Motivation Label") or "",
            ))
            n_qm += 1

    _, rows = _read_sheet_rows(data, "ArchivedAnswers")
    if rows is not None:
        for d in rows:
            old_id = d.get("ID")
            new_aqid = aq_map.get(int(d["Archived Question ID"])) if d.get("Archived Question ID") is not None else None
            if old_id is None or new_aqid is None:
                continue
            aa = models.ArchivedAnswer(
                archived_question_id=new_aqid,
                language_id=d.get("Language ID") or "",
                language_name_full=d.get("Language Name Full") or "",
                status=d.get("Status") or None,
                response_text=d.get("Response Text") or None,
                comments=d.get("Comments"),
                original_updated_at=d.get("Original Updated At"),
            )
            db.add(aa)
            db.flush()
            aa_map[int(old_id)] = aa.id
            n_a += 1

    _, rows = _read_sheet_rows(data, "ArchivedExamples")
    if rows is not None:
        for d in rows:
            new_aaid = aa_map.get(int(d["Archived Answer ID"])) if d.get("Archived Answer ID") is not None else None
            if new_aaid is None:
                continue
            db.add(models.ArchivedExample(
                archived_answer_id=new_aaid,
                number=d.get("Number") or "",
                textarea=d.get("Textarea"),
                transliteration=d.get("Transliteration"),
                gloss=d.get("Gloss"),
                translation=d.get("Translation"),
                reference=d.get("Reference"),
            ))
            n_ex += 1

    _, rows = _read_sheet_rows(data, "ArchivedAnswerMotivations")
    if rows is not None:
        for d in rows:
            new_aaid = aa_map.get(int(d["Archived Answer ID"])) if d.get("Archived Answer ID") is not None else None
            if new_aaid is None:
                continue
            db.add(models.ArchivedAnswerMotivation(
                archived_answer_id=new_aaid,
                motivation_code=d.get("Motivation Code") or "",
                motivation_label=d.get("Motivation Label") or "",
            ))
            n_am += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "archived_questions": n_q, "question_motivations": n_qm,
        "archived_answers": n_a, "examples": n_ex, "answer_motivations": n_am,
    }


_EXTRAS_HANDLERS = {
    "site_content.xlsx": _restore_site_content,
    "submissions.xlsx": _restore_submissions,
    "parameter_submissions.xlsx": _restore_parameter_submissions,
    "archived_questions.xlsx": _restore_archived_questions,
}
