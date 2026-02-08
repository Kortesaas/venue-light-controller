from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pathlib import Path

from src.lighting.api import router as lighting_router

app = FastAPI()

# CORS for local frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API mounten
app.include_router(lighting_router, prefix="/api", tags=["lighting"])

# Frontend-Build mounten (falls vorhanden)
FRONTEND_DIST = Path(__file__).parent / "frontend_dist"

if FRONTEND_DIST.exists():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend"
    )
else:
    @app.get("/", response_class=HTMLResponse)
    def placeholder_root():
        return """
        <html>
        <body style="font-family: sans-serif;">
            <h1>Venue Light Controller Backend</h1>
            <p>Frontend-Build (frontend/dist) wurde noch nicht nach <code>backend/frontend_dist</code> kopiert.</p>
            <p>API: <a href="/docs">/docs</a></p>
        </body>
        </html>
        """


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
