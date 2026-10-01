"""Export Excel: header fissi e round-trip su un mini-DB."""
import io
import zipfile
from datetime import datetime

import pytest
from openpyxl import Workbook, load_workbook

import models
from services.excel_export import (
    build_language_workbook,
    build_parameter_data_matrix_workbook,
    build_language_list_workbook,
    build_schema_workbook,
    build_glossary_workbook,
    build_backup_zip_bytes,
    DATABASE_MODEL_HEADERS,
    EXAMPLES_HEADERS,
    ANSWERS_HEADERS,
    LANGUAGE_LIST_HEADERS,
    MOTIVATIONS_HEADERS,
    PARAMETERS_HEADERS,
    QUESTIONS_HEADERS,
    QUESTION_ALLOWED_MOTIVATIONS_HEADERS,
    GLOSSARY_HEADERS,
)


_EXPECTED_DATABASE_MODEL_HEADERS = [
    "Language",
    "Parameter_Label",
    "Question_ID",
    "Language_Answer",
    "Language_Comments",
    "Language_Examples",
    "Language_Example_Transliteration",
    "Language_Example_Gloss",
    "Language_Example_Translation",
    "Language_References",
    "Language_Example_Is_Test",
    "Motivations",
    "Admin_Note",
]

_OLD_EXAMPLES_HEADERS = [
    "Language ID", "Question ID", "Example #",
    "Example text", "Transliteration", "Gloss", "English translation", "Reference",
    "Is Test",
]

_OLD_ANSWERS_HEADERS = [
    "Language ID", "Parameter Label", "Question ID", "Question",
    "Question status", "Answer", "Parameter value", "Motivation", "Comments",
]


def test_database_model_headers():
    assert DATABASE_MODEL_HEADERS == _EXPECTED_DATABASE_MODEL_HEADERS, (
        "Modifica all'ordine/contenuto delle colonne di 'Database_model'. "
        "Questo foglio è la fonte canonica per re-import / backup-restore. "
        "Verifica services/excel_export.py e services/excel_import.py "
        "(_import_compilation) restino allineati."
    )


def test_examples_headers_match_legacy():
    assert EXAMPLES_HEADERS == _OLD_EXAMPLES_HEADERS


def test_answers_headers_match_legacy():
    assert ANSWERS_HEADERS == _OLD_ANSWERS_HEADERS


def test_database_model_headers_count():
    assert len(DATABASE_MODEL_HEADERS) == 13


def test_examples_headers_count():
    assert len(EXAMPLES_HEADERS) == 9


def test_answers_headers_count():
    assert len(ANSWERS_HEADERS) == 9


def _seed_basic(db_session):
    """Mini-DB: 1 lingua, 1 parametro, 2 domande con risposta."""
    user = models.User(
        email="alice@test.it", hashed_password="x", name="Alice", surname="Smith", role="user"
    )
    db_session.add(user); db_session.flush()

    lang = models.Language(
        id="ITA", name_full="Italiano", position=1,
        family="Romance", top_level_family="Indo-European", grp="Italo-Western",
        latitude=42.5, longitude=12.0, historical_language=False,
        isocode="it", glottocode="ital1282",
        informant="Mario Rossi", supervisor="Cristina Guardiano",
        source="Various sources", location="Italia",
        assigned_user_id=user.id,
    )
    db_session.add(lang)

    param = models.ParameterDef(
        id="FGM", position=1, name="Feature Geometry Marker",
        short_description="Test param", long_description="A longer description",
        implicational_condition="+ABC | -DEF",
        description_of_the_implicational_condition="Holds when ABC=+ or DEF=-",
        is_active=True, schema="Nominal", param_type="Binary", level_of_comparison="Macro",
    )
    db_session.add(param)

    q1 = models.Question(
        id="FGM_01", parameter_id="FGM", text="Does it have FGM marker?",
        instruction="Look for it.", instruction_yes="Provide examples.",
        instruction_no="Explain motivation.",
        example_yes="e.g. il libro = the book",
        help_info="More background info here.",
        is_stop_question=False, is_active=True,
    )
    q2 = models.Question(
        id="FGM_02", parameter_id="FGM", text="Is it productive?",
        is_stop_question=False, is_active=True,
    )
    db_session.add_all([q1, q2])

    mot = models.Motivation(code="MOT_X", label="Not applicable")
    db_session.add(mot); db_session.flush()

    qam = models.QuestionAllowedMotivation(question_id="FGM_02", motivation_id=mot.id)
    db_session.add(qam)

    ans1 = models.Answer(
        language_id="ITA", question_id="FGM_01",
        response_text="yes", comments="Some comment", status="approved",
    )
    ans2 = models.Answer(
        language_id="ITA", question_id="FGM_02",
        response_text="no", comments="", status="approved",
    )
    db_session.add_all([ans1, ans2]); db_session.flush()

    db_session.add(models.AnswerMotivation(answer_id=ans2.id, motivation_id=mot.id))

    for i, txt in enumerate(["Esempio uno", "Esempio due", "Esempio tre"], start=1):
        db_session.add(models.Example(
            answer_id=ans1.id, number=str(i),
            textarea=txt,
            transliteration=f"trans-{i}", gloss=f"gloss-{i}",
            translation=f"translation-{i}", reference=f"ref-{i}",
        ))

    db_session.commit()
    return lang


