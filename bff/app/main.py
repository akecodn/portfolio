from fastapi import FastAPI

from .db import ensure_books_schema
from .routers import auth, books, positions, users

app = FastAPI()
app.include_router(auth.router, prefix="/api")
app.include_router(positions.router, prefix="/api")
app.include_router(books.router, prefix="/api")
app.include_router(users.router, prefix="/api")


@app.on_event("startup")
def startup():
    ensure_books_schema()


@app.get("/health")
def get_health():
    return {"status": "ok"}
