"""
Servizio copia dati di una question.

Usato dal "Duplicate WITH data": quando si crea una nuova question
duplicandone una esistente, oltre ai testi vengono clonati anche tutti i
dati linguistici raccolti (Answer/Example/AnswerMotivation) per ogni lingua.

A differenza dell'archive (services/archive_service), qui i dati non vengono
spostati ma *duplicati*: la sorgente resta intatta e la destinazione riceve
una copia indipendente, mantenendo lo stato di approvazione di ciascuna
risposta.
"""
from __future__ import annotations
from typing import Dict

from sqlalchemy.orm import Session

import models


def copy_question_data(db: Session, source_question_id: str, dest_question_id: str) -> Dict[str, int]:
    """Clona Answer + Example + AnswerMotivation da una question all'altra.

    Lo stato (status/response_text/comments) di ogni risposta viene
    preservato così com'è nella sorgente. `updated_at` riparte da adesso
    (default del modello), trattandosi di record nuovi.

    NON committa: chi chiama gestisce la transazione. Ritorna i conteggi
    di risposte ed esempi copiati.
    """
    answers = (
        db.query(models.Answer)
        .filter(models.Answer.question_id == source_question_id)
        .all()
    )
    answers_count = 0
    examples_count = 0
    for a in answers:
        new_a = models.Answer(
            language_id=a.language_id,
            question_id=dest_question_id,
            status=a.status,
            response_text=a.response_text,
            comments=a.comments,
        )
        db.add(new_a)
        db.flush()  # serve l'id per agganciare Example/AnswerMotivation
        answers_count += 1

        for ex in a.examples:
            db.add(models.Example(
                answer_id=new_a.id,
                number=ex.number or "",
                textarea=ex.textarea,
                transliteration=ex.transliteration,
                gloss=ex.gloss,
                translation=ex.translation,
                reference=ex.reference,
            ))
            examples_count += 1

        for am in a.answer_motivations:
            db.add(models.AnswerMotivation(
                answer_id=new_a.id,
                motivation_id=am.motivation_id,
            ))

    return {"answers": answers_count, "examples": examples_count}
