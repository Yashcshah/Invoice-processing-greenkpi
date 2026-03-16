from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.services.supabase_client import get_supabase_admin

router = APIRouter()


class FolderCreate(BaseModel):
    name: str
    organization_id: Optional[str] = None


@router.get("/")
async def list_folders():
    """List all invoice folders"""
    supabase = get_supabase_admin()
    result = supabase.table('invoice_folders').select('*').order('name').execute()
    return {'folders': result.data}


@router.post("/")
async def create_folder(body: FolderCreate):
    """Create a new invoice folder"""
    supabase = get_supabase_admin()
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty")
    result = supabase.table('invoice_folders').insert({
        'name': name,
        'organization_id': body.organization_id,
    }).execute()
    return result.data[0]


@router.delete("/{folder_id}")
async def delete_folder(folder_id: str):
    """Delete a folder (invoices inside become unassigned)"""
    supabase = get_supabase_admin()
    supabase.table('invoice_folders').delete().eq('id', folder_id).execute()
    return {'message': 'Folder deleted'}
