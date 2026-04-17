"""
Validation Service  —  Green KPI
=================================
Validates extracted invoice fields and adds Green KPI metadata:

1. Field validation
   - Date format normalisation
   - Vendor name presence check
   - Amount range sanity checks
   - GST reconciliation (subtotal × 1.10 ≈ total)

2. Sustainability tag resolution
   - LLM-suggested tags cleaned and validated
   - Keyword fallback from line item descriptions

3. Australian compliance checks
   - GST / BAS: 10 % tax on goods/services
   - QBCC: Queensland building/construction licencing
   - Retention: progress-claim / retention-clause detection

Returns a clean `ValidationResult` dict consumed by green_kpi_service.py.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Sustainability tag catalogue
# ---------------------------------------------------------------------------

_VALID_TAGS = {
    "renewable_energy", "solar", "wind", "carbon_offset",
    "recycled_materials", "low_emissions", "green_building",
    "water_conservation", "waste_management", "electric_vehicle",
    "sustainable_packaging", "energy_efficiency", "other_green",
}

# Keywords that trigger automatic sustainability tagging from line descriptions
_KEYWORD_TAGS: Dict[str, str] = {
    "solar":         "solar",
    "photovoltaic":  "solar",
    "wind":          "wind",
    "turbine":       "wind",
    "carbon":        "carbon_offset",
    "offset":        "carbon_offset",
    "recycl":        "recycled_materials",
    "compost":       "waste_management",
    "ev ":           "electric_vehicle",
    "electric vehicle": "electric_vehicle",
    "led ":          "energy_efficiency",
    "insulation":    "green_building",
    "rainwater":     "water_conservation",
    "greywater":     "water_conservation",
    "low emission":  "low_emissions",
    "green star":    "green_building",
    "nabers":        "green_building",
}

# QBCC-relevant keywords (Queensland building)
_QBCC_KEYWORDS = [
    "builder", "construction", "building", "renovation", "plumbing",
    "electrical", "carpentry", "roofing", "concreting", "tiling",
    "plastering", "painting", "landscaping", "earthwork", "demolition",
]

# Retention / progress-claim keywords
_RETENTION_KEYWORDS = [
    "retention", "progress claim", "progress payment", "practical completion",
    "defects liability", "milestone", "stage payment",
]

_GST_RATE = 0.10
_GST_TOLERANCE = 0.02   # ± 2 % tolerance on reconciliation


class ValidationService:

    def validate(
        self,
        fields: Dict[str, Any],
        line_items: List[Dict],
        llm_sustainability_tags: Optional[List[str]] = None,
        llm_compliance: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Validate and enrich extracted fields.

        Returns:
            {
              fields: validated + normalised field dict,
              sustainability_tags: List[str],
              compliance_flags: {gst_valid, gst_rate, qbcc_applicable, retention_applicable},
              processing_status: "completed" | "needs_review",
              validation_notes: List[str],
            }
        """
        notes: List[str] = []
        status = "completed"

        # 1. Field-level validation
        fields, field_notes = self._validate_fields(fields)
        notes.extend(field_notes)
        if field_notes:
            status = "needs_review"

        # 2. Amount reconciliation
        recon_ok, recon_notes = self._reconcile_amounts(fields)
        notes.extend(recon_notes)
        if not recon_ok:
            status = "needs_review"

        # 3. Sustainability tags
        tags = self._resolve_sustainability_tags(
            llm_sustainability_tags or [], fields, line_items
        )

        # 4. Compliance
        compliance = self._check_compliance(
            fields, line_items, llm_compliance or {}
        )

        return {
            "fields": fields,
            "sustainability_tags": sorted(tags),
            "compliance_flags": compliance,
            "processing_status": status,
            "validation_notes": notes,
        }

    # ------------------------------------------------------------------
    # Field validation
    # ------------------------------------------------------------------

    def _validate_fields(
        self, fields: Dict[str, Any]
    ) -> tuple[Dict[str, Any], List[str]]:
        notes = []

        # Dates
        for date_field in ("invoice_date", "due_date"):
            if date_field in fields:
                val = fields[date_field].get("normalized_value") or fields[date_field].get("raw_value", "")
                normalised = self._normalise_date(val)
                if normalised:
                    fields[date_field]["normalized_value"] = normalised
                else:
                    notes.append(f"{date_field} could not be parsed: '{val}'")

        # Vendor name
        if "vendor_name" not in fields or not (
            fields["vendor_name"].get("normalized_value") or ""
        ).strip():
            notes.append("vendor_name missing")

        # Amounts must be positive
        for amt_field in ("total_amount", "subtotal", "tax_amount"):
            if amt_field in fields:
                try:
                    val = float(
                        fields[amt_field].get("normalized_value")
                        or fields[amt_field].get("raw_value", 0)
                    )
                    if val < 0:
                        notes.append(f"{amt_field} is negative: {val}")
                    elif val > 10_000_000:
                        notes.append(f"{amt_field} unusually large: {val}")
                except (ValueError, TypeError):
                    notes.append(f"{amt_field} is not a valid number")

        return fields, notes

    # ------------------------------------------------------------------
    # Amount reconciliation (GST)
    # ------------------------------------------------------------------

    def _reconcile_amounts(
        self, fields: Dict[str, Any]
    ) -> tuple[bool, List[str]]:
        notes = []

        def _get(fname: str) -> Optional[float]:
            if fname not in fields:
                return None
            try:
                return float(
                    fields[fname].get("normalized_value")
                    or fields[fname].get("raw_value", 0)
                )
            except (ValueError, TypeError):
                return None

        subtotal = _get("subtotal")
        tax      = _get("tax_amount")
        total    = _get("total_amount")

        if subtotal and tax and total:
            expected_total = round(subtotal + tax, 2)
            if abs(expected_total - total) > _GST_TOLERANCE * total:
                notes.append(
                    f"Amount mismatch: subtotal({subtotal}) + tax({tax}) = "
                    f"{expected_total} ≠ total({total})"
                )
                return False, notes

        if subtotal and total and not tax:
            # Infer tax
            inferred_tax = round(total - subtotal, 2)
            if 0 < inferred_tax < total:
                fields["tax_amount"] = {
                    "raw_value": str(inferred_tax),
                    "normalized_value": str(inferred_tax),
                    "confidence_score": 0.75,
                    "extraction_method": "rule_inferred",
                }
                notes.append(f"tax_amount inferred from total - subtotal = {inferred_tax}")

        return True, notes

    # ------------------------------------------------------------------
    # Sustainability tags
    # ------------------------------------------------------------------

    def _resolve_sustainability_tags(
        self,
        llm_tags: List[str],
        fields: Dict[str, Any],
        line_items: List[Dict],
    ) -> set:
        tags: set = set()

        # Validate LLM tags against catalogue
        for t in llm_tags:
            clean = t.lower().strip().replace(" ", "_")
            if clean in _VALID_TAGS:
                tags.add(clean)

        # Scan line item descriptions for sustainability keywords
        all_text = " ".join(
            (item.get("description") or "") for item in (line_items or [])
        ).lower()
        vendor = (
            (fields.get("vendor_name") or {}).get("normalized_value") or ""
        ).lower()
        full_text = all_text + " " + vendor

        for keyword, tag in _KEYWORD_TAGS.items():
            if keyword in full_text:
                tags.add(tag)

        return tags

    # ------------------------------------------------------------------
    # Compliance checks
    # ------------------------------------------------------------------

    def _check_compliance(
        self,
        fields: Dict[str, Any],
        line_items: List[Dict],
        llm_compliance: Dict,
    ) -> Dict[str, Any]:

        # --- GST validity ---
        gst_applicable = bool(llm_compliance.get("gst_applicable", True))
        gst_valid = False

        def _get(fname: str) -> Optional[float]:
            if fname not in fields:
                return None
            try:
                return float(
                    fields[fname].get("normalized_value")
                    or fields[fname].get("raw_value", 0)
                )
            except (ValueError, TypeError):
                return None

        if gst_applicable:
            subtotal = _get("subtotal")
            tax      = _get("tax_amount")
            if subtotal and tax:
                expected_tax = round(subtotal * _GST_RATE, 2)
                gst_valid = abs(tax - expected_tax) <= _GST_TOLERANCE * expected_tax + 0.01
            else:
                gst_valid = False  # can't confirm

        # --- QBCC ---
        vendor = (
            (fields.get("vendor_name") or {}).get("normalized_value") or ""
        ).lower()
        all_desc = " ".join(
            (item.get("description") or "") for item in (line_items or [])
        ).lower()
        combined = vendor + " " + all_desc

        qbcc = bool(llm_compliance.get("qbcc_applicable", False)) or any(
            kw in combined for kw in _QBCC_KEYWORDS
        )

        # --- Retention ---
        retention = bool(llm_compliance.get("retention_applicable", False)) or any(
            kw in combined for kw in _RETENTION_KEYWORDS
        )

        return {
            "gst_applicable": gst_applicable,
            "gst_valid": gst_valid,
            "gst_rate": _GST_RATE,
            "qbcc_applicable": qbcc,
            "retention_applicable": retention,
        }

    # ------------------------------------------------------------------
    # Date normalisation helper
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_date(value: str) -> Optional[str]:
        if not value:
            return None
        formats = [
            "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d",
            "%d-%m-%Y", "%m-%d-%Y", "%Y-%m-%d",
            "%d.%m.%Y", "%m.%d.%Y", "%Y.%m.%d",
            "%d/%m/%y", "%m/%d/%y",
            "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_validation_service: Optional[ValidationService] = None


def get_validation_service() -> ValidationService:
    global _validation_service
    if _validation_service is None:
        _validation_service = ValidationService()
    return _validation_service
