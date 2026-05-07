from sqlalchemy import Column, String, Integer, Boolean, Float, ForeignKey, DateTime, Text, Numeric, Enum, UniqueConstraint, Index, JSON
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime  # noqa: F401  (mantenuto per eventuali type hints)
from time_utils import utc_now

class Base(DeclarativeBase):
    pass

# ==========================================
# 1. UTENTI E AUTENTICAZIONE
# ==========================================
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String)
    surname = Column(String)
    role = Column(Enum("admin", "user", "public", name="user_roles"), default="public")

    terms_accepted = Column(Boolean, default=False)
    terms_accepted_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    date_joined = Column(DateTime, default=utc_now)

    assigned_languages = relationship("Language", back_populates="assigned_user")

# ==========================================
# 2. LINGUE (Languages)
# ==========================================
class Language(Base):
    __tablename__ = "languages"
    id = Column(String(10), primary_key=True)
    name_full = Column(String(255), nullable=False)
    position = Column(Integer, nullable=False)

    family = Column(String(255), default="")
    top_level_family = Column(String(255), default="")
    grp = Column(String(255), default="")
    # FK alla tassonomia (parallele alle stringhe sopra, mantenute sincronizzate al save)
    top_family_id = Column(Integer, ForeignKey("top_families.id", ondelete="SET NULL"), nullable=True)
    family_id = Column(Integer, ForeignKey("families.id", ondelete="SET NULL"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    latitude = Column(Numeric(precision=10, scale=6), nullable=True)
    longitude = Column(Numeric(precision=11, scale=6), nullable=True)
    historical_language = Column(Boolean, default=False)

    # Campi metadata aggiuntivi (allineamento con vecchio progetto)
    isocode = Column(String(20), default="")
    glottocode = Column(String(20), default="")
    informant = Column(String(255), default="")
    supervisor = Column(String(255), default="")
    source = Column(Text, default="")
    location = Column(String(255), default="")

    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Workflow di compilazione (a livello di lingua intera)
    status = Column(
        Enum("pending", "waiting_for_approval", "approved", "rejected", name="language_status"),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    rejection_note = Column(Text, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    # Bumpato automaticamente da SQLAlchemy ad ogni UPDATE della riga Language
    # (vedi `onupdate`). Cattura solo modifiche ai metadati della lingua: per
    # cambi alle answers/examples occorrerebbe estendere il bump da quei
    # service. La colonna è popolata dalla migrazione su righe pre-esistenti.
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=True)

    assigned_user = relationship("User", back_populates="assigned_languages")
    answers = relationship("Answer", back_populates="language")


# ==========================================
# 2.bis TASSONOMIA: top-family > family > group
# I campi stringa su Language (top_level_family, family, grp) restano come
# fonte di verità per filtri/export; queste tabelle sono il dizionario
# gerarchico modificabile dall'admin via /admin/taxonomy.
# ==========================================
class TopFamily(Base):
    __tablename__ = "top_families"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    position = Column(Integer, nullable=False, default=0)

    families = relationship("Family", back_populates="top_family")


class Family(Base):
    __tablename__ = "families"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    top_family_id = Column(Integer, ForeignKey("top_families.id", ondelete="SET NULL"), nullable=True)
    position = Column(Integer, nullable=False, default=0)

    top_family = relationship("TopFamily", back_populates="families")
    groups = relationship("Group", back_populates="family")


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    family_id = Column(Integer, ForeignKey("families.id", ondelete="SET NULL"), nullable=True)
    position = Column(Integer, nullable=False, default=0)

    family = relationship("Family", back_populates="groups")


# ==========================================
# 3. PARAMETRI E DOMANDE
# ==========================================
class ParameterDef(Base):
    __tablename__ = "parameter_defs"
    id = Column(String(10), primary_key=True)
    name = Column(String(200), nullable=False)
    short_description = Column(Text, default="")
    long_description = Column(Text, default="")
    implicational_condition = Column(String(255), nullable=True)
    description_of_the_implicational_condition = Column(Text, default="")
    is_active = Column(Boolean, default=True, nullable=False)
    position = Column(Integer, nullable=False)
    schema = Column(String(100), default="")
    param_type = Column(String(100), default="")
    level_of_comparison = Column(String(255), default="")

    questions = relationship("Question", back_populates="parameter", cascade="all, delete-orphan")
    change_logs = relationship("ParameterChangeLog", back_populates="parameter", cascade="all, delete-orphan")

class ParamSchema(Base):
    __tablename__ = "param_schemas"
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(100), unique=True, nullable=False)

class ParamType(Base):
    __tablename__ = "param_types"
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(100), unique=True, nullable=False)

class ParamLevelOfComparison(Base):
    __tablename__ = "param_levels_of_comparison"
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(100), unique=True, nullable=False)


