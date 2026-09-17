from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import applications, auth, credentials, evaluations, jobs, qa_bank, resume, scheduler, settings
from app.services import scheduler as scheduler_service

# Schema is managed by Alembic (see webapp/backend/alembic/) -- run
# `alembic upgrade head` before starting the server for the first time.


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler_service.start_scheduler()  # safe by default: Settings.scheduler_paused starts True
    yield
    scheduler_service.stop_scheduler()


app = FastAPI(title="ai-job-search webapp", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    # Regex fallback so a second device reachable over Tailscale can use this
    # app without editing this file once the exact hostname is known: matches
    # Tailscale's CGNAT IP range (100.64.0.0/10) and MagicDNS
    # `<device>.<tailnet>.ts.net` hostnames, port 3000 (the frontend dev
    # server), over plain http (Tailscale's own encryption covers the wire;
    # this app isn't served over TLS).
    allow_origin_regex=r"^http://(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.ts\.net):3000$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(resume.router)
app.include_router(jobs.router)
app.include_router(evaluations.router)
app.include_router(applications.router)
app.include_router(qa_bank.router)
app.include_router(settings.router)
app.include_router(credentials.router)
app.include_router(scheduler.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
