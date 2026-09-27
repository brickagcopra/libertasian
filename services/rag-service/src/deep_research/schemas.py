"""Request schema for POST /research/deep and the verified-answer data model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..core.schemas import Passage


class DeepResearchRequest(BaseModel):
    """Body of POST /research/deep (sent by the NestJS gateway only)."""

    model_config = ConfigDict(strict=True)

    question: str = Field(min_length=1, max_length=2000)
    run_id: str | None = Field(
        default=None,
        max_length=64,
        description="The gateway's DeepResearchRun id, echoed on the done event.",
    )
    model_override: str | None = Field(
        default=None,
        max_length=100,
        description="Writer model for this run; honoured only if allowlisted.",
    )
    # Every call on this surface is charged to one budget category. A Literal,
    # not an Enum: strict mode rejects a JSON string for an Enum field.
    scope: Literal["ai_research"] = "ai_research"


@dataclass
class LabelledPassage:
    """A passage shown to the writer as ``[S{n}]``, with backend-owned metadata."""

    label: str
    passage: Passage
    gr_no: str | None = None
    section_label: str | None = None


@dataclass
class Citation:
    source_id: str
    quote: str


@dataclass
class Claim:
    text: str
    citations: list[Citation] = field(default_factory=list)


@dataclass
class Section:
    heading: str
    claims: list[Claim] = field(default_factory=list)


@dataclass
class Draft:
    """The writer's answer, parsed but not yet verified."""

    summary: str
    sections: list[Section] = field(default_factory=list)

    def claim_count(self) -> int:
        return sum(len(s.claims) for s in self.sections)


@dataclass
class LlmUsage:
    """Token and cost totals across every LLM call in one run."""

    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
