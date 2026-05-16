"""
LLM Service  (Multimodal — Gemini 2.5 Flash)
=============================================
Encodes invoice image + OCR text through a multimodal LLM to produce:
  - Structured field extraction (JSON)
  - Sustainability / ESG tags
  - Layout segment classification (header / line_item / tax / footer)
  - Per-field confidence scores

Falls back gracefully when GEMINI_API_KEY is not set — returns empty dict
so the rest of the pipeline can continue with regex extraction only.

Install:
    pip install google-generativeai>=0.8.0
"""

from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import get_settings

settings = get_settings()

# ---------------------------------------------------------------------------
# Optional import — fail gracefully
# ---------------------------------------------------------------------------
try:
    import google.generativeai as genai
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False


# ---------------------------------------------------------------------------
# Prompts — one base + mode-specific additions
# ---------------------------------------------------------------------------

_BASE_SCHEMA = """\
{
  "vendor_name": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "3-letter ISO code, default AUD",
  "subtotal": number_or_null,
  "tax_amount": number_or_null,
  "total_amount": number_or_null,
  "line_items": [
    {
      "description": "string",
      "quantity": number_or_null,
      "unit_price": number_or_null,
      "total_price": number_or_null,
      "sustainability_tag": "string or null"
    }
  ],
  "sustainability_tags": ["tag1", "tag2"],
  "layout_segments": {
    "header_lines": [0, 1, 2],
    "line_item_lines": [5, 6, 7],
    "tax_lines": [10],
    "footer_lines": [11, 12]
  },
  "confidence": {
    "overall": 0.0_to_1.0,
    "vendor_name": 0.0_to_1.0,
    "total_amount": 0.0_to_1.0
  },
  "compliance": {
    "gst_applicable": true_or_false,
    "gst_rate": 0.10,
    "qbcc_applicable": true_or_false,
    "retention_applicable": true_or_false
  }
}"""

_COMMON_FOOTER = """\

Sustainability tags — use ONLY tags from this list when applicable:
renewable_energy, solar, wind, carbon_offset, recycled_materials, low_emissions,
green_building, water_conservation, waste_management, electric_vehicle,
sustainable_packaging, energy_efficiency, other_green

For Australian invoices: GST is 10 %. Flag qbcc_applicable if vendor/description
suggests building/construction work in Queensland. Flag retention_applicable if
the invoice mentions retention or progress claims.

OCR TEXT:
{ocr_text}
"""

# ── llm_augment (default — Gemini refines regex/GNN output) ─────────────────
_EXTRACTION_PROMPT = (
    "You are an expert invoice parser. Analyse the attached invoice image together "
    "with the OCR text provided below.\n\n"
    "Return ONLY valid JSON — no markdown, no explanation. "
    "The JSON must follow this exact schema:\n\n"
    + _BASE_SCHEMA
    + _COMMON_FOOTER
)

# ── llm_primary (low-quality / handwritten — trust Gemini over regex) ────────
_EXTRACTION_PROMPT_PRIMARY = (
    "You are an expert invoice parser working on a LOW-QUALITY or HANDWRITTEN document.\n"
    "The OCR text may contain errors, garbled characters, or missing words. "
    "Your visual analysis of the attached image is the PRIMARY source of truth — "
    "treat the OCR text as a rough guide only.\n\n"
    "Extract all fields as accurately as possible from the image. "
    "If the image and OCR disagree, prefer the image.\n\n"
    "Return ONLY valid JSON — no markdown, no explanation. "
    "The JSON must follow this exact schema:\n\n"
    + _BASE_SCHEMA
    + _COMMON_FOOTER
)

# ── fuel mode (fuel_statement — ask for fuel-specific fields) ────────────────
_EXTRACTION_PROMPT_FUEL = (
    "You are an expert invoice parser specialised in FUEL / BOWSER STATEMENTS.\n\n"
    "In addition to the standard invoice fields, extract these fuel-specific fields "
    "and include them in a top-level \"fuel_details\" object:\n\n"
    "{\n"
    '  "fuel_details": {\n'
    '    "litres": number_or_null,\n'
    '    "rate_per_litre": number_or_null,\n'
    '    "fuel_type": "diesel | petrol | unleaded | lpg | avgas | biodiesel | other | null",\n'
    '    "vehicle_rego": "string or null",\n'
    '    "odometer_km": number_or_null,\n'
    '    "pump_number": "string or null",\n'
    '    "card_number": "string or null"\n'
    "  }\n"
    "}\n\n"
    "Return ONLY valid JSON. The root object must contain both the standard fields "
    "AND fuel_details.\n\n"
    "Standard schema:\n\n"
    + _BASE_SCHEMA
    + _COMMON_FOOTER
)

