from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.database import create_tables

from .routes.meetings import router as meetings_router
from .routes.websocket import router as websocket_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create database tables
    await create_tables()
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title="AI Notetaker - Meeting Service",
    description="Meeting management, recording, and real-time transcription service",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware — explicit origins required when allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1:3000",
        "http://127.0.0.1",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(meetings_router)
app.include_router(websocket_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "meeting"}
