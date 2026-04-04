"""LIBERTASIAN Worker Service — FastAPI health endpoint stub for Sprint 0."""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="LIBERTASIAN Worker Service",
    description="Background job processing service",
    version="0.1.0",
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="worker-service",
        version="0.1.0",
    )
