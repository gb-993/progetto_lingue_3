"""
Rate-limiter condiviso (slowapi).

Definito in un modulo separato per spezzare la circolarita': main.py
importa i router e i router (es. auth.py) hanno bisogno del limiter
per decorare le route -> non possono importare main.py.

`get_remote_address` legge request.client.host. Funziona dietro Caddy
perche' uvicorn in prod gira con --proxy-headers --forwarded-allow-ips=*
(vedi docker-compose.prod.yml), che riscrive request.client a partire
da X-Forwarded-For.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
