# 复习提交路由：薄适配，写事务与幂等见 app.services.learning

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.runtime import Runtime, get_runtime
from app.schemas.learning import AttemptCommand
from app.services.learning import CardNotFoundError, SubmissionConflictError
from app.services.review_submission import submit_command

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/reviews")
def post_review(
    req: AttemptCommand,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """提交一次学习：判分、事件、FSRS 与错词同一事务保存。"""
    try:
        result = submit_command(db, req, runtime)
    except CardNotFoundError:
        raise HTTPException(status_code=404, detail="Card not found")
    except SubmissionConflictError:
        raise HTTPException(
            status_code=409,
            detail="该提交标识已用于不同内容，请刷新后重试",
        )
    except Exception:
        # 数据库故障：只返回通用失败，不泄露内部异常，也不假装已完成。
        logger.exception("review submission failed")
        raise HTTPException(status_code=500, detail="保存失败，请重试")
    return result.model_dump()
