"""Public command for adopting a single expansion shown on a source card."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.learning import ContactRevision


class ExpansionTargetIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    word: str = Field(min_length=1, max_length=80)
    meaning: str = Field(min_length=1, max_length=200)


class ExpansionAdditionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    source_revision: ContactRevision
    target: ExpansionTargetIn
