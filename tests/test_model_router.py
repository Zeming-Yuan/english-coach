"""模型路由测试：规则变化时改 ROUTES，测试就是验收标准。"""

from app.services.model_router import FLASH_MODEL, PRO_MODEL, ROUTES, Task, route


def test_bulk_routes_to_flash():
    assert route(Task.BULK) == FLASH_MODEL


def test_reasoning_routes_to_pro():
    assert route(Task.REASONING) == PRO_MODEL


def test_every_task_has_a_route():
    assert set(ROUTES) == set(Task)


def test_model_override_applies_to_every_task():
    assert route(Task.BULK, model_override="deepseek-flash") == "deepseek-flash"
    assert route(Task.REASONING, model_override="deepseek-flash") == "deepseek-flash"


def test_blank_override_keeps_task_routes():
    assert route(Task.BULK, model_override="  ") == FLASH_MODEL
    assert route(Task.REASONING, model_override="") == PRO_MODEL
