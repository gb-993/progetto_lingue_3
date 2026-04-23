from sqlalchemy import Column, String, Integer, Boolean, Float, ForeignKey, DateTime, Text, Numeric, Enum, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, Float, ForeignKey, DateTime, Text, Numeric, Enum, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime

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
    date_joined = Column(DateTime, default=datetime.utcnow)

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
    latitude = Column(Numeric(precision=10, scale=6), nullable=True)
    longitude = Column(Numeric(precision=11, scale=6), nullable=True)
    historical_language = Column(Boolean, default=False)

    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    assigned_user = relationship("User", back_populates="assigned_languages")
    answers = relationship("Answer", back_populates="language")

# ==========================================
# 3. PARAMETRI E DOMANDE
# ==========================================
class ParameterDef(Base):
    __tablename__ = "parameter_defs"
    id = Column(String(10), primary_key=True)
    name = Column(String(200), nullable=False)
    short_description = Column(Text, default="")
    implicational_condition = Column(String(255), nullable=True)
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
    """Traccia lo stato di completamento/revisione di un parametro per una lingua"""
    __tablename__ = "language_parameter_statuses"
    id = Column(Integer, primary_key=True)
    language_id = Column(String(10), ForeignKey("languages.id"), nullable=False)
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False)
    is_unsure = Column(Boolean, default=False)

    __table_args__ = (UniqueConstraint('language_id', 'parameter_id', name='uq_lang_param_status'),)

class Question(Base):
    __tablename__ = "questions"
    id = Column(String(40), primary_key=True)
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False)
    text = Column(Text, nullable=False)

    instruction = Column(Text, nullable=True)
    instruction_yes = Column(Text, nullable=True)
    instruction_no = Column(Text, nullable=True)
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
    language_id = Column(String(10), ForeignKey("languages.id"), nullable=False)
    question_id = Column(String(40), ForeignKey("questions.id"), nullable=False)

    status = Column(Enum("pending", "waiting_for_approval", "approved", "rejected", name="answer_status"), default="pending")
    response_text = Column(Enum("yes", "no", name="response_types"), nullable=True)
    comments = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    language = relationship("Language", back_populates="answers")
    question = relationship("Question", back_populates="answers")
    examples = relationship("Example", back_populates="answer", cascade="all, delete-orphan")
    answer_motivations = relationship("AnswerMotivation", back_populates="answer", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('language_id', 'question_id', name='uq_answer_lang_q'),)

class Example(Base):
    __tablename__ = "examples"
    id = Column(Integer, primary_key=True)
    answer_id = Column(Integer, ForeignKey("answers.id"), nullable=False)
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
    is_active = Column(Boolean, default=True)

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
    created_at = Column(DateTime, default=datetime.utcnow)
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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
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
    submitted_at = Column(DateTime, default=datetime.utcnow, index=True)
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
    evaluated_at = Column(DateTime, default=datetime.utcnow)

    submission = relationship("Submission", back_populates="params")