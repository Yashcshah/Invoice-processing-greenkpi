from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

from app.services.supabase_client import get_supabase_admin
from app.services.extraction_service import get_extraction_service
from app.services.green_kpi_service import get_green_kpi_service

router = APIRouter()


class FieldUpdate(BaseModel):
    field_name: str
    validated_value: str


class ValidateFieldsRequest(BaseModel):
    invoice_id: str
    fields: List[FieldUpdate]


@router.get("/fields/{invoice_id}")
async def get_extracted_fields(invoice_id: str):
    """Get all extracted fields for an invoice"""
    supabase = get_supabase_admin()
    
    fields = supabase.table('extracted_fields').select('*').eq('invoice_id', invoice_id).execute()
    line_items = supabase.table('line_items').select('*').eq('invoice_id', invoice_id).order('line_number').execute()
    
    return {
        'fields': fields.data,
        'line_items': line_items.data,
    }


@router.post("/validate")
async def validate_fields(request: ValidateFieldsRequest):
    """Validate and correct extracted fields"""
    supabase = get_supabase_admin()
    
    updated_fields = []
    
    for field in request.fields:
        # Fetch current value before overwriting (needed for corrections)
        existing = supabase.table('extracted_fields').select(
            'normalized_value, raw_value'
        ).eq('invoice_id', request.invoice_id).eq('field_name', field.field_name).execute()

        result = supabase.table('extracted_fields').update({
            'validated_value': field.validated_value,
            'is_validated': True,
            'validated_at': datetime.utcnow().isoformat(),
        }).eq('invoice_id', request.invoice_id).eq('field_name', field.field_name).execute()

        if result.data:
            updated_fields.append(result.data[0])

        # Write correction to green_kpi.corrections if value was changed
        if existing.data:
            original = (
                existing.data[0].get('normalized_value')
                or existing.data[0].get('raw_value')
                or ''
            )
            if original.strip().lower() != field.validated_value.strip().lower():
                try:
                    gkpi_svc = get_green_kpi_service()
                    # Look up the green_kpi invoice id
                    gkpi_inv = supabase.schema('green_kpi').table('invoices').select('id').eq(
                        'source_invoice_id', request.invoice_id
                    ).execute().data
                    if gkpi_inv:
                        gkpi_svc.save_correction(
                            gkpi_invoice_id=gkpi_inv[0]['id'],
                            source_invoice_id=request.invoice_id,
                            field_name=field.field_name,
                            original_value=original,
                            corrected_value=field.validated_value,
                            source='user',
                        )
                except Exception:
                    pass  # corrections are non-critical

    # Check if all fields are validated
    all_fields = supabase.table('extracted_fields').select('is_validated').eq('invoice_id', request.invoice_id).execute()
    all_validated = all(f['is_validated'] for f in all_fields.data) if all_fields.data else False
    
    if all_validated:
        supabase.table('invoices').update({
            'status': 'validated',
            'updated_at': datetime.utcnow().isoformat(),
        }).eq('id', request.invoice_id).execute()
    
    return {
        'updated_fields': updated_fields,
        'all_validated': all_validated,
    }


@router.post("/reextract/{invoice_id}")
async def reextract_fields(invoice_id: str):
    """Re-extract fields using the latest rules"""
    supabase = get_supabase_admin()
    
    # Get OCR results
    ocr_result = supabase.table('ocr_results').select('*').eq('invoice_id', invoice_id).execute()

    if not ocr_result.data:
        raise HTTPException(status_code=400, detail="No OCR results found. Run OCR first.")

    ocr = ocr_result.data[0]

    # Delete existing extracted fields
    supabase.table('extracted_fields').delete().eq('invoice_id', invoice_id).execute()
    supabase.table('line_items').delete().eq('invoice_id', invoice_id).execute()

    # Re-extract
    extractor = get_extraction_service()
    fields = extractor.extract_fields(
        ocr['raw_text'],
        ocr.get('word_boxes', [])
    )

    # Save extracted fields
    for field_name, field_data in fields.items():
        supabase.table('extracted_fields').insert({
            'invoice_id': invoice_id,
            'field_name': field_name,
            'raw_value': field_data['raw_value'],
            'normalized_value': field_data['normalized_value'],
            'extraction_method': field_data['extraction_method'],
            'confidence_score': field_data['confidence_score'],
        }).execute()

    # Extract line items
    line_items = extractor.extract_line_items(
        ocr['raw_text'],
        ocr.get('word_boxes', [])
    )
    
    for item in line_items:
        supabase.table('line_items').insert({
            'invoice_id': invoice_id,
            **item,
        }).execute()
    
    # Update status
    supabase.table('invoices').update({
        'status': 'extraction_complete',
        'updated_at': datetime.utcnow().isoformat(),
    }).eq('id', invoice_id).execute()
    
    return {
        'message': 'Re-extraction complete',
        'fields_count': len(fields),
        'line_items_count': len(line_items),
    }


@router.get("/rules")
async def get_extraction_rules():
    """Get all extraction rules"""
    supabase = get_supabase_admin()
    
    rules = supabase.table('extraction_rules').select('*').eq('is_active', True).order('priority', desc=True).execute()
    
    return rules.data


@router.post("/rules")
async def create_extraction_rule(rule: Dict[str, Any]):
    """Create a new extraction rule"""
    supabase = get_supabase_admin()
    
    result = supabase.table('extraction_rules').insert(rule).execute()
    
    return result.data[0] if result.data else None


@router.get("/accuracy")
async def get_extraction_accuracy():
    """Get extraction accuracy metrics"""
    supabase = get_supabase_admin()
    
    # Get all validated fields
    fields = supabase.table('extracted_fields').select('*').eq('is_validated', True).execute()
    
    if not fields.data:
        return {
            'total_validated': 0,
            'accuracy': None,
            'by_field': {},
        }
    
    # Calculate accuracy
    total = len(fields.data)
    correct = sum(1 for f in fields.data if f['raw_value'] == f['validated_value'])
    
    # Group by field name
    by_field = {}
    for field in fields.data:
        name = field['field_name']
        if name not in by_field:
            by_field[name] = {'total': 0, 'correct': 0}
        by_field[name]['total'] += 1
        if field['raw_value'] == field['validated_value']:
            by_field[name]['correct'] += 1
    
    # Calculate per-field accuracy
    for name in by_field:
        by_field[name]['accuracy'] = by_field[name]['correct'] / by_field[name]['total']
    
    return {
        'total_validated': total,
        'correct': correct,
        'accuracy': correct / total if total > 0 else None,
        'by_field': by_field,
    }
