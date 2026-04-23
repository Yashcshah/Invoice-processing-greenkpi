from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str = ""

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    debug: bool = True

    # OCR
    tesseract_path: str = "C:/Program Files/Tesseract-OCR/tesseract.exe"
    ocr_engine: str = "tesseract"
    poppler_path: str = ""  # e.g. C:/Program Files/poppler/Library/bin

    # Models
    ner_model_path: str = "./ml_models/ner_model"

    # ── Green KPI / LLM ───────────────────────────────────────────────
    # Gemini 2.5 Flash — get key at https://aistudio.google.com/apikey
    gemini_api_key: str = ""

    # HuggingFace token — for TrOCR fallback (optional)
    hf_token: str = ""

    # ABN Lookup — Australian Business Register
    # Register free at: https://api.abn.business.gov.au/
    abr_guid: str = ""

    # Green KPI pipeline feature flags
    # Set to False to skip stages (useful during development / limited quota)
    green_kpi_enabled: bool = True
    llm_enabled: bool = True      # requires GEMINI_API_KEY
    gnn_enabled: bool = True      # runs in lite mode without torch-geometric

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings():
    return Settings()
