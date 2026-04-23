from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os
import tempfile
import traceback
from datetime import datetime

from app.config import get_settings
from app.services.supabase_client import get_supabase_admin
from app.services.preprocessing_service import get_preprocessing_service
from app.services.ocr_service import get_ocr_service
from app.services.extraction_service import get_extraction_service
from app.services.agent_manager import get_agent_manager
from app.services.learning_service import get_learning_service
from app.services.llm_service import get_llm_service
from app.services.graph_builder import get_graph_builder
from app.services.gnn_service import get_gnn_service
from app.services.validation_service import get_validation_service
from app.services.green_kpi_service import get_green_kpi_service

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

    # Block reprocessing only while a pipeline is actively running.
    # Completed, stuck, or failed states are all fair game for a new run.
    ACTIVE_STATUSES = {'preprocessing', 'ocr_processing', 'extraction_processing'}
    if invoice['status'] in ACTIVE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invoice is currently being processed (status: {invoice['status']}). Please wait."
        )

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
    
    # Initialize variables so Green KPI stage can always reference them
    fields: dict = {}
    line_items: list = []
    ocr_result = None

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

            # --- ML agent: get cluster + learned patterns for this invoice ---
            agent_manager = get_agent_manager()
            agent_context = await agent_manager.get_agent_context(ocr_result['raw_text'])
            cluster_id = agent_context.get('cluster_id')  # may be None if not yet trained

            extractor = get_extraction_service()
            # Load cluster-specific DB rules on top of defaults (fixes disconnection gap)
            extractor.load_db_rules(cluster_id=cluster_id)

            fields = extractor.extract_fields(
                ocr_result['raw_text'],
                ocr_result.get('word_boxes', [])
            )

            # Apply cluster agent's learned corrections (no-op if not trained yet)
            fields = agent_manager.apply_learned_patterns(fields, agent_context)

            # Save extracted fields — include rule_id for traceability
            for field_name, field_data in fields.items():
                supabase.table('extracted_fields').insert({
                    'invoice_id': invoice_id,
                    'field_name': field_name,
                    'raw_value': field_data['raw_value'],
                    'normalized_value': field_data['normalized_value'],
                    'extraction_method': field_data['extraction_method'],
                    'confidence_score': field_data['confidence_score'],
                    'rule_id': field_data.get('rule_id'),  # NULL for LLM/GNN-sourced fields
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

            # --- ML agent: persist cluster assignment for this invoice ---
            try:
                learning = get_learning_service()
                await learning.assign_invoice_to_cluster(invoice_id, ocr_result['raw_text'])
            except Exception:
                pass  # cluster assignment is non-critical; never block the pipeline

        # ── Green KPI pipeline ────────────────────────────────────────────
        # All stages are non-blocking — errors are logged but never fail the invoice
        settings_obj = get_settings()
        if settings_obj.green_kpi_enabled and ocr_result:
            await _run_green_kpi_pipeline(
                invoice_id=invoice_id,
                file_path=file_path,
                local_path=processed_path,
                ocr_result=ocr_result,
                extracted_fields=fields if not skip_extraction else {},
                extracted_line_items=line_items if not skip_extraction else [],
                supabase=supabase,
            )

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


async def _run_green_kpi_pipeline(
    invoice_id: str,
    file_path: str,
    local_path: str,
    ocr_result: dict,
    extracted_fields: dict,
    extracted_line_items: list,
    supabase,
) -> None:
    """
    Green KPI pipeline: LLM → Graph → GNN → Validate → Store
    Runs after the core extraction pipeline. All stages are try/except wrapped.
    """
    import time as _time
    settings_obj = get_settings()

    # Get uploaded_by for the invoice
    inv_row = supabase.table('invoices').select('uploaded_by').eq('id', invoice_id).execute().data
    uploaded_by = inv_row[0]['uploaded_by'] if inv_row else None

    green_kpi_svc = get_green_kpi_service()

    # Create / retrieve green_kpi.invoices record
    try:
        gkpi_id = green_kpi_svc.create_invoice_record(
            source_invoice_id=invoice_id,
            uploaded_by=uploaded_by,
            file_path=file_path,
        )
    except Exception as exc:
        print(f"[GreenKPI] Could not create invoice record: {exc}")
        return

    # ── Stage 1: LLM encode ──────────────────────────────────────────────
    llm_output = {}
    if settings_obj.llm_enabled:
        t0 = _time.time()
        try:
            green_kpi_svc.update_status(gkpi_id, "llm_processed")
            llm_svc = get_llm_service()
            llm_output = await llm_svc.encode_invoice(
                image_path=local_path if not local_path.endswith('.pdf') else None,
                ocr_text=ocr_result.get('raw_text', ''),
                word_boxes=ocr_result.get('word_boxes', []),
            )
            dur = int((_time.time() - t0) * 1000)
            green_kpi_svc.log_stage(gkpi_id, "llm", "ok" if not llm_output.get("skipped") else "skipped", dur,
                                    {"skip_reason": llm_output.get("skip_reason")})

            # Merge LLM fields on top of regex fields (LLM wins where available)
            for fname, fdata in llm_output.get("fields", {}).items():
                if fname not in extracted_fields or \
                        fdata.get("confidence_score", 0) > extracted_fields[fname].get("confidence_score", 0):
                    extracted_fields[fname] = fdata
        except Exception as exc:
            green_kpi_svc.log_stage(gkpi_id, "llm", "error", 0, {"error": str(exc)})

    # ── Stage 2: Graph construction ──────────────────────────────────────
    graph_data = {}
    t0 = _time.time()
    try:
        green_kpi_svc.update_status(gkpi_id, "graph_built")
        builder = get_graph_builder()
        graph_data = builder.build(
            word_boxes=ocr_result.get('word_boxes', []),
            llm_output=llm_output,
        )
        dur = int((_time.time() - t0) * 1000)
        green_kpi_svc.log_stage(gkpi_id, "graph", "ok", dur,
                                {"n_nodes": graph_data.get("n_nodes"), "n_edges": graph_data.get("n_edges")})
    except Exception as exc:
        green_kpi_svc.log_stage(gkpi_id, "graph", "error", 0, {"error": str(exc)})

    # ── Stage 3: GNN reasoning ───────────────────────────────────────────
    graph_embedding = []
    if settings_obj.gnn_enabled:
        t0 = _time.time()
        try:
            green_kpi_svc.update_status(gkpi_id, "gnn_processed")
            gnn_svc = get_gnn_service()
            gnn_result = gnn_svc.infer(graph_data, extracted_fields)
            extracted_fields = gnn_result["fields"]
            graph_embedding = gnn_result.get("graph_embedding", [])
            dur = int((_time.time() - t0) * 1000)
            green_kpi_svc.log_stage(gkpi_id, "gnn", "ok", dur, {"mode": gnn_result.get("mode")})
        except Exception as exc:
            green_kpi_svc.log_stage(gkpi_id, "gnn", "error", 0, {"error": str(exc)})

    # ── Stage 4: Validation + sustainability ─────────────────────────────
    validation_result = {
        "fields": extracted_fields,
        "sustainability_tags": [],
        "compliance_flags": {},
        "processing_status": "completed",
        "validation_notes": [],
    }
    t0 = _time.time()
    try:
        green_kpi_svc.update_status(gkpi_id, "validated")
        validator = get_validation_service()
        validation_result = validator.validate(
            fields=extracted_fields,
            line_items=extracted_line_items,
            llm_sustainability_tags=llm_output.get("sustainability_tags", []),
            llm_compliance=llm_output.get("compliance", {}),
        )
        dur = int((_time.time() - t0) * 1000)
        green_kpi_svc.log_stage(gkpi_id, "validate", "ok", dur,
                                {"notes": validation_result.get("validation_notes", [])})
    except Exception as exc:
        green_kpi_svc.log_stage(gkpi_id, "validate", "error", 0, {"error": str(exc)})

    # ── Stage 4.5: ABN + GST registration check ──────────────────────────
    t0 = _time.time()
    try:
        from app.services.abn_service import run_abn_gst_check
        abn_result = await run_abn_gst_check(validation_result.get("fields", extracted_fields))
        # Merge ABN/GST flags into the existing compliance_flags dict
        validation_result.setdefault("compliance_flags", {}).update(abn_result)
        dur = int((_time.time() - t0) * 1000)
        green_kpi_svc.log_stage(gkpi_id, "abn_check", "ok", dur, {
            "abn": abn_result.get("abn_normalised"),
            "format_valid": abn_result.get("abn_format_valid"),
            "checksum_valid": abn_result.get("abn_checksum_valid"),
            "gst_math_valid": abn_result.get("gst_math_valid"),
            "api_used": abn_result.get("abn_checked_via_api"),
        })
    except Exception as exc:
        green_kpi_svc.log_stage(gkpi_id, "abn_check", "error", 0, {"error": str(exc)})

    # ── Stage 5: Store green_kpi.invoice_data ─────────────────────────────
    t0 = _time.time()
    try:
        final_fields = validation_result.get("fields", extracted_fields)
        confs = [f.get("confidence_score", 0.8) for f in final_fields.values()]
        avg_conf = sum(confs) / len(confs) if confs else 0.0

        # Determine best extraction method used
        methods = {f.get("extraction_method", "regex") for f in final_fields.values()}
        if "gnn" in methods:
            best_method = "gnn"
        elif "llm" in methods:
            best_method = "llm"
        elif "agent_learned" in methods:
            best_method = "agent_learned"
        else:
            best_method = "regex"

        green_kpi_svc.save_invoice_data(
            gkpi_invoice_id=gkpi_id,
            fields=final_fields,
            line_items=extracted_line_items,
            sustainability_tags=validation_result.get("sustainability_tags", []),
            compliance_flags=validation_result.get("compliance_flags", {}),
            graph_embedding=graph_embedding,
            confidence_score=round(avg_conf, 4),
            extraction_method=best_method,
            llm_prompt=llm_output.get("llm_prompt"),
            llm_response={"raw": llm_output.get("llm_response_raw")} if llm_output.get("llm_response_raw") else None,
        )
        green_kpi_svc.update_status(gkpi_id, validation_result.get("processing_status", "completed"))
        dur = int((_time.time() - t0) * 1000)
        green_kpi_svc.log_stage(gkpi_id, "store", "ok", dur)
    except Exception as exc:
        green_kpi_svc.log_stage(gkpi_id, "store", "error", 0, {"error": str(exc)})
        green_kpi_svc.update_status(gkpi_id, "failed", str(exc))


@router.post("/reset-stuck")
async def reset_stuck_invoices():
    """
    Reset invoices that are stuck in a mid-pipeline status back to 'failed'
    so they can be reprocessed.  This happens when the server is restarted
    while background tasks are running.
    """
    supabase = get_supabase_admin()
    STUCK_STATUSES = ['preprocessing', 'ocr_processing', 'extraction_processing']

    stuck = (
        supabase.table('invoices')
        .select('id, status, original_filename')
        .in_('status', STUCK_STATUSES)
        .execute()
        .data or []
    )

    if not stuck:
        return {"reset": 0, "message": "No stuck invoices found"}

    ids = [inv['id'] for inv in stuck]
    supabase.table('invoices').update({
        'status': 'failed',
        'updated_at': datetime.utcnow().isoformat(),
    }).in_('id', ids).execute()

    return {
        "reset": len(ids),
        "message": f"Reset {len(ids)} stuck invoice(s) to 'failed'",
        "invoices": [{"id": inv['id'], "filename": inv['original_filename'], "was": inv['status']} for inv in stuck],
    }


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