def _read_workbook_from_memory(wb: Workbook) -> Workbook:
    """Salva e riapre il workbook."""
    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    return load_workbook(buf, data_only=True)


def test_language_workbook_admin_has_four_sheets(db_session):
    """Admin: 4 sheet, senza i fogli di schema."""
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    assert wb2.sheetnames == [
        "Database_model", "Answers", "Examples", "Admin Notes",
    ]


def test_language_workbook_user_has_only_examples(db_session):
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=False)
    wb2 = _read_workbook_from_memory(wb)
    assert wb2.sheetnames == ["Examples"]


def test_database_model_sheet_headers_and_count(db_session):
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Database_model"]
    headers = [c.value for c in ws[1]]
    assert headers == _EXPECTED_DATABASE_MODEL_HEADERS


def test_database_model_shows_missing_answer(db_session):
    """'missing' esce come 'MISSING'."""
    user = models.User(email="b@test.it", hashed_password="x", name="B", surname="B", role="user")
    db_session.add(user); db_session.flush()
    db_session.add(models.Language(id="ENG", name_full="English", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="Q?", is_active=True))
    db_session.add(models.Answer(
        language_id="ENG", question_id="P1_01", response_text="missing", status="approved",
    ))
    db_session.commit()

    lang = db_session.query(models.Language).filter_by(id="ENG").first()
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Database_model"]
    headers = [c.value for c in ws[1]]
    ans_col = headers.index("Language_Answer") + 1
    assert ws.cell(row=2, column=ans_col).value == "MISSING"


def test_parameter_data_matrix_workbook(db_session):
    """Righe = lingue, colonne = question, celle = esempi numerati."""
    _seed_basic(db_session)
    param = db_session.query(models.ParameterDef).filter_by(id="FGM").first()
    wb = build_parameter_data_matrix_workbook(db_session, param)
    wb2 = _read_workbook_from_memory(wb)

    assert wb2.sheetnames == ["Data"]
    ws = wb2["Data"]
    # question ordinate per is_stop_question, id
    assert ws["A1"].value == "Language"
    assert ws["B1"].value == "FGM_01"
    assert ws["C1"].value == "FGM_02"
    assert ws["B2"].value == "Does it have FGM marker?"
    assert ws["A3"].value == "ITA — Italiano"
    assert ws["B3"].value == "1) Esempio uno\n\n2) Esempio due\n\n3) Esempio tre"
    assert (ws["C3"].value or "") == ""

    data_rows = [r for r in ws.iter_rows(min_row=2, values_only=True)]
    assert len(data_rows) == 2


def test_database_model_sheet_examples_concatenation(db_session):
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Database_model"]
    h = {name: i for i, name in enumerate(_EXPECTED_DATABASE_MODEL_HEADERS)}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[h["Question_ID"]] == "FGM_01":
            assert row[h["Language_Examples"]] == "Esempio uno\nEsempio due\nEsempio tre"
            assert row[h["Language_Example_Transliteration"]] == "trans-1\ntrans-2\ntrans-3"
            assert row[h["Language_Example_Gloss"]] == "gloss-1\ngloss-2\ngloss-3"
            assert row[h["Language_Example_Translation"]] == "translation-1\ntranslation-2\ntranslation-3"
            assert row[h["Language_References"]] == "ref-1\nref-2\nref-3"
            break
    else:
        pytest.fail("Riga FGM_01 non trovata in Database_model")


def test_examples_sheet_one_row_per_example(db_session):
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Examples"]
    headers = [c.value for c in ws[1]]
    assert headers == _OLD_EXAMPLES_HEADERS
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True)]
    assert len(rows) == 3
    assert rows[0][0] == "ITA"
    assert rows[0][1] == "FGM_01"
    assert rows[0][2] == "1"
    assert rows[0][3] == "Esempio uno"


def test_answers_sheet_headers_and_motivations(db_session):
    lang = _seed_basic(db_session)
    wb = build_language_workbook(db_session, lang, is_admin=True)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Answers"]
    headers = [c.value for c in ws[1]]
    assert headers == _OLD_ANSWERS_HEADERS
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True)]
    fgm02 = next(r for r in rows if r[2] == "FGM_02")
    assert fgm02[5] == "no"  # Answer
    assert fgm02[7] == "Not applicable"  # Motivation


