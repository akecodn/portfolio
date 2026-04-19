from fastapi import FastAPI
from .routers import books, positions

app = FastAPI()
app.include_router(positions.router, prefix="/api")
app.include_router(books.router, prefix="/api")

@app.get("/health")
def get_health():
    return {"status": "ok"}
