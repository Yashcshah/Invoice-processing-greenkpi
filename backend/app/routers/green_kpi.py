"""
Green KPI Router  —  /api/green-kpi
=====================================
Endpoints for the Green KPI analytics layer.

GET  /api/green-kpi/stats
    Aggregate stats for the dashboard.

GET  /api/green-kpi/invoices
    List green_kpi invoices with sustainability metadata.

GET  /api/green-kpi/invoices/{invoice_id}
    Full detail for one green_kpi invoice (fields + tags + compliance).

POST /api/green-kpi/corrections
    Submit a field correction (adds to green_kpi.corrections and triggers
    the cluster learning pipeline).

GET  /api/green-kpi/compliance/{invoice_id}
    Compliance report: GST, QBCC, retention flags.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.green_kpi_service import get_green_kpi_service
from app.services.supabase_client import get_supabase_admin

router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class CorrectionRequest(BaseModel):
    source_invoice_id: str
    field_name: str
    original_value: str
    corrected_value: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/stats")
async def green_kpi_stats():
    """Aggregate Green KPI statistics for the dashboard panel."""
    svc = get_green_kpi_service()
    try:
        return svc.get_stats()
    except Exception as exc:
        # Schema may not exist yet — return empty stats rather than 500
        return {
            "total_invoices": 0,
            "completed": 0,
            "needs_review": 0,
            "failed": 0,
            "avg_confidence_pct": 0.0,
            "total_spend_aud": 0.0,
            "gst_compliance_pct": 0.0,
            "total_corrections": 0,
            "top_sustainability_tags": [],
            "_error": str(exc),
        }


@router.get("/confidence-trend")
async def confidence_trend(days: int = 30):
    """
    Daily average extraction confidence for the last `days` days.
    Returns [{date, avg_confidence, count}, ...] oldest → newest.
    """
    svc = get_green_kpi_service()
    try:
        return {"trend": svc.get_confidence_trend(days=days)}
    except Exception as exc:
        return {"trend": [], "_error": str(exc)}


@router.get("/invoices")
async def list_green_kpi_invoices(limit: int = 20, offset: int = 0):
    """List green_kpi invoices with sustainability summary."""
    sb = get_supabase_admin()
    try:
        rows = (
            sb.schema("green_kpi")
            .table("invoices")
            .select("id, source_invoice_id, processing_status, created_at")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
            .data
            or []
        )

        result = []
        for row in rows:
            data = (
                sb.schema("green_kpi")
                .table("invoice_data")
                .select(
                    "vendor_name, total_amount, confidence_score, "
                    "sustainability_tags, compliance_flags, extraction_method"
                )
                .eq("green_kpi_invoice_id", row["id"])
                .execute()
                .data
            )
            d = data[0] if data else {}
            result.append({**row, **d})

        return {"invoices": result, "count": len(result)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/invoices/{invoice_id}")
async def get_green_kpi_invoice(invoice_id: str):
    """
    Full Green KPI detail for one source invoice.

    Returns empty data (200) rather than 404/500 when:
      • the invoice has not been pushed through the green_kpi pipeline yet, or
      • the green_kpi schema/tables do not exist in this environment.

    The frontend treats a null `data` field as "not yet processed" and hides
    the Green KPI strip silently — no need for an error response here.
    """
    sb = get_supabase_admin()
    _empty = {"invoice": None, "data": None, "processing_stages": []}

    try:
        inv = (
            sb.schema("green_kpi")
            .table("invoices")
            .select("*")
            .eq("source_invoice_id", invoice_id)
            .execute()
            .data
        )
    except Exception as exc:
        # green_kpi schema or table missing — not an error the caller can act on
        return {**_empty, "_error": str(exc)}

    if not inv:
        # Invoice exists in the main pipeline but hasn't been written to green_kpi yet
        return _empty

    try:
        gkpi_id = inv[0]["id"]
        data = (
            sb.schema("green_kpi")
            .table("invoice_data")
            .select("*")
            .eq("green_kpi_invoice_id", gkpi_id)
            .execute()
            .data
        )
        logs = (
            sb.schema("green_kpi")
            .table("processing_logs")
            .select("stage, status, duration_ms, created_at")
            .eq("green_kpi_invoice_id", gkpi_id)
            .order("created_at")
            .execute()
            .data
        )
        return {
            "invoice": inv[0],
            "data": data[0] if data else None,
            "processing_stages": logs or [],
        }
    except Exception as exc:
        # invoice_data / processing_logs query failed — return what we have
        return {"invoice": inv[0], "data": None, "processing_stages": [], "_error": str(exc)}


@router.post("/corrections")
async def submit_correction(req: CorrectionRequest):
    """
    Submit a user field correction.
    Writes to green_kpi.corrections so the ML feedback loop can learn from it.
    """
    sb = get_supabase_admin()

    # Resolve green_kpi invoice id from source invoice id
    inv = (
        sb.schema("green_kpi")
        .table("invoices")
        .select("id")
        .eq("source_invoice_id", req.source_invoice_id)
        .execute()
        .data
    )
    if not inv:
        raise HTTPException(
            status_code=404,
            detail="No Green KPI record for this invoice. Process it first.",
        )

    svc = get_green_kpi_service()
    svc.save_correction(
        gkpi_invoice_id=inv[0]["id"],
        source_invoice_id=req.source_invoice_id,
        field_name=req.field_name,
        original_value=req.original_value,
        corrected_value=req.corrected_value,
        source="user",
    )
    return {"status": "saved", "field": req.field_name}


@router.get("/compliance/{invoice_id}")
async def get_compliance_report(invoice_id: str):
    """Return compliance flags for a source invoice."""
    sb = get_supabase_admin()

    inv = (
        sb.schema("green_kpi")
        .table("invoices")
        .select("id, processing_status")
        .eq("source_invoice_id", invoice_id)
        .execute()
        .data
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Green KPI record not found")

    data = (
        sb.schema("green_kpi")
        .table("invoice_data")
        .select("vendor_name, total_amount, compliance_flags, sustainability_tags")
        .eq("green_kpi_invoice_id", inv[0]["id"])
        .execute()
        .data
    )

    return {
        "invoice_id": invoice_id,
        "processing_status": inv[0]["processing_status"],
        "compliance": (data[0].get("compliance_flags") or {}) if data else {},
        "sustainability_tags": (data[0].get("sustainability_tags") or []) if data else [],
        "vendor_name": (data[0].get("vendor_name")) if data else None,
        "total_amount": (data[0].get("total_amount")) if data else None,
    }
