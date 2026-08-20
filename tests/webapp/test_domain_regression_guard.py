"""Structural guards preserving the product/webapp boundary."""
import ast
from pathlib import Path


WEBAPP_ROOT = Path(__file__).parents[2] / "webapp"


def test_production_webapp_never_imports_test_fixtures():
    for path in WEBAPP_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                assert not node.module.startswith("tests"), f"{path} imports {node.module}"
            if isinstance(node, ast.Import):
                assert all(not alias.name.startswith("tests") for alias in node.names)


def test_production_webapp_does_not_monkeypatch_product_modules():
    for path in WEBAPP_ROOT.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "setattr(product" not in source, f"{path} monkeypatches product code"


def test_http_contract_has_no_apply_submit_or_send_endpoint():
    api_source = "\n".join(
        path.read_text(encoding="utf-8") for path in (WEBAPP_ROOT / "api").glob("*.py")
    )
    for route in ('"/apply"', '"/submit"', '"/send"', '"/email"'):
        assert route not in api_source