class LanguageParameterStatus(Base):
    """Traccia lo stato di completamento/revisione di un parametro per una lingua.

    Contiene anche la `admin_note`: un testo libero per (lingua, parametro)
    visibile e modificabile solo dagli admin.
    """
    __tablename__ = "language_parameter_statuses"
    id = Column(Integer, primary_key=True)
    # `language_id` è leftmost della UniqueConstraint sotto: già indicizzato.
    # `parameter_id` invece serve un indice esplicito per query "tutti i record
    # di questo parametro" (es. consolidate, dashboard cross-language).
    language_id = Column(String(10), ForeignKey("languages.id"), nullable=False)
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False, index=True)
    is_unsure = Column(Boolean, default=False)
    admin_note = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint('language_id', 'parameter_id', name='uq_lang_param_status'),)

class Question(Base):
    __tablename__ = "questions"
    id = Column(String(40), primary_key=True)
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False)
    text = Column(Text, nullable=False)
    template_type = Column(String(100), default="")
    instruction = Column(Text, nullable=True)
    instruction_yes = Column(Text, nullable=True)
    instruction_no = Column(Text, nullable=True)
    example_yes = Column(Text, nullable=True)
    help_info = Column(Text, nullable=True)
    is_stop_question = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    parameter = relationship("ParameterDef", back_populates="questions")
    answers = relationship("Answer", back_populates="question")
    allowed_motivations = relationship("QuestionAllowedMotivation", back_populates="question", cascade="all, delete-orphan")

# ==========================================
# 4. RISPOSTE ED ESEMPI
# ==========================================
class Answer(Base):
    __tablename__ = "answers"
    id = Column(Integer, primary_key=True)
    # `language_id` leftmost della UniqueConstraint -> già indicizzato.
    # `question_id` ha bisogno di un indice esplicito per query "tutte le
    # risposte a questa domanda" (export, history, consolidate cross-language).
    language_id = Column(String(10), ForeignKey("languages.id"), nullable=False)
    question_id = Column(String(40), ForeignKey("questions.id"), nullable=False, index=True)

    status = Column(Enum("pending", "waiting_for_approval", "approved", "rejected", name="answer_status"), default="pending")
    response_text = Column(Enum("yes", "no", "unsure", name="response_types"), nullable=True)
    comments = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    language = relationship("Language", back_populates="answers")
    question = relationship("Question", back_populates="answers")
    examples = relationship("Example", back_populates="answer", cascade="all, delete-orphan")
    answer_motivations = relationship("AnswerMotivation", back_populates="answer", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('language_id', 'question_id', name='uq_answer_lang_q'),)

class Example(Base):
    __tablename__ = "examples"
    id = Column(Integer, primary_key=True)
    answer_id = Column(Integer, ForeignKey("answers.id"), nullable=False)
    number = Column(String(10), default="")
    textarea = Column(Text, nullable=True)
    transliteration = Column(Text, nullable=True)
    gloss = Column(Text, nullable=True)
    translation = Column(Text, nullable=True)
    reference = Column(Text, nullable=True)

    answer = relationship("Answer", back_populates="examples")

class Motivation(Base):
    __tablename__ = "motivations"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), nullable=False)
    label = Column(Text, nullable=False)

