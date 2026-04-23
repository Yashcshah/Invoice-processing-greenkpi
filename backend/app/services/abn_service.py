"""
ABN + GST Registration Service
================================
Validates Australian Business Numbers (ABN) and checks GST registration
automatically during the invoice processing pipeline.

Two levels of checking, always in this order:

  1. Local checks (no network, always run):
       • ABN format  — 11 digits after stripping spaces/dashes
       • ABN checksum — standard weighted-digit algorithm (mod 89)
       • GST math    — tax_amount ≈ subtotal × 10 %  (±2 %)

  2. ABR API lookup (network, optional — only if ABR_GUID is set in .env):
       • Calls the free Australian Business Register JSON endpoint
       • Checks AbnStatus == "Active"
       • Checks Gst field is not empty (means GST-registered)

Results are returned as a dict that gets merged into green_kpi compliance_flags:

    {
      "abn_raw":            "12 345 678 901",   # as extracted
      "abn_normalised":     "12345678901",       # digits only
      "abn_format_valid":   True,
      "abn_checksum_valid": True,
      "abn_active":         True,                # None if API not called
      "abn_gst_registered": True,                # None if API not called
      "abn_entity_name":    "ACME PTY LTD",      # None if API not called
      "abn_checked_via_api": False,
      "gst_math_valid":     True,
      "gst_expected_tax":   45.00,
      "gst_actual_tax":     45.00,
    }
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.request
from typing import Any, Dict, Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
_GST_RATE    = 0.10
_GST_TOL     = 0.02   # ±2 % tolerance

_ABR_URL = (
    "https://abr.business.gov.au/json/AbnDetails.aspx"
    "?abn={abn}&callback=callback&guid={guid}"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise_abn(raw: str) -> Optional[str]:
    """Strip whitespace and dashes; return 11-digit string or None."""
    if not raw:
        return None
    digits = re.sub(r"[\s\-]", "", str(raw))
    return digits if len(digits) == 11 and digits.isdigit() else None


def _checksum_valid(abn: str) -> bool:
    """Return True if the 11-digit ABN passes the weighted mod-89 check."""
    digits = [int(c) for c in abn]
    digits[0] -= 1                          # subtract 1 from first digit
    total = sum(d * w for d, w in zip(digits, _ABN_WEIGHTS))
    return total % 89 == 0


def _gst_math_check(
    subtotal:   Optional[float],
    tax_amount: Optional[float],
    total_amount: Optional[float],
) -> Dict[str, Any]:
    """Check whether tax_amount is approximately 10 % of subtotal."""
    if subtotal is None or tax_amount is None:
        return {"gst_math_valid": None, "gst_expected_tax": None, "gst_actual_tax": None}

    expected = round(subtotal * _GST_RATE, 2)
    diff     = abs(tax_amount - expected)
    valid    = diff <= (_GST_TOL * expected + 0.01)   # 2 % + 1¢ grace

    return {
        "gst_math_valid":    valid,
        "gst_expected_tax":  expected,
        "gst_actual_tax":    round(tax_amount, 2),
    }


def _parse_abr_response(raw: str) -> Dict[str, Any]:
    """Parse the JSONP response from the ABR API."""
    # Strip JSONP wrapper:  callback({...})
    m = re.search(r"callback\s*\((.+)\)\s*;?\s*$", raw, re.DOTALL)
    if not m:
        raise ValueError(f"Unexpected ABR response format: {raw[:200]}")
    return json.loads(m.group(1))


async def _lookup_abr(abn: str, guid: str) -> Dict[str, Any]:
    """
    Call the ABR JSON endpoint.  Returns a dict with active/gst_registered/entity_name.
    Never raises — returns error info instead.
    """
    url = _ABR_URL.format(abn=abn, guid=guid)
    try:
        loop = asyncio.get_event_loop()
        raw  = await loop.run_in_executor(
            None,
            lambda: urllib.request.urlopen(url, timeout=5).read().decode("utf-8"),
        )
        data = _parse_abr_response(raw)

        if data.get("Message"):
            # ABR returned an error message (e.g. "Search text is not a valid ABN")
            return {
                "abn_active":         False,
                "abn_gst_registered": False,
                "abn_entity_name":    None,
                "abn_abr_message":    data["Message"],
            }

        active       = data.get("AbnStatus", "").lower() == "active"
        gst_date     = data.get("Gst", "")           # "" means NOT GST-registered
        gst_reg      = bool(gst_date and gst_date != "")
        entity_name  = data.get("EntityName") or (
            data.get("BusinessName", [{}])[0].get("OrganisationName") if data.get("BusinessName") else None
        )

        return {
            "abn_active":         active,
            "abn_gst_registered": gst_reg,
            "abn_entity_name":    entity_name,
            "abn_abr_message":    None,
        }

    except Exception as exc:
        return {
            "abn_active":         None,
            "abn_gst_registered": None,
            "abn_entity_name":    None,
            "abn_abr_message":    f"ABR lookup failed: {exc}",
        }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def run_abn_gst_check(extracted_fields: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main entry point called from the processing pipeline.

    Args:
        extracted_fields: the field dict as produced by extraction + LLM + GNN.
                          Each value is {"raw_value", "normalized_value", "confidence_score", ...}

    Returns:
        Compliance flag dict ready to be merged into green_kpi compliance_flags.
    """

    def _fval(fname: str) -> Optional[str]:
        f = extracted_fields.get(fname)
        return (f.get("normalized_value") or f.get("raw_value")) if f else None

    def _fnum(fname: str) -> Optional[float]:
        v = _fval(fname)
        if v is None:
            return None
        try:
            return float(str(v).replace(",", "").replace("$", "").strip())
        except (ValueError, TypeError):
            return None

    # --- Extract ABN ---
    abn_raw  = _fval("abn") or _fval("supplier_abn") or _fval("vendor_abn")
    abn_norm = _normalise_abn(abn_raw) if abn_raw else None

    result: Dict[str, Any] = {
        "abn_raw":            abn_raw,
        "abn_normalised":     abn_norm,
        "abn_format_valid":   abn_norm is not None,
        "abn_checksum_valid": _checksum_valid(abn_norm) if abn_norm else False,
        "abn_active":         None,
        "abn_gst_registered": None,
        "abn_entity_name":    None,
        "abn_checked_via_api": False,
        "abn_abr_message":    None,
    }

    # --- GST math check ---
    result.update(_gst_math_check(
        subtotal     = _fnum("subtotal"),
        tax_amount   = _fnum("tax_amount"),
        total_amount = _fnum("total_amount"),
    ))

    # --- ABR API lookup (only if GUID configured and ABN is valid) ---
    abr_guid = os.getenv("ABR_GUID", "").strip()
    if abr_guid and abn_norm and result["abn_format_valid"]:
        api_result = await _lookup_abr(abn_norm, abr_guid)
        result.update(api_result)
        result["abn_checked_via_api"] = True

    return result
