from supabase import create_client, Client
from app.config import get_settings

settings = get_settings()

def get_supabase_client() -> Client:
    """Get Supabase client with anon key (for user context)"""
    return create_client(settings.supabase_url, settings.supabase_anon_key)

def get_supabase_admin() -> Client:
    """Get Supabase client with service role key (admin access)"""
    return create_client(settings.supabase_url, settings.supabase_service_key)
