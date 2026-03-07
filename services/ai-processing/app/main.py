from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.database import create_tables

from .routes.notes import router as notes_router
from .routes.queries import router as queries_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(
    title="AI Notetaker - AI Processing Service",
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

app.include_router(notes_router)
app.include_router(queries_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-processing"}
