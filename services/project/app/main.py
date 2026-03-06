from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.database import create_tables
from services.project.app.routes.projects import router as projects_router
from services.project.app.routes.team import router as team_router
from services.project.app.routes.people import router as people_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(
    title="AI Notetaker - Project Service",
    description="Project management, team, and people intelligence APIs",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(team_router)
app.include_router(people_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "project"}
