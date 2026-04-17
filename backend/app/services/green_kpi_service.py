"""
Green KPI Service
=================
Handles all writes to the green_kpi.* Supabase tables.

Responsibilities:
  • Create / update green_kpi.invoices records (linked to source invoice)
  • Write structured data to green_kpi.invoice_data
  • Record user corrections to green_kpi.corrections
  • Log each processing stage to green_kpi.processing_logs
  • Expose aggregate stats for the dashboard
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.services.supabase_client import get_supabase_admin


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GreenKPIService:

    def __init__(self) -> None:
        self._sb = get_supabase_admin()

    # ------------------------------------------------------------------
    # Invoice record
    # ------------------------------------------------------------------

    def create_invoice_record(
        self,
        source_invoice_id: str,
        uploaded_by: str,
        file_path: str,
    ) -> str:
        """Create green_kpi.invoices row. Returns new green_kpi invoice id."""
        result = (
            self._sb.schema("green_kpi")
            .table("invoices")
            .upsert(
                {
                    "source_invoice_id": source_invoice_id,
                    "uploaded_by": uploaded_by,
                    "file_path": file_path,
                    "processing_status": "pending",
                    "updated_at": _now(),
                },
                on_conflict="source_invoice_id",
            )
            .execute()
        )
        return result.data[0]["id"]

    def update_status(self, gkpi_invoice_id: str, status: str, error: str = None) -> None:
        payload = {"processing_status": status, "updated_at": _now()}
        if error:
            payload["error_message"] = error
        self._sb.schema("green_kpi").table("invoices").update(payload).eq(
            "id", gkpi_invoice_id
        ).execute()

    # ------------------------------------------------------------------
    # Invoice data
    # ------------------------------------------------------------------

    def save_invoice_data(
        self,
        gkpi_invoice_id: str,
        fields: Dict[str, Any],
        line_items: List[Dict],
        sustainability_tags: List[str],
        compliance_flags: Dict[str, Any],
        graph_embedding: List[float],
        confidence_score: float,
        extraction_method: str,
        llm_prompt: Optional[str] = None,
        llm_response: Optional[Dict] = None,
    ) -> None:
        def _v(fname: str) -> Optional[str]:
            """Get normalized_value for a field."""
            f = fields.get(fname)
            if not f:
                return None
            return f.get("normalized_value") or f.get("raw_value")

        def _f(fname: str) -> Optional[float]:
            v = _v(fname)
            if v is None:
                return None
            try:
                return float(v)
            except (ValueError, TypeError):
                return None

        def _d(fname: str) -> Optional[str]:
            """Get a date value; return None if not parseable."""
            v = _v(fname)
            if not v:
                return None
            # Accept YYYY-MM-DD directly
            if len(v) == 10 and v[4] == "-":
                return v
            return None

        self._sb.schema("green_kpi").table("invoice_data").upsert(
            {
                "green_kpi_invoice_id": gkpi_invoice_id,
                "vendor_name":      _v("vendor_name"),
                "invoice_number":   _v("invoice_number"),
                "invoice_date":     _d("invoice_date"),
                "due_date":         _d("due_date"),
                "subtotal":         _f("subtotal"),
                "tax_amount":       _f("tax_amount"),
                "total_amount":     _f("total_amount"),
                "currency":         _v("currency") or "AUD",
                "line_items":       line_items,
                "sustainability_tags": sustainability_tags,
                "compliance_flags": compliance_flags,
                "confidence_score": confidence_score,
                "graph_embedding":  graph_embedding,
                "extraction_method": extraction_method,
                "llm_prompt":       llm_prompt,
                "llm_response":     llm_response,
            },
            on_conflict="green_kpi_invoice_id",
        ).execute()

    # ------------------------------------------------------------------
    # Corrections
    # ------------------------------------------------------------------

    def save_correction(
        self,
        gkpi_invoice_id: str,
        source_invoice_id: str,
        field_name: str,
        original_value: str,
        corrected_value: str,
        source: str = "user",
    ) -> None:
        self._sb.schema("green_kpi").table("corrections").insert(
            {
                "green_kpi_invoice_id": gkpi_invoice_id,
                "source_invoice_id":    source_invoice_id,
                "field_name":           field_name,
                "original_value":       original_value,
                "corrected_value":      corrected_value,
                "correction_source":    source,
            }
        ).execute()

    # ------------------------------------------------------------------
    # Processing logs
    # ------------------------------------------------------------------

    def log_stage(
        self,
        gkpi_invoice_id: str,
        stage: str,
        status: str = "ok",
        duration_ms: int = 0,
        metadata: Optional[Dict] = None,
    ) -> None:
        self._sb.schema("green_kpi").table("processing_logs").insert(
            {
                "green_kpi_invoice_id": gkpi_invoice_id,
                "stage":       stage,
                "status":      status,
                "duration_ms": duration_ms,
                "metadata":    metadata or {},
            }
        ).execute()

    # ------------------------------------------------------------------
    # Dashboard stats
    # ------------------------------------------------------------------

    def get_confidence_trend(self, days: int = 30) -> List[Dict[str, Any]]:
        """
        Return daily average confidence scores over the last `days` days.
        Each entry: {date: "YYYY-MM-DD", avg_confidence: float, count: int}
        Sorted oldest → newest (for a left-to-right line chart).
        """
        from datetime import timedelta

        rows = (
            self._sb.schema("green_kpi")
            .table("invoices")
            .select("id, created_at")
            .order("created_at", desc=False)
            .execute()
            .data
            or []
        )

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        recent = [
            r for r in rows
            if r.get("created_at") and
               datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) >= cutoff
        ]

        if not recent:
            return []

        # Batch-fetch confidence scores for those invoice ids
        gkpi_ids = [r["id"] for r in recent]
        data_rows = (
            self._sb.schema("green_kpi")
            .table("invoice_data")
            .select("green_kpi_invoice_id, confidence_score")
            .in_("green_kpi_invoice_id", gkpi_ids)
            .execute()
            .data
            or []
        )

        score_by_id = {
            d["green_kpi_invoice_id"]: float(d["confidence_score"])
            for d in data_rows
            if d.get("confidence_score") is not None
        }

        # Group by date
        from collections import defaultdict
        by_date: Dict[str, List[float]] = defaultdict(list)
        for r in recent:
            dt_str = r["created_at"][:10]          # "YYYY-MM-DD"
            score  = score_by_id.get(r["id"])
            if score is not None:
                by_date[dt_str].append(score)

        return [
            {
                "date":           date,
                "avg_confidence": round(sum(scores) / len(scores) * 100, 1),
                "count":          len(scores),
            }
            for date, scores in sorted(by_date.items())
            if scores
        ]

    def get_stats(self) -> Dict[str, Any]:
        """Aggregate stats across all green_kpi invoices."""

        invoices = (
            self._sb.schema("green_kpi")
            .table("invoices")
            .select("processing_status")
            .execute()
            .data
            or []
        )

        data_rows = (
            self._sb.schema("green_kpi")
            .table("invoice_data")
            .select("sustainability_tags, compliance_flags, confidence_score, total_amount")
            .execute()
            .data
            or []
        )

        corrections = (
            self._sb.schema("green_kpi")
            .table("corrections")
            .select("id")
            .execute()
            .data
            or []
        )

        # Status breakdown
        status_counts: Dict[str, int] = {}
        for inv in invoices:
            s = inv.get("processing_status", "unknown")
            status_counts[s] = status_counts.get(s, 0) + 1

        # Tag frequency
        tag_counts: Dict[str, int] = {}
        for row in data_rows:
            for tag in (row.get("sustainability_tags") or []):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        # GST compliance rate
        gst_valid_count = sum(
            1 for row in data_rows
            if (row.get("compliance_flags") or {}).get("gst_valid") is True
        )

        # Avg confidence
        scores = [
            float(r["confidence_score"])
            for r in data_rows
            if r.get("confidence_score") is not None
        ]
        avg_confidence = round(sum(scores) / len(scores) * 100, 1) if scores else 0.0

        # Total spend
        totals = [
            float(r["total_amount"])
            for r in data_rows
            if r.get("total_amount") is not None
        ]
        total_spend = round(sum(totals), 2)

        return {
            "total_invoices": len(invoices),
            "status_breakdown": status_counts,
            "completed": status_counts.get("completed", 0),
            "needs_review": status_counts.get("needs_review", 0),
            "failed": status_counts.get("failed", 0),
            "avg_confidence_pct": avg_confidence,
            "total_spend_aud": total_spend,
            "gst_valid_count": gst_valid_count,
            "gst_compliance_pct": round(gst_valid_count / max(len(data_rows), 1) * 100, 1),
            "total_corrections": len(corrections),
            "top_sustainability_tags": sorted(
                tag_counts.items(), key=lambda x: x[1], reverse=True
            )[:6],
        }


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_green_kpi_service: Optional[GreenKPIService] = None


def get_green_kpi_service() -> GreenKPIService:
    global _green_kpi_service
    if _green_kpi_service is None:
        _green_kpi_service = GreenKPIService()
    return _green_kpi_service
