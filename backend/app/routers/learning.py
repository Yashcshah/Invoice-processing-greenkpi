"""
Learning Router  —  /api/learning
===================================
Endpoints for the ML cluster-agent system.

POST /api/learning/retrain
    Trigger a full retrain in the background (re-cluster + update agents).

GET  /api/learning/stats
    Return cluster/agent statistics for the dashboard.

POST /api/learning/assign/{invoice_id}
    (Re-)assign a single invoice to its cluster.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.services.learning_service import get_learning_service
from app.services.supabase_client import get_supabase_admin

router = APIRouter()


@router.post("/retrain")
async def trigger_retrain(background_tasks: BackgroundTasks):
    """Start a full retrain of all cluster agents + GAT fine-tune (runs in background)."""
    learning = get_learning_service()
    background_tasks.add_task(_run_retrain, learning)
    return {
        "status": "started",
        "message": "Retraining cluster agents and fine-tuning GAT in the background.",
    }


async def _run_retrain(learning) -> None:
    """Background wrapper: retrain clusters then fine-tune the GAT."""
    import traceback

    # 1. Retrain ML cluster agents
    try:
        result = await learning.retrain_all()
        print("[LearningService] retrain_all result:", result)
    except Exception:
        print("[LearningService] retrain_all error:", traceback.format_exc())

    # 2. Fine-tune the GAT from user corrections (non-critical)
    try:
        await _retrain_gat_from_corrections()
    except Exception:
        print("[GNNService] retrain_from_corrections error:", traceback.format_exc())


async def _retrain_gat_from_corrections() -> None:
    """
    Fetch validated corrections from the DB, rebuild document graphs,
    and fine-tune the GAT model.
    """
    from app.services.gnn_service import get_gnn_service
    from app.services.graph_builder import get_graph_builder

    supabase = get_supabase_admin()
    gnn      = get_gnn_service()
    builder  = get_graph_builder()

    # Only proceed if full GAT mode is available
    if gnn.mode != "full":
        print(f"[GNNService] GAT fine-tune skipped (mode={gnn.mode})")
        return

    # Fetch all invoices that have at least one user-validated field
    validated_rows = (
        supabase.table("extracted_fields")
        .select("invoice_id, field_name, normalized_value, raw_value, validated_value")
        .eq("is_validated", True)
        .not_.is_("validated_value", "null")
        .execute()
        .data or []
    )

    if not validated_rows:
        print("[GNNService] GAT fine-tune: no validated fields found")
        return

    # Group by invoice_id
    from collections import defaultdict
    by_invoice: dict = defaultdict(list)
    for row in validated_rows:
        by_invoice[row["invoice_id"]].append(row)

    training_examples = []
    for invoice_id, fields in by_invoice.items():
        # Fetch OCR word_boxes for this invoice
        ocr_rows = (
            supabase.table("ocr_results")
            .select("raw_text, word_boxes")
            .eq("invoice_id", invoice_id)
            .execute()
            .data or []
        )
        if not ocr_rows or not ocr_rows[0].get("raw_text"):
            continue

        ocr = ocr_rows[0]
        try:
            graph_data = builder.build(
                word_boxes=ocr.get("word_boxes") or [],
            )
        except Exception as e:
            print(f"[GNNService] graph build failed for {invoice_id}: {e}")
            continue

        corrections: dict = {}
        validated:   dict = {}

        for f in fields:
            extracted  = (f.get("normalized_value") or f.get("raw_value") or "").strip()
            val_value  = (f.get("validated_value") or "").strip()
            fname      = f["field_name"]

            if not val_value:
                continue

            if val_value.lower() != extracted.lower():
                corrections[fname] = {"original": extracted, "corrected": val_value}
            else:
                validated[fname] = val_value

        if corrections or validated:
            training_examples.append({
                "graph_data":  graph_data,
                "corrections": corrections,
                "validated":   validated,
            })

    if not training_examples:
        print("[GNNService] GAT fine-tune: no usable training examples")
        return

    result = gnn.retrain_from_corrections(training_examples)
    print(f"[GNNService] GAT fine-tune complete: {result}")


@router.get("/stats")
async def get_learning_stats():
    """Return ML agent statistics for the dashboard ML panel."""
    learning = get_learning_service()
    return await learning.get_stats()


@router.post("/assign/{invoice_id}")
async def assign_invoice_cluster(invoice_id: str):
    """(Re-)assign an invoice to its cluster. Useful after manual edits."""
    supabase = get_supabase_admin()

    ocr_rows = (
        supabase.table("ocr_results")
        .select("raw_text")
        .eq("invoice_id", invoice_id)
        .execute()
        .data
        or []
    )
    if not ocr_rows or not ocr_rows[0].get("raw_text"):
        raise HTTPException(
            status_code=404,
            detail="No OCR text found for this invoice.",
        )

    text = ocr_rows[0]["raw_text"]
    learning = get_learning_service()
    result = await learning.assign_invoice_to_cluster(invoice_id, text)
    return {"invoice_id": invoice_id, **result}
