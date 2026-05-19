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


class PasswordResetToken(Base):
    """Token monouso per il flusso 'password dimenticata'.

    Memorizziamo SOLO l'hash sha256 del token, non il token in chiaro:
    se qualcuno facesse dump del DB non potrebbe riutilizzare i token.
    Il token in chiaro vive solo nel link inviato per email all'utente
    (e nel momento della generazione, in memoria).

    Manteniamo storico: una volta consumato o scaduto, il record resta
    in tabella per audit (quante richieste reset fa un utente, in che
    finestra temporale, ecc.). Un cleanup periodico dei record vecchi
    si puo' aggiungere in futuro come job batch.
    """
    __tablename__ = "password_reset_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # sha256 del token in clear -> stringa hex lunga 64 caratteri.
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    # IP del client che ha richiesto il reset (audit / spot bruteforce).
    request_ip = Column(String(45), nullable=True)

    user = relationship("User")


# ==========================================
# 1.bis DOCUMENTI LEGALI E TRACCIAMENTO ACCETTAZIONI (GDPR + art. 1341 c.c.)
#
# Due tabelle accoppiate:
#
#   - `legal_documents`: archivio immutabile di TUTTE le versioni dei
#     documenti legali (Terms of Use, Privacy Notice). Una sola riga per
#     (type, version). La versione "viva" e' marcata da `is_current=true`;
#     le versioni precedenti restano nella tabella per tracciare le
#     accettazioni storiche degli utenti.
#
#   - `consents`: una riga per ogni evento di accettazione di un documento
#     da parte di un utente. FK a `legal_documents.id` (non a un type/version
#     come stringhe, cosi' non puo' esistere un consenso "fantasma" che
#     punta a un documento non in archivio).
#
# Vedi PRIVACY_TODO_DPO.md (file locale, gitignored) per il razionale
# legale e la conferma DPO sulle clausole vessatorie.
# ==========================================
class LegalDocument(Base):
    """Versione storica di un documento legale (Terms of Use o Privacy Notice).

    Vincolo logico: per ogni `type`, una sola riga puo' avere `is_current=True`.
    Garantito a livello DB da un partial unique index (vedi migrazione).
    Quando si carica una nuova versione, il flag sulla vecchia viene messo
    a False nella stessa transazione (vedi router admin).

    `vexatious_clauses` e' un array JSON di stringhe che elenca le sezioni
    del documento da sottoporre a specifica approvazione ai sensi dell'art.
    1341 c.c. (es. ["7", "8", "9.2", "11"]). La sorgente di verita' viene
    da `config.VEXATIOUS_CLAUSES_DEFAULT`: l'upload admin la copia qui,
    cosi' resta congelata per quella specifica versione anche se in futuro
    il default cambia.
    """
    __tablename__ = "legal_documents"
    id = Column(Integer, primary_key=True)
    # "terms_of_use" | "privacy_notice". Enum stringa coerente con gli altri
    # enum del progetto (vedi User.role, Language.status, ecc.).
    type = Column(
        Enum("terms_of_use", "privacy_notice", name="legal_document_type"),
        nullable=False,
    )
    # Es. "v1.0", "v1.1", "v2.0". Estratta automaticamente dal testo del PDF
    # (header/footer "version X.Y, Month DD YYYY"); l'admin non la digita.
    version = Column(String(20), nullable=False)
    # Path relativo alla cartella servita da Caddy (es.
    # "docs/archive/Terms_of_use_v1.0_2026-05-18.pdf"). I file vivono in
    # frontend/public/docs/archive/ — pubblicamente scaricabili, perche'
    # i documenti legali sono per natura conoscibili da chi li sottoscrive.
    file_path = Column(String(500), nullable=False)
    # sha256 hex del file PDF (64 caratteri). Impronta digitale: protegge da
    # modifiche "silenziose" del PDF senza bump di versione (es. fix refuso
    # senza nuovo numero). In giudizio: prova che il file accettato e'
    # esattamente quello in archivio.
    sha256 = Column(String(64), nullable=False)
    published_at = Column(DateTime, default=utc_now, nullable=False)
    # True solo sull'ultima versione di ciascun `type`. Usato per: a) il
    # check "l'utente deve ancora accettare questa versione?", b) la pagina
    # admin per mostrare la versione corrente.
    is_current = Column(Boolean, default=True, nullable=False)
    # Snapshot delle clausole vessatorie congelato al momento dell'upload.
    # Es. ["7", "8", "9.2", "11"]. Null per documenti che non ne hanno
    # (es. Privacy Notice). Vedi `config.VEXATIOUS_CLAUSES_DEFAULT`.
    vexatious_clauses = Column(JSON, nullable=True)
    # Note libere dell'admin (opzionale). Es. "fix refuso sez. 7".
    note = Column(Text, nullable=True)

    consents = relationship("Consent", back_populates="legal_document")

    __table_args__ = (
        UniqueConstraint("type", "version", name="uq_legal_documents_type_version"),
    )


