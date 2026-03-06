from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.database import create_tables

from .routes.auth import router as auth_router
from .routes.calendar import router as calendar_router
from .routes.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create database tables
    await create_tables()
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title="AI Notetaker - Auth Service",
    description="Authentication and calendar integration service",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(auth_router)
app.include_router(calendar_router)
app.include_router(settings_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "auth"}
