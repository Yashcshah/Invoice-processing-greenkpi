from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import uuid

from app.services.supabase_client import get_supabase_admin

router = APIRouter()


class InvoiceResponse(BaseModel):
    id: str
    original_filename: str
    status: str
    file_type: Optional[str]
    file_size_bytes: Optional[int]
    created_at: datetime
    processed_at: Optional[datetime]


class InvoiceListResponse(BaseModel):
    invoices: List[InvoiceResponse]
    total: int


@router.get("/", response_model=InvoiceListResponse)
async def list_invoices(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List all invoices"""
    supabase = get_supabase_admin()
    
    query = supabase.table('invoices').select('*', count='exact')
    
    if status:
        query = query.eq('status', status)
    
    query = query.order('created_at', desc=True)
    query = query.range(offset, offset + limit - 1)
    
    result = query.execute()
    
    return {
        'invoices': result.data,
        'total': result.count or len(result.data),
    }


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str):
    """Get a single invoice with all related data"""
    supabase = get_supabase_admin()
    
    # Get invoice
    invoice_result = supabase.table('invoices').select('*').eq('id', invoice_id).execute()

    if not invoice_result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Get OCR results
    ocr = supabase.table('ocr_results').select('*').eq('invoice_id', invoice_id).execute()

    # Get extracted fields
    fields = supabase.table('extracted_fields').select('*').eq('invoice_id', invoice_id).execute()

    # Get line items
    line_items = supabase.table('line_items').select('*').eq('invoice_id', invoice_id).execute()

    return {
        'invoice': invoice_result.data[0],
        'ocr_results': ocr.data,
        'extracted_fields': fields.data,
        'line_items': line_items.data,
    }


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str):
    """Delete an invoice"""
    supabase = get_supabase_admin()
    
    # Check if invoice exists
    invoice_result = supabase.table('invoices').select('id, file_path').eq('id', invoice_id).execute()

    if not invoice_result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice = invoice_result.data[0]

    # Delete from storage
    if invoice.get('file_path'):
        try:
            supabase.storage.from_('invoices-raw').remove([invoice['file_path']])
        except:
            pass  # Ignore storage errors
    
    # Delete from database (cascades to related tables)
    supabase.table('invoices').delete().eq('id', invoice_id).execute()
    
    return {'message': 'Invoice deleted successfully'}


@router.patch("/{invoice_id}/status")
async def update_invoice_status(invoice_id: str, status: str):
    """Update invoice status"""
    valid_statuses = [
        'uploaded', 'preprocessing', 'preprocessed', 'ocr_processing',
        'ocr_complete', 'extraction_processing', 'extraction_complete',
        'validated', 'exported', 'failed'
    ]
    
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    supabase = get_supabase_admin()
    
    result = supabase.table('invoices').update({
        'status': status,
        'updated_at': datetime.utcnow().isoformat(),
    }).eq('id', invoice_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    return result.data[0]