def test_schema_sheets_have_correct_headers(db_session):
    _seed_basic(db_session)
    wb = build_schema_workbook(db_session)
    wb2 = _read_workbook_from_memory(wb)
    assert wb2.sheetnames == [
        "Motivations", "Parameters", "Questions", "QuestionAllowedMotivations",
    ]
    assert [c.value for c in wb2["Motivations"][1]] == MOTIVATIONS_HEADERS
    assert [c.value for c in wb2["Parameters"][1]] == PARAMETERS_HEADERS
    assert [c.value for c in wb2["Questions"][1]] == QUESTIONS_HEADERS
    assert [c.value for c in wb2["QuestionAllowedMotivations"][1]] == QUESTION_ALLOWED_MOTIVATIONS_HEADERS


def test_schema_workbook_data_rows(db_session):
    _seed_basic(db_session)
    wb = build_schema_workbook(db_session)
    wb2 = _read_workbook_from_memory(wb)

    rows = list(wb2["Motivations"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 1
    assert rows[0][1] == "MOT_X"

    rows = list(wb2["Parameters"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 1
    assert rows[0][0] == "FGM"

    rows = list(wb2["Questions"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 2

    rows = list(wb2["QuestionAllowedMotivations"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 1
    assert rows[0] == ("FGM_02", "MOT_X")


def test_language_list_workbook(db_session):
    _seed_basic(db_session)
    languages = db_session.query(models.Language).all()
    wb = build_language_list_workbook(db_session, languages)
    wb2 = _read_workbook_from_memory(wb)
    assert wb2.sheetnames == ["Languages"]
    headers = [c.value for c in wb2["Languages"][1]]
    assert headers == LANGUAGE_LIST_HEADERS
    rows = list(wb2["Languages"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 1
    assert rows[0][0] == "Italiano"  # Name
    assert rows[0][1] == "ITA"       # ID
    assert rows[0][5] == "it"        # ISO code
    assert rows[0][12] == "No"  # Historical
    assert rows[0][14] == "draft"  # Status


def test_language_list_user_metadata_export_works_with_zero_languages(db_session):
    wb = build_language_list_workbook(db_session, [])
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Languages"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert rows == []
    assert [c.value for c in ws[1]] == LANGUAGE_LIST_HEADERS


def test_glossary_workbook_empty_db(db_session):
    wb = build_glossary_workbook(db_session)
    wb2 = _read_workbook_from_memory(wb)
    assert wb2.sheetnames == ["Glossary"]
    ws = wb2["Glossary"]
    assert [c.value for c in ws[1]] == GLOSSARY_HEADERS
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert rows == []


def test_glossary_workbook_with_entries(db_session):
    db_session.add_all([
        models.Glossary(word="alpha", description="first letter"),
        models.Glossary(word="beta", description="second letter"),
    ])
    db_session.commit()

    wb = build_glossary_workbook(db_session)
    wb2 = _read_workbook_from_memory(wb)
    ws = wb2["Glossary"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert rows == [("alpha", "first letter"), ("beta", "second letter")]


def test_backup_zip_structure(db_session):
    """Lo zip ha schema, metadati, glossario e un xlsx per lingua."""
    _seed_basic(db_session)
    db_session.add(models.Glossary(word="hub", description="central node"))
    db_session.commit()

    languages = db_session.query(models.Language).all()
    data = build_backup_zip_bytes(db_session, languages)

    with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
        names = set(zf.namelist())
        assert "schema.xlsx" in names
        assert "languages_metadata.xlsx" in names
        assert "glossary.xlsx" in names
        assert "languages/ITA.xlsx" in names

        with zf.open("schema.xlsx") as f:
            schema_wb = load_workbook(io.BytesIO(f.read()), data_only=True)
            assert schema_wb.sheetnames == [
                "Motivations", "Parameters", "Questions", "QuestionAllowedMotivations",
            ]

        # niente fogli di schema nel file per lingua
        with zf.open("languages/ITA.xlsx") as f:
            lang_wb = load_workbook(io.BytesIO(f.read()), data_only=True)
            assert lang_wb.sheetnames == [
                "Database_model", "Answers", "Examples", "Admin Notes",
            ]


def test_backup_zip_progress_callback(db_session):
    """on_language chiamato una volta per lingua."""
    _seed_basic(db_session)
    languages = db_session.query(models.Language).all()

    calls = []
    build_backup_zip_bytes(
        db_session, languages,
        on_language=lambda idx, total, lang: calls.append((idx, total, lang.id)),
    )
    assert calls == [(1, 1, "ITA")]
