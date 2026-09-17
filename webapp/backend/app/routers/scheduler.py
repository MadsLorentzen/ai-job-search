from fastapi import APIRouter, Depends

from app import models
from app.services import auth as auth_service
from app.services import scheduler as scheduler_service

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])

# The scheduler is a single shared background process (one cadence for every
# account -- see services/scheduler.py), so these controls aren't scoped to
# current_user's own data; login is required only to keep them behind auth
# like everything else, not to restrict which account can see/trigger them.


@router.get("/status")
def status(current_user: models.User = Depends(auth_service.get_current_user)):
    sched = scheduler_service.get_scheduler()
    if sched is None:
        return {"running": False}
    job = sched.get_job("pipeline_cycle")
    return {
        "running": True,
        "next_run_time": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }


@router.post("/run-now")
def run_now(current_user: models.User = Depends(auth_service.get_current_user)):
    scheduler_service.trigger_now()
    return {"triggered": True}
