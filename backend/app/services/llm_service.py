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


_EXTRACTION_PROMPT = """\
You are an expert invoice parser. Analyse the attached invoice image together with the OCR text provided below.

Return ONLY valid JSON — no markdown, no explanation. The JSON must follow this exact schema:

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
}

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

    async def encode_invoice(
        self,
        image_path: Optional[str],
        ocr_text: str,
        word_boxes: Optional[List[Dict]] = None,
        invoice_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run multimodal LLM on invoice image + OCR text.

        Args:
            invoice_id: optional — used to fetch correction shots for few-shot
                        adaptation (TRAIN_LLM → PIPELINE in the feedback loop).

        Returns:
            {
              fields: {vendor_name, invoice_number, invoice_date, ...},
              sustainability_tags: [...],
              layout_segments: {...},
              compliance: {...},
              confidence: {...},
              llm_prompt: str,
              llm_response_raw: str,
              skipped: bool,
              processing_time_ms: int,
            }
        """
        if not self._available:
            return self._empty_result(reason="LLM not configured (no GEMINI_API_KEY)")

        start = time.time()

        # TRAIN_LLM adaptation: inject recent user corrections as few-shot context
        correction_shots = await self._get_correction_shots()
        base_prompt = _EXTRACTION_PROMPT + correction_shots
        prompt_text = base_prompt.replace("{ocr_text}", ocr_text[:6000])

        try:
            parts: list = [prompt_text]

            # Attach image if available
            if image_path and Path(image_path).exists():
                with open(image_path, "rb") as f:
                    img_bytes = f.read()
                ext = Path(image_path).suffix.lower().lstrip(".")
                mime = "image/png" if ext == "png" else "image/jpeg"
                parts.insert(0, {"mime_type": mime, "data": img_bytes})

            response = self._model.generate_content(parts)
            raw_text = response.text.strip()

            parsed = self._parse_response(raw_text)
            elapsed = int((time.time() - start) * 1000)

            return {
                "fields": self._extract_fields(parsed),
                "sustainability_tags": parsed.get("sustainability_tags", []),
                "layout_segments": parsed.get("layout_segments", {}),
                "compliance": parsed.get("compliance", {}),
                "confidence": parsed.get("confidence", {}),
                "line_items": parsed.get("line_items", []),
                "llm_prompt": prompt_text,
                "llm_response_raw": raw_text,
                "skipped": False,
                "processing_time_ms": elapsed,
            }

        except Exception as exc:
            print(f"[LLMService] Inference error: {exc}")
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