class Consent(Base):
    """Evento di accettazione di un documento legale da parte di un utente.

    Una riga per (user, legal_document). Se l'utente accetta sia ToU che
    Privacy Notice nello stesso modal, si scrivono DUE righe distinte con
    lo stesso timestamp.

    `vexatious_clauses_approved`: True se l'utente ha spuntato la seconda
    checkbox del modal (art. 1341 c.c.). Per documenti senza clausole
    vessatorie (es. Privacy Notice) il campo resta False e nel modal la
    seconda checkbox non appare proprio.

    `revoked_at`: null finche' il consenso e' attivo. Valorizzato se in
    futuro implementiamo recesso/cancellazione account: lo storico resta,
    ma il flag "currently valid?" e' computato da `revoked_at IS NULL`.
    """
    __tablename__ = "consents"
    id = Column(Integer, primary_key=True)
    # SET NULL on delete: se cancello un utente (GDPR right to be forgotten),
    # la riga in consents resta come prova storica ma perde il link verso
    # l'utente. Se serve audit con identita' anche dopo cancellazione, in
    # futuro si puo' aggiungere user_email_snapshot.
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # RESTRICT on delete: un documento legale NON deve mai essere cancellato
    # se ci sono accettazioni che lo referenziano (perderemmo la prova del
    # contenuto accettato). In pratica i legal_documents non vengono mai
    # cancellati: si sostituisce solo il flag is_current.
    legal_document_id = Column(
        Integer, ForeignKey("legal_documents.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    accepted_at = Column(DateTime, default=utc_now, nullable=False)
    # IP del client al momento dell'accettazione. IPv6 max 45 char (stesso
    # pattern di PasswordResetToken.request_ip). In chiaro: l'utente ha
    # accettato di vedere questo dato (lo dichiariamo nell'informativa).
    ip_address = Column(String(45), nullable=True)
    # User agent del browser. Text (non String) perche' alcuni UA superano
    # facilmente i 255 caratteri (browser mobile, embedded webview, ecc.).
    user_agent = Column(Text, nullable=True)
    # Contesto in cui l'accettazione e' avvenuta. Valori previsti:
    #   - "first_login_modal": utente al primo login, accetta per la prima volta
    #   - "version_update_modal": utente che aveva gia' accettato una versione
    #     precedente, ora accetta una nuova versione
    #   - "admin_bootstrap": riservato a flussi di sistema (oggi inutilizzato)
    method = Column(String(50), nullable=False)
    # True se l'utente ha spuntato la seconda checkbox del modal (approvazione
    # specifica ex art. 1341 c.c.). False per documenti senza clausole vessatorie.
    vexatious_clauses_approved = Column(Boolean, default=False, nullable=False)
    # Null finche' il consenso e' attivo.
    revoked_at = Column(DateTime, nullable=True)
    # Motivo della revoca (opzionale, libero). Es. "account deleted",
    # "user withdrew", "superseded by newer version".
    revocation_reason = Column(String(100), nullable=True)

    user = relationship("User")
    legal_document = relationship("LegalDocument", back_populates="consents")


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
    # passive_deletes=True: alla cancellazione della Language l'ORM NON emette
    # UPDATE nullify ne' DELETE individuali sulle answers/aliases — si fida
    # del cascade DB (ON DELETE CASCADE definito sulle FK figlie). Senza
    # questo, SQLAlchemy proverebbe a settare answers.language_id=NULL prima
    # del delete, violando la constraint NOT NULL.
    answers = relationship(
        "Answer", back_populates="language",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    aliases = relationship(
        "LanguageAlias", back_populates="language",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class LanguageAlias(Base):
    """Storico degli id passati di una Language.

    Ogni volta che `Language.id` viene rinominato (via PUT admin), il vecchio
    id viene salvato qui. Il restore di backup e l'import Excel usano questa
    tabella come fallback quando non trovano la lingua per id corrente:
    cercano per `old_id` e, se trovato, lavorano sulla lingua puntata.

    `old_id` è UNIQUE: non puo' esistere lo stesso alias su due lingue diverse
    (l'incoerenza renderebbe ambigui restore e import). Il vincolo viene
    presidiato anche a livello applicativo nel PUT.
    """
    __tablename__ = "language_aliases"
    id = Column(Integer, primary_key=True)
    language_id = Column(
        String(10),
        ForeignKey("languages.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    old_id = Column(String(10), nullable=False, unique=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    language = relationship("Language", back_populates="aliases")


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
    language_id = Column(String(10), ForeignKey("languages.id", onupdate="CASCADE", ondelete="CASCADE"), nullable=False)
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
    language_id = Column(String(10), ForeignKey("languages.id", onupdate="CASCADE", ondelete="CASCADE"), nullable=False)
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
    answer_id = Column(Integer, ForeignKey("answers.id", ondelete="CASCADE"), nullable=False)
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
    language_id = Column(String(10), ForeignKey("languages.id", onupdate="CASCADE", ondelete="CASCADE"))
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"))
    value_orig = Column(Enum("+", "-", "0", "?", name="param_values_orig"), nullable=True)
    warning_orig = Column(Boolean, default=False)
    eval = relationship("LanguageParameterEval", back_populates="language_parameter", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('language_id', 'parameter_id', name='uq_language_parameter_lang_param'),)

class LanguageParameterEval(Base):
    __tablename__ = "language_parameter_evals"
    id = Column(Integer, primary_key=True)
    language_parameter_id = Column(Integer, ForeignKey("language_parameters.id", ondelete="CASCADE"), unique=True)
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
    language_id = Column(String(10), ForeignKey("languages.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
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