class QuestionAllowedMotivation(Base):
    __tablename__ = "question_allowed_motivations"
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(String(40), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    motivation_id = Column(Integer, ForeignKey("motivations.id", ondelete="CASCADE"), nullable=False)
    question = relationship("Question", back_populates="allowed_motivations")
    motivation = relationship("Motivation")

class AnswerMotivation(Base):
    __tablename__ = "answer_motivations"
    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(Integer, ForeignKey("answers.id", ondelete="CASCADE"), nullable=False)
    motivation_id = Column(Integer, ForeignKey("motivations.id", ondelete="CASCADE"), nullable=False)
    answer = relationship("Answer", back_populates="answer_motivations")
    motivation = relationship("Motivation")

# ==========================================
# RESTO DEL FILE (Glossario, Log, DAG)
# ==========================================
class Glossary(Base):
    __tablename__ = "glossary"
    id = Column(Integer, primary_key=True, index=True)
    word = Column(String(255), unique=True, nullable=False)
    description = Column(Text, nullable=False)

class ParameterChangeLog(Base):
    __tablename__ = "parameter_change_logs"
    id = Column(Integer, primary_key=True)
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    change_note = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    parameter = relationship("ParameterDef", back_populates="change_logs")
    user = relationship("User")

class LanguageParameter(Base):
    __tablename__ = "language_parameters"
    id = Column(Integer, primary_key=True)
    language_id = Column(String(10), ForeignKey("languages.id"))
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"))
    value_orig = Column(Enum("+", "-", "0", "?", name="param_values_orig"), nullable=True)
    warning_orig = Column(Boolean, default=False)
    eval = relationship("LanguageParameterEval", back_populates="language_parameter", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('language_id', 'parameter_id', name='uq_language_parameter_lang_param'),)

class LanguageParameterEval(Base):
    __tablename__ = "language_parameter_evals"
    id = Column(Integer, primary_key=True)
    language_parameter_id = Column(Integer, ForeignKey("language_parameters.id"), unique=True)
    value_eval = Column(Enum("+", "-", "0", "?", name="param_values_eval"), nullable=True)
    warning_eval = Column(Boolean, default=False)
    language_parameter = relationship("LanguageParameter", back_populates="eval")


# ==========================================
# 5. CONTENUTI DINAMICI DEL SITO
# ==========================================
class SiteContent(Base):
    __tablename__ = "site_contents"
    key = Column(String(50), primary_key=True)  # Es: "instr_body"
    content = Column(Text, nullable=False)      # Il codice HTML generato dall'editor
    page = Column(String(100))                 # Riferimento alla pagina (es: "Instructions")
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    updated_by = relationship("User")


# ==========================================
# 6. BACKUP E SNAPSHOT (Submissions)
# ==========================================
class Submission(Base):
    __tablename__ = "submissions"
    id = Column(Integer, primary_key=True, index=True)
    language_id = Column(String(10), ForeignKey("languages.id", ondelete="CASCADE"), nullable=False)
    submitted_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at = Column(DateTime, default=utc_now, index=True)
    note = Column(Text, default="")

    # Relazioni
    language = relationship("Language")
    submitted_by = relationship("User")
    answers = relationship("SubmissionAnswer", back_populates="submission", cascade="all, delete-orphan")
    params = relationship("SubmissionParam", back_populates="submission", cascade="all, delete-orphan")
    examples = relationship("SubmissionExample", back_populates="submission", cascade="all, delete-orphan")
    answer_motivations = relationship("SubmissionAnswerMotivation", back_populates="submission", cascade="all, delete-orphan")

class SubmissionAnswer(Base):
    __tablename__ = "submission_answers"
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)

    # Salviamo solo il codice, senza FK rigida verso 'questions' per preservare lo storico
    question_code = Column(String(40), nullable=False)
    response_text = Column(String(50), nullable=True) # "yes", "no", ecc.
    comments = Column(Text, nullable=True)

    submission = relationship("Submission", back_populates="answers")

class SubmissionExample(Base):
    __tablename__ = "submission_examples"
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)

    question_code = Column(String(40), nullable=False)
    textarea = Column(Text, nullable=True)
    transliteration = Column(Text, nullable=True)
    gloss = Column(Text, nullable=True)
    translation = Column(Text, nullable=True)
    reference = Column(Text, nullable=True)

    submission = relationship("Submission", back_populates="examples")

class SubmissionAnswerMotivation(Base):
    __tablename__ = "submission_answer_motivations"
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)

    question_code = Column(String(40), nullable=False)
    motivation_code = Column(String(50), nullable=False)
    # Snapshot del testo della motivazione al momento del backup: il code da
    # solo non basta perché la motivazione potrebbe essere modificata o
    # eliminata dopo il backup, perdendo il significato dello storico.
    motivation_label = Column(Text, nullable=True)

    submission = relationship("Submission", back_populates="answer_motivations")

