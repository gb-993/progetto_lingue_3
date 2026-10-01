"""Export pesanti di Tabella A: passano uno alla volta."""
import inspect

import pytest
from fastapi import HTTPException

import routers.tablea as tablea


@pytest.fixture(autouse=True)
def _short_wait(monkeypatch):
    monkeypatch.setattr(tablea, "HEAVY_EXPORT_WAIT_SECONDS", 0.1)


def test_second_export_gives_up_while_first_is_running():
    first = tablea.heavy_export_slot()
    next(first)
    try:
        with pytest.raises(HTTPException) as exc:
            next(tablea.heavy_export_slot())
        assert exc.value.status_code == 503
    finally:
        first.close()


def test_slot_is_free_again_after_an_export():
    for _ in range(2):
        slot = tablea.heavy_export_slot()
        next(slot)
        slot.close()


def test_slot_is_released_even_if_the_export_fails():
    slot = tablea.heavy_export_slot()
    next(slot)
    with pytest.raises(RuntimeError):
        slot.throw(RuntimeError("export failed"))
    again = tablea.heavy_export_slot()
    next(again)
    again.close()


def test_heavy_endpoints_use_the_slot():
    for endpoint in (
        tablea.export_dendrograms_png,
        tablea.export_cluster_map_html,
        tablea.export_pca_png,
        tablea.export_mantel_zip,
    ):
        dependencies = [p.default.dependency for p in inspect.signature(endpoint).parameters.values()
                        if hasattr(p.default, "dependency")]
        assert tablea.heavy_export_slot in dependencies, endpoint.__name__
