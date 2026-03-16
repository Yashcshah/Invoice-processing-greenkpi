from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os
import tempfile
import traceback
from datetime import datetime

from app.services.supabase_client import get_supabase_admin
from app.services.preprocessing_service import get_preprocessing_service
from app.services.ocr_service import get_ocr_service
from app.services.extraction_service import get_extraction_service

router = APIRouter()


class ProcessRequest(BaseModel):
    invoice_id: str
    skip_preprocessing: bool = False
    skip_ocr: bool = False
    skip_extraction: bool = False


class ProcessResponse(BaseModel):
    invoice_id: str
    status: str
    message: str


@router.post("/process", response_model=ProcessResponse)
async def process_invoice(request: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Start processing an invoice
    
    This runs the full pipeline:
    1. Download file from storage
    2. Preprocess image
    3. Run OCR
    4. Extract fields
    """
    supabase = get_supabase_admin()
    
    # Get invoice
    invoice_result = supabase.table('invoices').select('*').eq('id', request.invoice_id).execute()

    if not invoice_result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice = invoice_result.data[0]

    if invoice['status'] not in ['uploaded', 'failed']:
        raise HTTPException(status_code=400, detail="Invoice is already being processed or completed")

    # Update status
    supabase.table('invoices').update({
        'status': 'preprocessing',
        'updated_at': datetime.utcnow().isoformat(),
    }).eq('id', request.invoice_id).execute()

    # Add background task
    background_tasks.add_task(
        run_processing_pipeline,
        request.invoice_id,
        invoice['file_path'],
        request.skip_preprocessing,
        request.skip_ocr,
        request.skip_extraction,
    )
    
    return {
        'invoice_id': request.invoice_id,
        'status': 'processing',
        'message': 'Processing started',
    }


async def run_processing_pipeline(
    invoice_id: str,
    file_path: str,
    skip_preprocessing: bool,
    skip_ocr: bool,
    skip_extraction: bool,
):
    """Run the full processing pipeline"""
    supabase = get_supabase_admin()
    
    try:
        # Download file from storage
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file_path)[1]) as tmp:
            file_data = supabase.storage.from_('invoices-raw').download(file_path)
            tmp.write(file_data)
            local_path = tmp.name
        
        processed_path = local_path
        
        # Step 1: Preprocessing
        # PDFs are converted to images page-by-page inside extract_from_pdf(),
        # so we skip the image-only preprocessing step for PDF inputs.
        is_pdf = local_path.lower().endswith('.pdf')

        if not skip_preprocessing:
            supabase.table('invoices').update({'status': 'preprocessing'}).eq('id', invoice_id).execute()

            if is_pdf:
                # No image preprocessing for PDFs — mark step as done and move on
                supabase.table('invoices').update({'status': 'preprocessed'}).eq('id', invoice_id).execute()
            else:
                preprocessor = get_preprocessing_service()
                result = preprocessor.preprocess(local_path)
                processed_path = result['output_path']

                # Save preprocessing steps
                step_count = max(len(result['steps_applied']), 1)
                for i, step in enumerate(result['steps_applied']):
                    supabase.table('preprocessing_steps').insert({
                        'invoice_id': invoice_id,
                        'step_name': step['name'],
                        'step_order': i + 1,
                        'parameters': step['params'],
                        'success': True,
                        'processing_time_ms': result['processing_time_ms'] // step_count,
                        'quality_metrics': result['quality_metrics'],
                    }).execute()

                supabase.table('invoices').update({'status': 'preprocessed'}).eq('id', invoice_id).execute()
        
        # Step 2: OCR
        ocr_result = None
        if not skip_ocr:
            supabase.table('invoices').update({'status': 'ocr_processing'}).eq('id', invoice_id).execute()
            
            ocr_service = get_ocr_service()
            
            if file_path.lower().endswith('.pdf'):
                # Handle PDF
                ocr_results = ocr_service.extract_from_pdf(processed_path)
                # Combine results from all pages
                ocr_result = {
                    'raw_text': '\n\n'.join([r['raw_text'] for r in ocr_results]),
                    'confidence_score': sum([r['confidence_score'] for r in ocr_results]) / len(ocr_results),
                    'word_boxes': [],
                    'ocr_engine': ocr_results[0]['ocr_engine'],
                    'engine_version': ocr_results[0]['engine_version'],
                    'processing_time_ms': sum([r['processing_time_ms'] for r in ocr_results]),
                }
                for r in ocr_results:
                    ocr_result['word_boxes'].extend(r.get('word_boxes', []))
            else:
                ocr_result = ocr_service.extract_text(processed_path)
            
            # Save OCR results
            supabase.table('ocr_results').insert({
                'invoice_id': invoice_id,
                'ocr_engine': ocr_result['ocr_engine'],
                'engine_version': ocr_result.get('engine_version'),
                'raw_text': ocr_result['raw_text'],
                'confidence_score': ocr_result['confidence_score'],
                'word_boxes': ocr_result.get('word_boxes'),
                'processing_time_ms': ocr_result['processing_time_ms'],
            }).execute()
            
            supabase.table('invoices').update({'status': 'ocr_complete'}).eq('id', invoice_id).execute()
        
        # Step 3: Field Extraction
        if not skip_extraction and ocr_result:
            supabase.table('invoices').update({'status': 'extraction_processing'}).eq('id', invoice_id).execute()
            
            extractor = get_extraction_service()
            fields = extractor.extract_fields(
                ocr_result['raw_text'],
                ocr_result.get('word_boxes', [])
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
                ocr_result['raw_text'],
                ocr_result.get('word_boxes', [])
            )
            
            for item in line_items:
                supabase.table('line_items').insert({
                    'invoice_id': invoice_id,
                    **item,
                }).execute()
            
            # Denormalize vendor_name + match against user folders to suggest one
            vendor_name = (
                fields.get('vendor_name', {}).get('normalized_value')
                or fields.get('vendor_name', {}).get('raw_value')
            )
            if vendor_name:
                vendor_name = vendor_name.strip() or None

            folder_update: dict = {}
            if vendor_name:
                folder_update['vendor_name'] = vendor_name
                folders_result = supabase.table('invoice_folders').select('id, name').execute()
                for folder in folders_result.data:
                    folder_lower = folder['name'].lower()
                    vendor_lower = vendor_name.lower()
                    if folder_lower in vendor_lower or vendor_lower in folder_lower:
                        folder_update['suggested_folder_id'] = folder['id']
                        break
            if folder_update:
                supabase.table('invoices').update(folder_update).eq('id', invoice_id).execute()

            supabase.table('invoices').update({'status': 'extraction_complete'}).eq('id', invoice_id).execute()

        # Mark as complete
        supabase.table('invoices').update({
            'status': 'extraction_complete',
            'processed_at': datetime.utcnow().isoformat(),
        }).eq('id', invoice_id).execute()
        
        # Log success
        supabase.table('processing_logs').insert({
            'invoice_id': invoice_id,
            'log_level': 'info',
            'component': 'pipeline',
            'action': 'complete',
            'message': 'Invoice processing completed successfully',
        }).execute()
        
    except Exception as e:
        # Mark as failed
        supabase.table('invoices').update({
            'status': 'failed',
            'updated_at': datetime.utcnow().isoformat(),
        }).eq('id', invoice_id).execute()
        
        # Log error with full traceback so we can identify the source
        full_error = traceback.format_exc()
        print("=== PIPELINE ERROR ===")
        print(full_error)
        print("=== END ERROR ===")
        import sys; sys.stdout.flush()
        supabase.table('processing_logs').insert({
            'invoice_id': invoice_id,
            'log_level': 'error',
            'component': 'pipeline',
            'action': 'error',
            'message': full_error,
        }).execute()
        
        raise
    
    finally:
        # Cleanup temp files
        try:
            os.unlink(local_path)
            if processed_path != local_path:
                os.unlink(processed_path)
        except:
            pass


@router.get("/status/{invoice_id}")
async def get_processing_status(invoice_id: str):
    """Get the processing status of an invoice"""
    supabase = get_supabase_admin()
    
    invoice_result = supabase.table('invoices').select('id, status, updated_at').eq('id', invoice_id).execute()

    if not invoice_result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice = invoice_result.data[0]

    # Get processing logs
    logs = supabase.table('processing_logs').select('*').eq('invoice_id', invoice_id).order('created_at', desc=True).limit(10).execute()

    return {
        'invoice_id': invoice_id,
        'status': invoice['status'],
        'updated_at': invoice['updated_at'],
        'logs': logs.data,
    }