class SubmissionParam(Base):
    __tablename__ = "submission_params"
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)

    parameter_id = Column(String(10), nullable=False)
    value_orig = Column(String(10), nullable=True)
    warning_orig = Column(Boolean, default=False)
    value_eval = Column(String(10), nullable=True)
    warning_eval = Column(Boolean, default=False)
    evaluated_at = Column(DateTime, default=utc_now)

    submission = relationship("Submission", back_populates="params")


# ==========================================
# 6.bis BACKUP DEI PARAMETRI (snapshot della definizione)
# Tabelle separate dalle Submissions: qui si congela la *definizione* del
# parametro (ParameterDef + Questions + motivations ammesse), non i dati
# linguistici (quelli sono nel backup lingue).
# ==========================================
class ParameterSubmission(Base):
    __tablename__ = "parameter_submissions"
    id = Column(Integer, primary_key=True, index=True)
    # Salvato come stringa: lo snapshot resta valido anche se il parametro
    # viene poi cancellato/rinominato.
    parameter_id = Column(String(10), nullable=False, index=True)
    parameter_name = Column(String(200), nullable=False, default="")
    submitted_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at = Column(DateTime, default=utc_now, index=True)
    note = Column(Text, default="")

    # Snapshot dei campi del ParameterDef
    short_description = Column(Text, default="")
    long_description = Column(Text, default="")
    implicational_condition = Column(String(255), nullable=True)
    description_of_the_implicational_condition = Column(Text, default="")
    is_active = Column(Boolean, default=True)
    position = Column(Integer, nullable=True)
    schema = Column(String(100), default="")
    param_type = Column(String(100), default="")
    level_of_comparison = Column(String(255), default="")

    submitted_by = relationship("User")
    questions = relationship(
        "ParameterSubmissionQuestion",
        back_populates="submission",
        cascade="all, delete-orphan",
    )


