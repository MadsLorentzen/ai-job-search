from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from webapp.api.profile import router as profile_router
from webapp.api.application_documents import router as application_documents_router, reusable_router
from webapp.api.discovery import router as discovery_router
from webapp.api.handoff import router as handoff_router
from webapp.api.review import router as review_router
from webapp.api.search_workspaces import router as search_workspaces_router
from webapp.api.status import router as status_router
from webapp.api.user_profile import router as user_profile_router
from webapp.api.workspaces import router as workspaces_router
from webapp.api.views import router as views_router
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
    app.mount("/static", StaticFiles(directory=str(Path(__file__).with_name("static"))), name="static")
    if settings.handoff_fixtures_dir is not None:
        app.mount(
            "/test-fixtures/handoff",
            StaticFiles(directory=str(settings.handoff_fixtures_dir)),
            name="handoff_fixtures",
        )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(profile_router)
    app.include_router(application_documents_router)
    app.include_router(reusable_router)
    app.include_router(discovery_router)
    app.include_router(handoff_router)
    app.include_router(user_profile_router)
    app.include_router(search_workspaces_router)
    app.include_router(workspaces_router)
    app.include_router(review_router)
    app.include_router(status_router)
    app.include_router(views_router)

    return app
