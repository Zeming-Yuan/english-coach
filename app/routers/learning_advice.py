"""统计到行动的只读建议接口。"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.runtime import Runtime, get_runtime
from app.services.recommendations import recommendations

router = APIRouter()


@router.get("/learning/recommendations")
def read(
    request: Request,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    if not request.app.state.settings.learning_advice_enabled:
        return {"enabled": False, "suggestions": [], "message": None}
    return recommendations(
        db, runtime, delayed_enabled=request.app.state.settings.delayed_recall_enabled
    )