class ParameterSubmissionQuestion(Base):
    __tablename__ = "parameter_submission_questions"
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(
        Integer,
        ForeignKey("parameter_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Codice della question (string), niente FK rigida verso `questions`
    question_code = Column(String(40), nullable=False)
    text = Column(Text, nullable=False, default="")
    template_type = Column(String(100), default="")
    instruction = Column(Text, nullable=True)
    instruction_yes = Column(Text, nullable=True)
    instruction_no = Column(Text, nullable=True)
    example_yes = Column(Text, nullable=True)
    help_info = Column(Text, nullable=True)
    is_stop_question = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    submission = relationship("ParameterSubmission", back_populates="questions")
    allowed_motivations = relationship(
        "ParameterSubmissionAllowedMotivation",
        back_populates="question",
        cascade="all, delete-orphan",
    )


class ParameterSubmissionAllowedMotivation(Base):
    __tablename__ = "parameter_submission_allowed_motivations"
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(
        Integer,
        ForeignKey("parameter_submission_questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    motivation_code = Column(String(50), nullable=False)
    motivation_label = Column(Text, nullable=False, default="")

    question = relationship(
        "ParameterSubmissionQuestion", back_populates="allowed_motivations"
    )


# ==========================================
# 7. CRONOLOGIA VERSIONI (per rollback / audit granulare)
# ==========================================
class EntityVersion(Base):
    """
    Snapshot di un'entità a un certo istante. Usato come "salvataggio prima/dopo
    modifica" per Parameters/Questions/Motivations/Languages.

    Ogni record contiene:
      - lo snapshot completo dell'entità DOPO la modifica (campo `snapshot`),
      - l'operazione (`create`/`update`/`delete`),
      - la sorgente (`manual` UI / `excel_import` / `system`),
      - chi e quando.

    Per ottenere il "prima" si guarda alla versione precedente con stesso
    (entity_type, entity_id) ordinata per created_at.
    """
    __tablename__ = "entity_versions"
    id = Column(Integer, primary_key=True)
    entity_type = Column(String(40), nullable=False, index=True)
    entity_id = Column(String(50), nullable=False, index=True)
    snapshot = Column(JSON, nullable=False)
    operation = Column(String(20), default="update", nullable=False)
    source = Column(String(40), default="manual", nullable=False)
    note = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)

    user = relationship("User")

    __table_args__ = (
        Index("ix_entity_versions_lookup", "entity_type", "entity_id", "created_at"),
    )


# ==========================================
# 8. ARCHIVIO DOMANDE OBSOLETE
# Quando una Question viene modificata in modo non compatibile con i dati
# raccolti, le Answer/Example/AnswerMotivation collegate vengono spostate
# qui (insieme a uno snapshot della question stessa al momento del wipe).
# Le motivations e le lingue sono denormalizzate (code/label/name salvati
# come stringhe), così l'archivio resta consistente anche se in seguito
# vengono rinominate o eliminate. Stesso pattern di ParameterSubmission.
# ==========================================
class ArchivedQuestion(Base):
    __tablename__ = "archived_questions"
    id = Column(Integer, primary_key=True)
    original_question_id = Column(String(40), nullable=False, index=True)
    parameter_id = Column(String(10), nullable=False)
    parameter_name = Column(String(200), nullable=False, default="")
    text = Column(Text, nullable=False, default="")
    template_type = Column(String(100), default="")
    instruction = Column(Text, nullable=True)
    instruction_yes = Column(Text, nullable=True)
    instruction_no = Column(Text, nullable=True)
    example_yes = Column(Text, nullable=True)
    help_info = Column(Text, nullable=True)
    is_stop_question = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    archived_at = Column(DateTime, default=utc_now, nullable=False, index=True)
    archived_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    archive_note = Column(Text, default="")
    answers_count = Column(Integer, nullable=False, default=0)
    examples_count = Column(Integer, nullable=False, default=0)

    archived_by = relationship("User")
    allowed_motivations = relationship(
        "ArchivedQuestionMotivation",
        back_populates="archived_question",
        cascade="all, delete-orphan",
    )
    answers = relationship(
        "ArchivedAnswer",
        back_populates="archived_question",
        cascade="all, delete-orphan",
    )


class ArchivedQuestionMotivation(Base):
    __tablename__ = "archived_question_motivations"
    id = Column(Integer, primary_key=True)
    archived_question_id = Column(
        Integer,
        ForeignKey("archived_questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    motivation_code = Column(String(50), nullable=False)
    motivation_label = Column(Text, nullable=False, default="")

    archived_question = relationship("ArchivedQuestion", back_populates="allowed_motivations")


class ArchivedAnswer(Base):
    __tablename__ = "archived_answers"
    id = Column(Integer, primary_key=True)
    archived_question_id = Column(
        Integer,
        ForeignKey("archived_questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    language_id = Column(String(10), nullable=False)
    language_name_full = Column(String(255), nullable=False, default="")
    status = Column(String(40), nullable=True)
    response_text = Column(String(10), nullable=True)
    comments = Column(Text, nullable=True)
    original_updated_at = Column(DateTime, nullable=True)

    archived_question = relationship("ArchivedQuestion", back_populates="answers")
    examples = relationship(
        "ArchivedExample",
        back_populates="archived_answer",
        cascade="all, delete-orphan",
    )
    answer_motivations = relationship(
        "ArchivedAnswerMotivation",
        back_populates="archived_answer",
        cascade="all, delete-orphan",
    )


class ArchivedExample(Base):
    __tablename__ = "archived_examples"
    id = Column(Integer, primary_key=True)
    archived_answer_id = Column(
        Integer,
        ForeignKey("archived_answers.id", ondelete="CASCADE"),
        nullable=False,
    )
    number = Column(String(10), default="")
    textarea = Column(Text, nullable=True)
    transliteration = Column(Text, nullable=True)
    gloss = Column(Text, nullable=True)
    translation = Column(Text, nullable=True)
    reference = Column(Text, nullable=True)

    archived_answer = relationship("ArchivedAnswer", back_populates="examples")


class ArchivedAnswerMotivation(Base):
    __tablename__ = "archived_answer_motivations"
    id = Column(Integer, primary_key=True)
    archived_answer_id = Column(
        Integer,
        ForeignKey("archived_answers.id", ondelete="CASCADE"),
        nullable=False,
    )
    motivation_code = Column(String(50), nullable=False)
    motivation_label = Column(Text, nullable=False, default="")

    archived_answer = relationship("ArchivedAnswer", back_populates="answer_motivations")