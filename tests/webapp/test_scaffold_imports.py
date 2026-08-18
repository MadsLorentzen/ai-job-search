import importlib


def test_webapp_package_imports():
    assert importlib.import_module("webapp") is not None


def test_webapp_subpackages_import():
    for name in ("webapp.api", "webapp.services", "webapp.persistence"):
        assert importlib.import_module(name) is not None