# ── multi-page mode — Gemini resolves cross-page totals ─────────────────────
_EXTRACTION_PROMPT_MULTIPAGE = (
    "You are an expert invoice parser processing a MULTI-PAGE invoice.\n\n"
    "The OCR text below contains all pages concatenated with '\\n\\n' between pages. "
    "Pay special attention to:\n"
    "  • Totals, subtotals, and GST that may appear on a different page from line items.\n"
    "  • Header fields (vendor, invoice number, dates) that typically appear on page 1.\n"
    "  • Running totals or 'brought forward' figures across pages.\n\n"
    "Reconcile cross-page figures and return a single consolidated JSON record. "
    "Return ONLY valid JSON — no markdown, no explanation. "
    "The JSON must follow this exact schema:\n\n"
    + _BASE_SCHEMA
    + _COMMON_FOOTER
)


class LLMService:
    """Multimodal LLM invoice encoder using Gemini 2.5 Flash."""

    def __init__(self) -> None:
        self._model = None
        self._available = False
        self._init_model()

    @property
    def is_available(self) -> bool:
        return self._available

    def _init_model(self) -> None:
        if not _GENAI_AVAILABLE:
            return
        api_key = getattr(settings, "gemini_api_key", None)
        if not api_key:
            return
        try:
            genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel("gemini-2.5-flash")
            self._available = True
        except Exception as exc:
            print(f"[LLMService] Failed to initialise Gemini: {exc}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    # Maps doc_type_label → llm_mode for callers that only have the label
    DOC_TYPE_TO_MODE: Dict[str, str] = {
        "standard_structured":       "llm_augment",
        "multi_page":                "llm_multipage",
        "fuel_statement":            "llm_fuel",
        "low_quality_scanned":       "llm_primary",
        "handwritten_or_very_noisy": "llm_primary",
    }

    async def encode_invoice(
        self,
        image_path: Optional[str],
        ocr_text: str,
        word_boxes: Optional[List[Dict]] = None,
        invoice_id: Optional[str] = None,
        mode: str = "llm_augment",
    ) -> Dict[str, Any]:
        """
        Run multimodal LLM on invoice image + OCR text.

        Args:
            mode: one of
                "llm_augment"   – standard; Gemini refines regex/GNN (default)
                "llm_primary"   – low-quality/handwritten; trust Gemini over regex
                "llm_fuel"      – fuel statement; adds fuel-specific schema fields
                "llm_multipage" – multi-page; Gemini resolves cross-page totals
            invoice_id: optional — used to fetch correction shots for few-shot
                        adaptation (TRAIN_LLM → PIPELINE in the feedback loop).

        Returns:
            {
              fields: {vendor_name, invoice_number, invoice_date, ...},
              sustainability_tags: [...],
              layout_segments: {...},
              compliance: {...},
              confidence: {...},
              fuel_details: {...},   # only present for llm_fuel mode
              llm_mode: str,
              llm_prompt: str,
              llm_response_raw: str,
              skipped: bool,
              processing_time_ms: int,
            }
        """
        if not self._available:
            return self._empty_result(reason="LLM not configured (no GEMINI_API_KEY)")

        start = time.time()

        # Select prompt template based on mode
        _prompt_templates = {
            "llm_augment":   _EXTRACTION_PROMPT,
            "llm_primary":   _EXTRACTION_PROMPT_PRIMARY,
            "llm_fuel":      _EXTRACTION_PROMPT_FUEL,
            "llm_multipage": _EXTRACTION_PROMPT_MULTIPAGE,
        }
        base_template = _prompt_templates.get(mode, _EXTRACTION_PROMPT)

        # TRAIN_LLM adaptation: inject recent user corrections as few-shot context
        correction_shots = await self._get_correction_shots()
        base_prompt = base_template + correction_shots

        # Truncate OCR text — give multipage more room
        ocr_limit = 10000 if mode == "llm_multipage" else 6000
        prompt_text = base_prompt.replace("{ocr_text}", ocr_text[:ocr_limit])

        print(f"[LLMService] mode={mode} ocr_chars={len(ocr_text)} image={'yes' if image_path else 'no'}")

        try:
            parts: list = [prompt_text]

            # Attach image if available
            # For llm_primary mode, image is mandatory — emit a warning if missing
            if image_path and Path(image_path).exists():
                with open(image_path, "rb") as f:
                    img_bytes = f.read()
                ext = Path(image_path).suffix.lower().lstrip(".")
                mime = "image/png" if ext == "png" else "image/jpeg"
                parts.insert(0, {"mime_type": mime, "data": img_bytes})
            elif mode == "llm_primary":
                print("[LLMService] WARNING: llm_primary mode without image — OCR quality may be poor")

            response = self._model.generate_content(parts)
            raw_text = response.text.strip()

            parsed = self._parse_response(raw_text)
            elapsed = int((time.time() - start) * 1000)

            result = {
                "fields": self._extract_fields(parsed),
                "sustainability_tags": parsed.get("sustainability_tags", []),
                "layout_segments": parsed.get("layout_segments", {}),
                "compliance": parsed.get("compliance", {}),
                "confidence": parsed.get("confidence", {}),
                "line_items": parsed.get("line_items", []),
                "llm_mode": mode,
                "llm_prompt": prompt_text,
                "llm_response_raw": raw_text,
                "skipped": False,
                "processing_time_ms": elapsed,
            }

            # Fuel mode: surface fuel_details at top level for pipeline consumption
            if mode == "llm_fuel" and "fuel_details" in parsed:
                result["fuel_details"] = parsed["fuel_details"]

            return result

        except Exception as exc:
            print(f"[LLMService] Inference error (mode={mode}): {exc}")
            return self._empty_result(reason=str(exc))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _parse_response(self, raw: str) -> Dict[str, Any]:
        """Strip markdown fences and parse JSON."""
        text = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to extract first JSON object
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    pass
        return {}

    def _extract_fields(self, parsed: Dict[str, Any]) -> Dict[str, Any]:
        """Map LLM response to internal field format."""
        field_map = {
            "vendor_name": parsed.get("vendor_name"),
            "invoice_number": parsed.get("invoice_number"),
            "invoice_date": parsed.get("invoice_date"),
            "due_date": parsed.get("due_date"),
            "total_amount": parsed.get("total_amount"),
            "subtotal": parsed.get("subtotal"),
            "tax_amount": parsed.get("tax_amount"),
            "currency": parsed.get("currency", "AUD"),
        }
        confidence_map = parsed.get("confidence", {})
        result = {}
        for fname, val in field_map.items():
            if val is not None:
                result[fname] = {
                    "raw_value": str(val),
                    "normalized_value": str(val),
                    "confidence_score": float(
                        confidence_map.get(fname, confidence_map.get("overall", 0.9))
                    ),
                    "extraction_method": "llm",
                }
        return result

    # ------------------------------------------------------------------
    # TRAIN_LLM: few-shot adaptation from user corrections
    # ------------------------------------------------------------------

    async def _get_correction_shots(self, n_shots: int = 5) -> str:
        """
        Fetch recent user corrections from green_kpi.corrections and format
        them as few-shot examples appended to the Gemini prompt.

        This implements the TRAIN_LLM → PIPELINE feedback arc: corrections
        accumulate in the DB and are replayed to Gemini on every subsequent
        call, adapting its extraction behaviour without requiring LoRA weights.
        """
        try:
            from app.services.supabase_client import get_supabase_admin
            supabase = get_supabase_admin()

            rows = (
                supabase.schema("green_kpi")
                .table("corrections")
                .select("field_name, original_value, corrected_value")
                .eq("source", "user")
                .order("created_at", desc=True)
                .limit(40)
                .execute()
                .data or []
            )

            if not rows:
                return ""

            # Deduplicate and pick the n_shots most diverse examples
            seen: set = set()
            shots: List[str] = []
            for r in rows:
                key = (r["field_name"], r["original_value"])
                if key in seen:
                    continue
                seen.add(key)
                shots.append(
                    f'  {r["field_name"]}: was "{r["original_value"]}" → '
                    f'correct is "{r["corrected_value"]}"'
                )
                if len(shots) >= n_shots:
                    break

            if not shots:
                return ""

            return (
                "\n\nPREVIOUS CORRECTIONS — patterns learned from user feedback "
                "(apply these to improve accuracy):\n" + "\n".join(shots) + "\n"
            )

        except Exception:
            return ""  # corrections are non-critical; never block inference

    @staticmethod
    def _empty_result(reason: str = "") -> Dict[str, Any]:
        return {
            "fields": {},
            "sustainability_tags": [],
            "layout_segments": {},
            "compliance": {},
            "confidence": {},
            "line_items": [],
            "llm_prompt": None,
            "llm_response_raw": None,
            "skipped": True,
            "skip_reason": reason,
            "processing_time_ms": 0,
        }


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
