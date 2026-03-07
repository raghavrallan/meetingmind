from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.database import create_tables
from services.task.app.routes.tasks import router as tasks_router
from services.task.app.routes.lifecycle import router as lifecycle_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(
    title="AI Notetaker - Task Service",
    description="Task management, Kanban board, and lifecycle APIs",
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

app.include_router(tasks_router)
app.include_router(lifecycle_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "task"}
