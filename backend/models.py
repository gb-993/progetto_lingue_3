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

    # Semplificato: non serve la logica complessa del middleware qui.
    terms_accepted = Column(Boolean, default=False)
    terms_accepted_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    date_joined = Column(DateTime, default=datetime.utcnow)

    # Relazione: lingue assegnate all'utente per l'inserimento dati
    assigned_languages = relationship("Language", back_populates="assigned_user")

# ==========================================
# 2. LINGUE (Languages)
# ==========================================
class Language(Base):
    __tablename__ = "languages"
    id = Column(String(10), primary_key=True)  # Es: 'ita', 'eng'
    name_full = Column(String(255), nullable=False)
    position = Column(Integer, nullable=False) # L'ordine logico (gestito via API)

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

    is_active = Column(Boolean, default=True)
    position = Column(Integer, nullable=False)
    schema = Column(String(100), default="")
    param_type = Column(String(100), default="")
    level_of_comparison = Column(String(255), default="")

    questions = relationship("Question", back_populates="parameter", cascade="all, delete-orphan")

# ==========================================
# TABELLE LOOKUP PARAMETRI
# ==========================================
class ParamSchema(Base):
    __tablename__ = "param_schemas"
    id = Column(Integer, primary_key=True)
    label = Column(String(255), unique=True, nullable=False)

class ParamType(Base):
    __tablename__ = "param_types"
    id = Column(Integer, primary_key=True)
    label = Column(String(255), unique=True, nullable=False)

class ParamLevelOfComparison(Base):
    __tablename__ = "param_level_of_comparisons"
    id = Column(Integer, primary_key=True)
    label = Column(String(255), unique=True, nullable=False)



class Question(Base):
    __tablename__ = "questions"
    id = Column(String(40), primary_key=True) # Es: 'Q_1.1'
    parameter_id = Column(String(10), ForeignKey("parameter_defs.id"), nullable=False)
    text = Column(Text, nullable=False)

    instruction = Column(Text, nullable=True)
    is_stop_question = Column(Boolean, default=False)

    parameter = relationship("ParameterDef", back_populates="questions")
    answers = relationship("Answer", back_populates="question")

# ==========================================
# 4. RISPOSTE, ESEMPI E MOTIVAZIONI
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

    __table_args__ = (UniqueConstraint('language_id', 'question_id', name='uq_answer_lang_q'),)

class Example(Base):
    __tablename__ = "examples"
    id = Column(Integer, primary_key=True)
    answer_id = Column(Integer, ForeignKey("answers.id"), nullable=False)
    textarea = Column(Text, nullable=True)
    gloss = Column(Text, nullable=True)
    translation = Column(Text, nullable=True)

    answer = relationship("Answer", back_populates="examples")

# ==========================================
# 5. VALUTAZIONE DAG (Language Parameter)
# ==========================================
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
# 6. GLOSSARIO
# ==========================================
class Glossary(Base):
    __tablename__ = "glossary"
    id = Column(Integer, primary_key=True, index=True)
    word = Column(String(255), unique=True, nullable=False)
    description = Column(Text, nullable=False)