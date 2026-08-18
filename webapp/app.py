from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

from webapp.config import Settings
from webapp.persistence.db import init_db


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(settings.db_path)
        yield

    app = FastAPI(title="Job Application Workspace", lifespan=lifespan)
    app.state.settings = settings
    app.state.templates = Jinja2Templates(directory=str(Path(__file__).with_name("templates")))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
