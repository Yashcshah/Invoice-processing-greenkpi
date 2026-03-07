# Python 3.13 compatibility: packaging.version.Version has no .split() method,
# but pytesseract calls it internally when comparing versions.
# This patch adds .split() before any other imports run.
try:
    from packaging.version import Version as _PkgVersion
    if not hasattr(_PkgVersion, 'split'):
        _PkgVersion.split = lambda self, sep=None, maxsplit=-1: (
            str(self).split(sep, maxsplit) if maxsplit >= 0 else str(self).split(sep)
        )
except (ImportError, Exception):
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import invoices, processing, extraction
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Invoice Processing API",
    description="AI-powered invoice data extraction",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(invoices.router, prefix="/api/invoices", tags=["invoices"])
app.include_router(processing.router, prefix="/api/processing", tags=["processing"])
app.include_router(extraction.router, prefix="/api/extraction", tags=["extraction"])

@app.get("/")
async def root():
    return {"message": "Invoice Processing API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.debug
    )
