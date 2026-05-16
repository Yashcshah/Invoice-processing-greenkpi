"""
Document Type Classifier
========================
Rule-based pre-classifier that runs immediately after OCR and before the ML
cluster agent.  Assigns every invoice one of five doc_type labels so the
rest of the pipeline can adapt its strategy accordingly.

Labels
------
  standard_structured       Clean, single-page PDF — fast path (regex + agents + GNN).
  multi_page                Invoice spans more than one page — LLM weighted higher.
  fuel_statement            Contains fuel / bowser keywords — specialised extraction.
  low_quality_scanned       Low OCR confidence or TrOCR fallback was used — lean on LLM.
  handwritten_or_very_noisy Very low confidence + sparse content — LLM-only extraction.

Usage
-----
  from app.services.doc_type_classifier import classify_doc_type, InvoiceContext

  ctx = InvoiceContext(
      page_count=2,
      ocr_engine="tesseract",
      avg_ocr_confidence=0.82,
      ocr_text="...",
      line_item_count=5,
  )
  label = classify_doc_type(ctx)   # → "multi_page"
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Keyword lists
# ---------------------------------------------------------------------------

_FUEL_KEYWORDS = [
    "fuel", "diesel", "petrol", "unleaded", "litres", "l/100km",
    "bowser", "lpg", "pump price", "refuel", "fuel card",
    "fleet fuel", "bulk fuel", "avgas", "biodiesel",
]

_TABLE_STRUCTURE_PATTERNS = [
    r"\b(description|item|qty|quantity|unit price|amount|total)\b",
    r"\$\s*\d+[\d,]*\.?\d*",           # dollar amounts
    r"\d+\s*x\s*\$?\d+",               # "3 x $12.50"
]

_HANDWRITING_NOISE_INDICATORS = [
    r"[^\x00-\x7F]{3,}",               # 3+ consecutive non-ASCII chars
    r"[|}{\\]{2,}",                    # OCR garble characters
]

# Thresholds
_CONFIDENCE_LOW_QUALITY  = 0.60
_CONFIDENCE_HANDWRITTEN  = 0.40
_MIN_LINE_ITEMS_STRUCTURED = 1        # a structured doc usually has at least one line item
_MIN_TABLE_PATTERN_HITS  = 1          # at least one table-like pattern


# ---------------------------------------------------------------------------
# Context dataclass
# ---------------------------------------------------------------------------

@dataclass
class InvoiceContext:
    """All information available after OCR that the classifier needs."""
    page_count:          int            = 1
    ocr_engine:          str            = "tesseract"
    avg_ocr_confidence:  float          = 1.0
    ocr_text:            str            = ""
    line_item_count:     int            = 0
    word_box_count:      int            = 0     # number of word bounding boxes returned


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _contains_fuel_keywords(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in _FUEL_KEYWORDS)


def _has_table_structure(text: str) -> bool:
    """Return True if the text looks like it has a structured table."""
    hits = sum(
        1 for pat in _TABLE_STRUCTURE_PATTERNS
        if re.search(pat, text, re.IGNORECASE)
    )
    return hits >= _MIN_TABLE_PATTERN_HITS


def _looks_handwritten(ctx: InvoiceContext) -> bool:
    """
    Best-effort handwriting/noise detection.
    Triggers when confidence is very low AND content is sparse AND
    no clear table structure is found.
    """
    if ctx.avg_ocr_confidence >= _CONFIDENCE_HANDWRITTEN:
        return False

    # Sparse content: few word boxes and few line items
    sparse = ctx.word_box_count < 20 and ctx.line_item_count < 2

    # No recognisable table structure
    no_structure = not _has_table_structure(ctx.ocr_text)

    # Extra garble patterns
    garble_hits = sum(
        1 for pat in _HANDWRITING_NOISE_INDICATORS
        if re.search(pat, ctx.ocr_text)
    )

    return sparse and no_structure and garble_hits >= 1


# ---------------------------------------------------------------------------
# Main classifier
# ---------------------------------------------------------------------------

def classify_doc_type(ctx: InvoiceContext) -> str:
    """
    Classify an invoice into one of five doc-type labels.

    Priority order (first match wins):
      1. handwritten_or_very_noisy  — strictest confidence + sparseness check
      2. low_quality_scanned        — low confidence or TrOCR fallback
      3. fuel_statement             — fuel keyword match
      4. multi_page                 — page count > 1
      5. standard_structured        — default

    Returns one of:
      "standard_structured" | "multi_page" | "fuel_statement" |
      "low_quality_scanned" | "handwritten_or_very_noisy"
    """
    text = ctx.ocr_text or ""

    # 1. Handwritten / very noisy (checked first — subset of low quality)
    if _looks_handwritten(ctx):
        return "handwritten_or_very_noisy"

    # 2. Low quality / scanned (TrOCR was used OR confidence below threshold)
    is_low_quality = (
        ctx.avg_ocr_confidence < _CONFIDENCE_LOW_QUALITY
        or ctx.ocr_engine.lower() == "trocr"
    )
    if is_low_quality:
        return "low_quality_scanned"

    # 3. Fuel statement
    if _contains_fuel_keywords(text):
        return "fuel_statement"

    # 4. Multi-page
    if ctx.page_count > 1:
        return "multi_page"

    # 5. Default
    return "standard_structured"


# ---------------------------------------------------------------------------
# Processing strategy hints
# ---------------------------------------------------------------------------

# Maps each doc type to recommended pipeline behaviour.
# Used by processing.py to decide how hard to lean on LLM vs regex.
DOC_TYPE_STRATEGY: dict[str, dict] = {
    "standard_structured": {
        "description":   "Clean single-page PDF — fast path",
        "llm_priority":  "low",     # regex + agents + GNN first; LLM validates
        "gnn_priority":  "high",
        "ocr_fallback":  False,
    },
    "multi_page": {
        "description":   "Multi-page invoice — LLM weighted higher for cross-page fields",
        "llm_priority":  "high",    # LLM handles cross-page context better
        "gnn_priority":  "medium",
        "ocr_fallback":  False,
    },
    "fuel_statement": {
        "description":   "Fuel / bowser statement — specialised keyword extraction",
        "llm_priority":  "medium",
        "gnn_priority":  "medium",
        "ocr_fallback":  False,
    },
    "low_quality_scanned": {
        "description":   "Low-confidence OCR or TrOCR fallback — lean heavily on LLM",
        "llm_priority":  "high",
        "gnn_priority":  "low",     # GNN needs good word boxes; scanned = fewer boxes
        "ocr_fallback":  True,
    },
    "handwritten_or_very_noisy": {
        "description":   "Handwritten or very noisy — LLM-only extraction",
        "llm_priority":  "critical",
        "gnn_priority":  "skip",    # graph features unreliable on handwriting
        "ocr_fallback":  True,
    },
}


def get_strategy(doc_type: str) -> dict:
    """Return the processing strategy dict for a given doc_type label."""
    return DOC_TYPE_STRATEGY.get(doc_type, DOC_TYPE_STRATEGY["standard_structured"])
