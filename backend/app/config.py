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
    
    # Models
    ner_model_path: str = "./ml_models/ner_model"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings():
    return Settings()
