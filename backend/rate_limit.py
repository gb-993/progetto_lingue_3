"""Limiter condiviso: modulo a parte per evitare import circolari con main.py."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
