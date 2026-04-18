import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime


# ─────────────────────────────────────────────────────────────────────────────
# Label keywords used as COLUMN-BOUNDARY STOPS.
#
# When we've matched a label on the left and are walking right to collect its
# value, we must STOP as soon as we hit another known label keyword — that's
# the start of the next column / cell and anything beyond belongs to a
# different field.  This is what prevents
#     "Invoice Date: 05/03/2026  Restaurant"   (y-aligned across two boxes)
# from being concatenated into "05/03/2026 Restaurant".
# ─────────────────────────────────────────────────────────────────────────────

_LABEL_STOP_KEYWORDS: set = {
    "invoice",       # Invoice Date / Invoice ID / Invoice Number / Invoice No
    "id",
    "date",
    "due",
    "billing",       # Billing Period
    "period",
    "tariff",        # Tariff Type
    "customer",
    "site",
    "supply",
    "property",
    "meter",
    "abn",
    "account",
    "subtotal",
    "total",
    "gst",
    "vat",
    "tax",
    "amount",
    "charges",
    "description",
    "usage",
    "rate",
    "plan",
    "service",
}


class FieldExtractionService:
    """
    Row-aware + section-aware invoice field extractor.

    This revision hardens the extractor against the three most common failure
    modes seen on real-world bills:

      1. "Column bleed" — the row-label extractor used to greedily collect
         every box to the right of a label that shared its y-coordinate, even
         when those boxes belonged to an adjacent column.  It now stops at
         either a large horizontal gap or the next label keyword.

      2. "TOTAL matched Total Usage" — summary_label used to return the FIRST
         box whose text equals the label, so the label "TOTAL" would latch
         onto the "Total Usage" line-item row and return the wrong amount.
         It now (a) supports multi-word labels by walking consecutive aligned
         boxes, (b) ignores matches immediately followed by "usage", and
         (c) prefers the LOWEST-ON-PAGE match when multiple remain.

      3. "No line items" — header-row detection used to demand ≥3 exact
         matches of {description, usage, rate, amount} with very tight
         y-tolerance.  It now requires ≥2 with looser tolerance, and there's
         a new section-based fallback that recognises lines beneath a
         "Charges Summary" / "Electricity Usage Summary" heading.

    Plus a new positional fallback for Customer/Site/Address when those rows
    aren't explicitly labelled (common on Origin Energy bills).
    """

    def __init__(self):
        self.rules = self._load_default_rules()

    # ──────────────────────────────────────────────────────────────────────
    # DB rule loader (unchanged)
    # ──────────────────────────────────────────────────────────────────────

    def load_db_rules(self, cluster_id: Optional[int] = None) -> None:
        try:
            from app.services.supabase_client import get_supabase_admin
            supabase = get_supabase_admin()

            rows = (
                supabase.table("extraction_rules")
                .select("id, field_name, pattern, rule_type, priority, cluster_id, match_value")
                .eq("is_active", True)
                .order("priority", desc=True)
                .execute()
                .data or []
            )

            cluster_rows = [r for r in rows if r.get("cluster_id") == cluster_id and cluster_id is not None]
            global_rows  = [r for r in rows if r.get("cluster_id") is None]
            ordered = cluster_rows + global_rows

            db_rules: Dict[str, List[Dict]] = {}
            for row in ordered:
                fname = row["field_name"]
                db_rules.setdefault(fname, []).append({
                    "type":        row.get("rule_type", "regex"),
                    "pattern":     row.get("pattern", ""),
                    "match_value": row.get("match_value"),
                    "flags":       re.IGNORECASE,
                    "rule_id":     row["id"],
                    "cluster_id":  row.get("cluster_id"),
                })

            for fname, db_rule_list in db_rules.items():
                default_list = self.rules.get(fname, [])
                self.rules[fname] = db_rule_list + default_list

        except Exception as exc:
            print(f"[ExtractionService] Could not load DB rules: {exc}")

    # ──────────────────────────────────────────────────────────────────────
    # Default rules
    # ──────────────────────────────────────────────────────────────────────

    def _load_default_rules(self) -> Dict[str, List[Dict]]:
        return {
            "invoice_number": [
                {"type": "row_label", "labels": ["Invoice ID", "Invoice Number", "Invoice No", "Invoice #"]},
                {"type": "regex",
                 "pattern": r"(?:Invoice\s*(?:ID|Number|No|#)?)[\s:.\-]*([A-Z0-9][A-Z0-9\-_\/]{2,40})",
                 "flags": re.IGNORECASE},
            ],
            "invoice_date": [
                {"type": "row_label", "labels": ["Invoice Date", "Date", "Dated"]},
                {"type": "regex",
                 "pattern": r"(?:Invoice Date|Date|Dated)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                 "flags": re.IGNORECASE},
            ],
            "due_date": [
                {"type": "row_label", "labels": ["Due Date", "Payment Due", "Pay By", "Due"]},
                {"type": "regex",
                 "pattern": r"(?:Due Date|Payment Due|Pay By|Due)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                 "flags": re.IGNORECASE},
            ],
            "billing_period": [
                {"type": "row_label", "labels": ["Billing Period", "Service Period", "Period"]},
                {"type": "regex",
                 "pattern": r"(?:Billing Period|Service Period|Period)[\s:.\-]*((?:\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})\s*(?:to|-|–|—)\s*(?:\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}))",
                 "flags": re.IGNORECASE},
            ],
            "total_amount": [
                {"type": "summary_label",
                 "labels": ["TOTAL AMOUNT DUE", "Amount Due", "Grand Total", "Total Due", "Balance Due", "TOTAL"]},
                {"type": "regex",
                 "pattern": r"(?:TOTAL AMOUNT DUE|Amount Due|Grand Total|Total Due|Balance Due)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                 "flags": re.IGNORECASE},
            ],
            "subtotal": [
                {"type": "summary_label", "labels": ["Subtotal", "Sub-total", "Sub Total"]},
                {"type": "regex",
                 "pattern": r"(?:Subtotal|Sub-total|Sub Total)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                 "flags": re.IGNORECASE},
            ],
            "tax_amount": [
                {"type": "summary_label", "labels": ["GST (10%)", "GST", "VAT", "Sales Tax", "Tax"]},
                {"type": "regex",
                 "pattern": r"(?:GST(?:\s*\(10%\))?|VAT|Sales Tax|Tax)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                 "flags": re.IGNORECASE},
            ],
            "abn": [
                {"type": "regex",
                 "pattern": r"\bABN[\s:.\-]*([\d ]{8,20})",
                 "flags": re.IGNORECASE},
            ],
            "meter_id": [
                {"type": "row_label", "labels": ["Meter ID", "Meter", "NMI"]},
                {"type": "regex",
                 "pattern": r"(?:Meter\s*ID|Meter|NMI)[\s:.\-]*([A-Z0-9\-_]{4,40})",
                 "flags": re.IGNORECASE},
            ],
            "customer_name": [
                {"type": "row_label", "labels": ["Customer", "Account Name", "Bill To"]},
                {"type": "customer_site_section", "role": "customer"},
            ],
            "site_name": [
                {"type": "row_label", "labels": ["Site", "Property", "Premises", "Location"]},
                {"type": "customer_site_section", "role": "site"},
            ],
            "supply_address": [
                {"type": "row_label", "labels": ["Supply Address", "Address", "Service Address"]},
                {"type": "customer_site_section", "role": "address"},
            ],
            "tariff_type": [
                {"type": "row_label", "labels": ["Tariff Type", "Tariff", "Plan", "Plan Name", "Service Type"]},
                {"type": "regex",
                 "pattern": r"(?:Tariff Type|Tariff|Plan Name|Plan|Service Type)[\s:.\-]*([A-Za-z][A-Za-z\s]{2,60})",
                 "flags": re.IGNORECASE},
            ],
            "vendor_name": [
                {"type": "vendor_top"},
            ],
            "email": [
                {"type": "regex",
                 "pattern": r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})",
                 "flags": 0},
            ],
            "phone": [
                {"type": "regex",
                 "pattern": r"(?:Tel|Phone|Ph|Mobile)[\s:.\-]*([+]?\d[\d\s\-().]{7,20})",
                 "flags": re.IGNORECASE},
            ],
        }

    # ──────────────────────────────────────────────────────────────────────
    # Entry points
    # ──────────────────────────────────────────────────────────────────────

    def extract_fields(self, text: str, word_boxes: List[Dict] = None) -> Dict[str, Any]:
        results: Dict[str, Any] = {}
        clean_text = self._clean_text(text)
        lines = self._get_text_lines(clean_text, word_boxes)

        for field_name, rules in self.rules.items():
            result = self._extract_field(field_name, clean_text, lines, rules, word_boxes)
            if result:
                results[field_name] = result

        return results

    def _extract_field(
        self,
        field_name: str,
        text: str,
        lines: List[str],
        rules: List[Dict],
        word_boxes: List[Dict] = None,
    ) -> Optional[Dict[str, Any]]:

        for rule in rules:
            rule_id = rule.get("rule_id")

            match_val = rule.get("match_value")
            if match_val and match_val.strip() and match_val.strip() in text:
                return {
                    "raw_value":         match_val.strip(),
                    "normalized_value":  self._normalize_value(field_name, match_val.strip()),
                    "confidence_score":  0.92,
                    "extraction_method": "cluster_rule",
                    "rule_id":           rule_id,
                }

            if rule["type"] == "row_label":
                value = self._extract_from_same_row_box(word_boxes, rule["labels"], field_name)
                if not value:
                    value = self._extract_label_value_from_lines(lines, rule["labels"], field_name)
                if value:
                    return self._pack_result(field_name, value, "row_label", 0.93, rule_id)

            elif rule["type"] == "summary_label":
                value = self._extract_summary_value(word_boxes, lines, rule["labels"], field_name)
                if value:
                    return self._pack_result(field_name, value, "summary_label", 0.93, rule_id)

            elif rule["type"] == "regex":
                value = self._apply_regex_rule(text, rule, field_name)
                if value:
                    return self._pack_result(field_name, value, "regex", 0.82, rule_id)

            elif rule["type"] == "vendor_top":
                value = self._extract_vendor_name(text, word_boxes)
                if value:
                    return self._pack_result(field_name, value, "vendor_top", 0.75, rule_id)

            elif rule["type"] == "customer_site_section":
                value = self._extract_customer_site_section(word_boxes, lines, rule.get("role", "customer"))
                if value:
                    return self._pack_result(field_name, value, "section_positional", 0.72, rule_id)

            elif rule["type"] == "position":
                if rule.get("region") == "top" and word_boxes:
                    result = self._extract_from_top(word_boxes, rule.get("max_lines", 3))
                    if result:
                        return {
                            "raw_value":         result,
                            "normalized_value":  result,
                            "confidence_score":  0.60,
                            "extraction_method": "position_based",
                            "rule_id":           rule_id,
                        }

        return None

    def _pack_result(self, field_name, value, method, confidence, rule_id=None):
        return {
            "raw_value":         value,
            "normalized_value":  self._normalize_value(field_name, value),
            "confidence_score":  confidence,
            "extraction_method": method,
            "rule_id":           rule_id,
        }

    # ──────────────────────────────────────────────────────────────────────
    # Box normalisation helpers
    # ──────────────────────────────────────────────────────────────────────

    def _normalize_boxes(self, word_boxes: List[Dict]) -> List[Dict]:
        if not word_boxes:
            return []
        out = []
        for b in word_boxes:
            text = self._clean_inline_value(str(b.get("text", "")))
            if not text:
                continue
            x = float(b.get("x", b.get("left", 0)))
            y = float(b.get("y", b.get("top", 0)))
            w = float(b.get("width", b.get("w", 0)))
            h = float(b.get("height", b.get("h", 0)))
            out.append({
                "text": text,
                "x1": x, "y1": y, "x2": x + w, "y2": y + h,
                "w": w, "h": h,
                "cx": x + w / 2, "cy": y + h / 2,
                "line_num": b.get("line_num", 0),
                "block_num": b.get("block_num", 0),
            })
        return out

    def _median_box_width(self, boxes: List[Dict]) -> float:
        widths = sorted(b["w"] for b in boxes if b["w"] > 0)
        if not widths:
            return 10.0
        return widths[len(widths) // 2]

    def _boxes_in_row(self, boxes: List[Dict], target_y: float, height_hint: float) -> List[Dict]:
        tol = max(8, height_hint * 0.9)
        return [b for b in boxes if abs(b["cy"] - target_y) <= tol]

    # ──────────────────────────────────────────────────────────────────────
    # Column-gap-aware row collection
    #
    # Given a sequence of boxes AFTER a matched label (sorted left-to-right),
    # collect consecutive ones until we hit either:
    #   (a) a large horizontal gap (column boundary), or
    #   (b) a known label keyword (another field's header).
    # ──────────────────────────────────────────────────────────────────────

    def _collect_value_boxes(
        self,
        candidates: List[Dict],
        median_w: float,
        stop_at_labels: bool = True,
    ) -> List[Dict]:
        if not candidates:
            return []

        gap_threshold = max(median_w * 2.2, 25.0)
        collected: List[Dict] = []

        for i, b in enumerate(candidates):
            if stop_at_labels and self._is_label_keyword(b["text"]):
                break
            if collected:
                prev = collected[-1]
                gap = b["x1"] - prev["x2"]
                if gap > gap_threshold:
                    break
            collected.append(b)

        return collected

    def _is_label_keyword(self, text: str) -> bool:
        if not text:
            return False
        first_word = re.split(r"\s+", text.lower().strip(":.- "))[0]
        return first_word in _LABEL_STOP_KEYWORDS

    # ──────────────────────────────────────────────────────────────────────
    # Row-label extraction (now column-aware)
    # ──────────────────────────────────────────────────────────────────────

    def _match_label_boxes(self, boxes: List[Dict], label: str) -> List[Dict]:
        """
        Find all starting-box matches for a label, supporting multi-word
        labels by walking consecutive aligned boxes.

        Returns list of dicts with {"start": first_box, "end_x": last_x2,
        "y": cy, "h": h}.  A multi-word label like "Invoice Date" will match
        a pair of adjacent boxes on the same row whose combined text is
        "Invoice Date".
        """
        label_tokens = label.lower().split()
        if not label_tokens:
            return []

        matches = []
        for i, b in enumerate(boxes):
            if b["text"].lower() != label_tokens[0]:
                continue

            if len(label_tokens) == 1:
                matches.append({"start": b, "end_x": b["x2"], "y": b["cy"], "h": b["h"]})
                continue

            # multi-word: walk forward along the same y-row, left-to-right
            tol = max(8, b["h"] * 0.9)
            same_row = sorted(
                [x for x in boxes if abs(x["cy"] - b["cy"]) <= tol and x["x1"] >= b["x1"]],
                key=lambda x: x["x1"],
            )
            try:
                start_idx = same_row.index(b)
            except ValueError:
                continue

            collected = [b]
            ok = True
            for j, tok in enumerate(label_tokens[1:], start=1):
                nxt_idx = start_idx + j
                if nxt_idx >= len(same_row):
                    ok = False
                    break
                if same_row[nxt_idx]["text"].lower() != tok:
                    ok = False
                    break
                collected.append(same_row[nxt_idx])
            if ok:
                matches.append({
                    "start": collected[0],
                    "end_x": collected[-1]["x2"],
                    "y":     collected[0]["cy"],
                    "h":     collected[0]["h"],
                })

        return matches

    def _extract_from_same_row_box(
        self,
        word_boxes: List[Dict],
        labels: List[str],
        field_name: str,
    ) -> Optional[str]:
        boxes = self._normalize_boxes(word_boxes)
        if not boxes:
            return None

        median_w = self._median_box_width(boxes)

        for label in labels:
            for m in self._match_label_boxes(boxes, label):
                same_row_right = [
                    x for x in boxes
                    if x["x1"] > m["end_x"]
                    and abs(x["cy"] - m["y"]) <= max(8, m["h"] * 0.9)
                ]
                same_row_right.sort(key=lambda b: b["x1"])

                value_boxes = self._collect_value_boxes(
                    same_row_right,
                    median_w,
                    stop_at_labels=True,
                )
                # strip leading separator-only boxes
                while value_boxes and value_boxes[0]["text"] in {":", "-", "–", "—", "/", "|"}:
                    value_boxes = value_boxes[1:]
                if not value_boxes:
                    continue

                # for non-address fields with a likely short value, don't span
                # too wide: if the collected boxes span > 45% of page width,
                # trim to the first few
                page_width = max(b["x2"] for b in boxes) if boxes else 1
                span = value_boxes[-1]["x2"] - value_boxes[0]["x1"]
                if field_name not in {"supply_address"} and span > page_width * 0.45:
                    value_boxes = value_boxes[: max(3, len(value_boxes) // 2)]

                value = self._clean_inline_value(" ".join(b["text"] for b in value_boxes))
                if self._is_valid_field_value(value, field_name):
                    return value

        return None

    # ──────────────────────────────────────────────────────────────────────
    # Label+value from text lines (fallback)
    # ──────────────────────────────────────────────────────────────────────

    def _extract_label_value_from_lines(
        self,
        lines: List[str],
        labels: List[str],
        field_name: str,
    ) -> Optional[str]:
        for i, line in enumerate(lines):
            clean_line = self._clean_inline_value(line)

            for label in labels:
                m = re.match(rf"^{re.escape(label)}\s*[:.\-]?\s+(.+)$", clean_line, flags=re.IGNORECASE)
                if m:
                    value = self._clean_inline_value(m.group(1))
                    # strip trailing "next label …" tail
                    value = self._strip_trailing_label(value)
                    if self._is_valid_field_value(value, field_name):
                        return value

                if clean_line.lower() == label.lower():
                    for j in range(i + 1, min(i + 4, len(lines))):
                        candidate = self._clean_inline_value(lines[j])
                        if self._is_valid_field_value(candidate, field_name):
                            return candidate

        return None

    def _strip_trailing_label(self, value: str) -> str:
        """Cut the value off at the first occurrence of a label keyword
        that appears as a word boundary inside it.  Protects the line-based
        fallback against the same bleed the box-based path now handles."""
        if not value:
            return value
        # capture up to (but not including) a label-like word that isn't the start
        tokens = value.split()
        for i in range(1, len(tokens)):
            first = tokens[i].lower().strip(":.- ")
            if first in _LABEL_STOP_KEYWORDS:
                return " ".join(tokens[:i]).strip()
        return value

    # ──────────────────────────────────────────────────────────────────────
    # Summary-label extraction (multi-word aware, line-item aware,
    # prefers bottom-most match)
    # ──────────────────────────────────────────────────────────────────────

    def _extract_summary_value(
        self,
        word_boxes: List[Dict],
        lines: List[str],
        labels: List[str],
        field_name: str,
    ) -> Optional[str]:
        boxes = self._normalize_boxes(word_boxes)
        money_pattern = re.compile(r"\$?\d[\d,]*(?:\.\d{2})?")

        if boxes:
            # Find line-item section so we can ignore matches inside it
            line_items_top, line_items_bottom = self._line_items_y_range(boxes)

            # Try labels in order (most specific first).  For each label,
            # collect ALL matching boxes, filter out those inside the
            # line-items section, then pick the LOWEST on page.
            for label in labels:
                matches = self._match_label_boxes(boxes, label)
                if not matches:
                    continue

                # Ignore matches immediately followed by "usage" / "charges"
                # — those belong to row descriptions like "Total Usage".
                filtered = []
                for m in matches:
                    # Skip if inside the line-items table
                    if line_items_top is not None and line_items_bottom is not None:
                        if line_items_top < m["y"] < line_items_bottom:
                            continue
                    # Skip if the next right-side box is "Usage" / "Charges"
                    tol = max(8, m["h"] * 0.9)
                    right = sorted(
                        [b for b in boxes if b["x1"] > m["end_x"] and abs(b["cy"] - m["y"]) <= tol],
                        key=lambda b: b["x1"],
                    )
                    if right and right[0]["text"].lower() in {"usage", "charges"}:
                        continue
                    filtered.append(m)

                if not filtered:
                    continue

                # Prefer the lowest-on-page match (summary is near the bottom)
                filtered.sort(key=lambda m: m["y"], reverse=True)
                best = filtered[0]

                tol = max(8, best["h"] * 0.9)
                row_right = sorted(
                    [b for b in boxes if b["x1"] > best["end_x"] and abs(b["cy"] - best["y"]) <= tol],
                    key=lambda b: b["x1"],
                )
                row_text = " ".join(b["text"] for b in row_right)
                amounts = money_pattern.findall(row_text)
                if amounts:
                    return amounts[-1]

        # Line fallback (same as before, but skip line-item section)
        in_line_items = False
        for line in lines:
            lower = line.lower()
            if any(h in lower for h in ["charges summary", "usage summary", "consumption charges"]):
                in_line_items = True
                continue
            if any(h in lower for h in ["subtotal", "total amount due", "amount due", "grand total"]):
                in_line_items = False
            if in_line_items:
                continue

            if any(label.lower() in lower for label in labels):
                amounts = money_pattern.findall(line)
                if amounts:
                    return amounts[-1]

        return None

    def _line_items_y_range(self, boxes: List[Dict]) -> Tuple[Optional[float], Optional[float]]:
        """Return (top_y, bottom_y) of the line-item table so we can exclude
        stray "Total"/"Usage" labels inside it from summary extraction."""
        if not boxes:
            return (None, None)

        # top = Description header row
        top_y = None
        for b in boxes:
            if b["text"].lower() == "description":
                # header row confirmed if at least one other header keyword
                # appears on the same row
                tol = max(8, b["h"] * 0.9)
                same = [x for x in boxes if abs(x["cy"] - b["cy"]) <= tol and x["text"].lower() in {"usage", "rate", "amount"}]
                if len(same) >= 1:
                    top_y = b["cy"]
                    break

        # bottom = first summary label (Subtotal / TOTAL AMOUNT DUE etc.)
        bottom_y = None
        if top_y is not None:
            summary_tokens = {"subtotal", "gst", "vat"}
            candidates = [b["cy"] for b in boxes
                          if b["cy"] > top_y and b["text"].lower() in summary_tokens]
            if candidates:
                bottom_y = min(candidates) - 2

        return (top_y, bottom_y)

    # ──────────────────────────────────────────────────────────────────────
    # Unlabeled Customer/Site Details section fallback
    # ──────────────────────────────────────────────────────────────────────

    def _extract_customer_site_section(
        self,
        word_boxes: List[Dict],
        lines: List[str],
        role: str,
    ) -> Optional[str]:
        """
        Many bills (Origin, AGL, etc.) show Customer/Site/Address as
        UNLABELLED rows underneath a section header like
        'Customer / Site Details'.

        This fallback finds that header, grabs the rows beneath it within
        the same column, and assigns them positionally:

          row 0 (not addressy, not tariff)   → customer
          row 1 (not addressy, not tariff)   → site
          row with address tokens            → address
        """
        boxes = self._normalize_boxes(word_boxes)
        if not boxes:
            return self._extract_customer_site_from_lines(lines, role)

        # 1. Find the header box(es).  Accept any of these phrases.
        header_phrases = [
            ["customer", "/", "site", "details"],
            ["customer", "site", "details"],
            ["customer", "&", "site", "information"],
            ["customer", "site", "information"],
            ["site", "details"],
            ["customer", "details"],
        ]

        header_box = None
        for phrase in header_phrases:
            for i, b in enumerate(boxes):
                if b["text"].lower() != phrase[0]:
                    continue
                tol = max(8, b["h"] * 0.9)
                same_row = sorted(
                    [x for x in boxes if abs(x["cy"] - b["cy"]) <= tol and x["x1"] >= b["x1"]],
                    key=lambda x: x["x1"],
                )
                try:
                    idx = same_row.index(b)
                except ValueError:
                    continue
                toks = [x["text"].lower() for x in same_row[idx: idx + len(phrase)]]
                if toks == phrase:
                    header_box = {
                        "x1": b["x1"],
                        "x2": same_row[idx + len(phrase) - 1]["x2"],
                        "y":  b["cy"],
                        "h":  b["h"],
                    }
                    break
            if header_box:
                break

        if not header_box:
            return self._extract_customer_site_from_lines(lines, role)

        # 2. Collect boxes beneath the header, within its column width.
        col_left = header_box["x1"] - 5
        col_right = max(header_box["x2"], header_box["x1"] + 200)  # at least some width
        # extend right edge to include wider section box
        below_sample = [b for b in boxes if b["cy"] > header_box["y"] + header_box["h"] * 0.5]
        if below_sample:
            col_right = max(col_right, max(b["x2"] for b in below_sample if abs(b["x1"] - header_box["x1"]) < 400))

        # 3. Group boxes below header into y-rows.
        below = [b for b in boxes
                 if b["cy"] > header_box["y"] + header_box["h"] * 0.5
                 and col_left - 10 <= b["x1"] <= col_right + 10]
        below.sort(key=lambda b: (b["cy"], b["x1"]))

        rows: List[List[Dict]] = []
        cur_row: List[Dict] = []
        cur_y: Optional[float] = None
        for b in below:
            if cur_y is None or abs(b["cy"] - cur_y) <= max(8, b["h"] * 0.9):
                cur_row.append(b)
                cur_y = b["cy"] if cur_y is None else (cur_y + b["cy"]) / 2
            else:
                if cur_row:
                    rows.append(cur_row)
                cur_row = [b]
                cur_y = b["cy"]
        if cur_row:
            rows.append(cur_row)

        # 4. Stop at next section header.
        stop_tokens = {"electricity", "gas", "water", "charges", "usage", "subtotal", "gst", "total"}
        truncated: List[List[Dict]] = []
        for row in rows:
            first_tok = row[0]["text"].lower() if row else ""
            if first_tok in stop_tokens:
                break
            truncated.append(row)
        rows = truncated[:6]  # safety cap

        # 5. Classify rows.
        classified = {"customer": None, "site": None, "address": None, "tariff": None}
        for row in rows:
            text = self._clean_inline_value(" ".join(b["text"] for b in row))
            if not text:
                continue
            lower = text.lower()

            if lower.startswith("tariff") or lower.startswith("plan") or lower.startswith("service type"):
                # Handle "Tariff Type: General Business"
                m = re.match(r"(?:tariff(?:\s*type)?|plan(?:\s*name)?|service\s*type)\s*[:\-]?\s*(.+)$",
                             text, flags=re.IGNORECASE)
                if m:
                    classified["tariff"] = m.group(1).strip()
                continue

            if self._looks_like_address(text):
                if classified["address"] is None:
                    classified["address"] = text
                continue

            # otherwise it's a name-line; first goes to customer, next to site
            if classified["customer"] is None:
                classified["customer"] = text
            elif classified["site"] is None:
                classified["site"] = text

        return classified.get(role)

    def _extract_customer_site_from_lines(self, lines: List[str], role: str) -> Optional[str]:
        """Text-only fallback: find header line, take the next 3 non-empty lines."""
        header_idx = None
        for i, line in enumerate(lines):
            lower = line.lower()
            if any(p in lower for p in [
                "customer / site details",
                "customer site details",
                "customer & site information",
                "customer site information",
            ]):
                header_idx = i
                break
        if header_idx is None:
            return None

        candidates = []
        for j in range(header_idx + 1, min(header_idx + 6, len(lines))):
            candidate = self._clean_inline_value(lines[j])
            if not candidate:
                continue
            low = candidate.lower()
            if any(stop in low for stop in ["electricity", "gas", "water", "charges", "subtotal", "gst", "total"]):
                break
            candidates.append(candidate)

        classified = {"customer": None, "site": None, "address": None, "tariff": None}
        for text in candidates:
            lower = text.lower()
            if lower.startswith("tariff") or lower.startswith("plan") or lower.startswith("service type"):
                m = re.match(r"(?:tariff(?:\s*type)?|plan(?:\s*name)?|service\s*type)\s*[:\-]?\s*(.+)$",
                             text, flags=re.IGNORECASE)
                if m:
                    classified["tariff"] = m.group(1).strip()
                continue
            if self._looks_like_address(text):
                if classified["address"] is None:
                    classified["address"] = text
                continue
            if classified["customer"] is None:
                classified["customer"] = text
            elif classified["site"] is None:
                classified["site"] = text

        return classified.get(role)

    # ──────────────────────────────────────────────────────────────────────
    # Regex + vendor_top + top-of-doc (unchanged except for light cleanup)
    # ──────────────────────────────────────────────────────────────────────

    def _apply_regex_rule(self, text: str, rule: Dict, field_name: str = "") -> Optional[str]:
        match = re.search(rule["pattern"], text, rule.get("flags", 0))
        if not match:
            return None

        value = match.group(1) if match.groups() else match.group(0)
        value = self._clean_inline_value(value)
        value = self._strip_trailing_label(value)

        if not value:
            return None

        if field_name in {"customer_name", "site_name", "supply_address", "tariff_type"}:
            if self._looks_like_header_noise(value):
                return None

        if field_name == "invoice_number" and self._looks_like_bad_invoice_number(value):
            return None

        return value

    def _extract_vendor_name(self, text: str, word_boxes: List[Dict] = None) -> Optional[str]:
        lines = self._get_text_lines(text, word_boxes)
        if not lines:
            return None

        top_lines = lines[:10]
        candidates = []

        for idx, line in enumerate(top_lines):
            cleaned = self._clean_inline_value(line)
            if not cleaned:
                continue
            if self._looks_like_header_noise(cleaned):
                continue
            if self._looks_like_address(cleaned):
                continue

            score = 0
            if idx == 0:
                score += 3
            elif idx == 1:
                score += 2

            if re.search(
                r"\b(pty ltd|limited|ltd|inc|llc|group|services|energy|water|gas|electric|origin|agl)\b",
                cleaned, re.IGNORECASE,
            ):
                score += 4

            if 3 <= len(cleaned) <= 60:
                score += 2

            if re.search(r"\d{2,}", cleaned):
                score -= 2

            candidates.append((score, cleaned))

        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0], reverse=True)
        best_score, best_value = candidates[0]
        return best_value if best_score >= 2 else None

    def _extract_from_top(self, word_boxes: List[Dict], max_lines: int = 3) -> Optional[str]:
        boxes = self._normalize_boxes(word_boxes)
        if not boxes:
            return None
        sorted_boxes = sorted(boxes, key=lambda b: b["y1"])
        top_y = sorted_boxes[0]["y1"]
        line_h = sorted_boxes[0]["h"] or 12
        cutoff = top_y + line_h * max_lines
        top_boxes = [b for b in sorted_boxes if b["y1"] <= cutoff]
        text = " ".join(b["text"] for b in top_boxes)
        return self._clean_inline_value(text) or None

    # ──────────────────────────────────────────────────────────────────────
    # Validation / noise detection
    # ──────────────────────────────────────────────────────────────────────

    def _looks_like_header_noise(self, value: str) -> bool:
        lower = value.lower()
        bad_patterns = [
            "invoice details", "property details", "customer / site details",
            "customer site details", "customer & site information",
            "customer site information", "site details",
            "water charges summary", "gas consumption charges",
            "electricity usage summary", "electricity usage charges",
            "amount due", "subtotal", "total amount due",
            "billing period", "invoice date", "due date",
            "description", "account number", "meter id", "invoice id", "abn:",
        ]
        if any(p in lower for p in bad_patterns):
            return True
        return len(value) > 140

    def _looks_like_address(self, value: str) -> bool:
        return bool(
            re.search(
                r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|"
                r"vic|nsw|qld|wa|sa|tas|nt|act)\b\s*(?:\d{4})?",
                value, re.IGNORECASE,
            )
        ) or bool(re.search(r"\b\d{4}\b", value) and re.search(r"\b(vic|nsw|qld|wa|sa|tas|nt|act)\b",
                                                                value, re.IGNORECASE))

    def _looks_like_bad_invoice_number(self, value: str) -> bool:
        lower = value.lower()
        if lower in {"invoice", "inv", "number", "id", "oice"}:
            return True
        return len(value) < 3

    def _is_valid_field_value(self, value: str, field_name: str) -> bool:
        if not value:
            return False
        if self._looks_like_header_noise(value):
            return False
        lower = value.lower()
        if lower in {"customer", "site", "address", "meter id", "invoice id", "details"}:
            return False
        if field_name == "supply_address":
            return len(value) >= 8
        if field_name == "meter_id":
            return bool(re.search(r"[A-Z0-9]", value, re.IGNORECASE))
        return len(value) >= 2

    # ──────────────────────────────────────────────────────────────────────
    # Text helpers
    # ──────────────────────────────────────────────────────────────────────

    def _clean_text(self, text: str) -> str:
        if not text:
            return ""
        text = text.replace("\r", "\n")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _clean_inline_value(self, value: str) -> str:
        if not value:
            return ""
        return re.sub(r"\s+", " ", value).strip(" :-\t")

    def _get_text_lines(self, text: str, word_boxes: List[Dict] = None) -> List[str]:
        if word_boxes:
            try:
                sorted_boxes = sorted(
                    word_boxes,
                    key=lambda x: (x.get("block_num", 0), x.get("line_num", 0), x.get("x", 0)),
                )
                lines = {}
                for box in sorted_boxes:
                    key = (box.get("block_num", 0), box.get("line_num", 0))
                    lines.setdefault(key, []).append(box.get("text", ""))
                result = []
                for key in sorted(lines.keys()):
                    line = self._clean_inline_value(" ".join(lines[key]))
                    if line:
                        result.append(line)
                if result:
                    return result
            except Exception:
                pass
        return [self._clean_inline_value(line) for line in text.splitlines()
                if self._clean_inline_value(line)]

    # ──────────────────────────────────────────────────────────────────────
    # Normalisation
    # ──────────────────────────────────────────────────────────────────────

    def _normalize_value(self, field_name: str, value: str) -> str:
        if not value:
            return value
        if field_name in ["invoice_date", "due_date"]:
            return self._normalize_date(value)
        if field_name in ["total_amount", "subtotal", "tax_amount"]:
            return self._normalize_currency(value)
        if field_name == "abn":
            return re.sub(r"\s+", " ", value).strip()
        return value.strip()

    def _normalize_date(self, value: str) -> str:
        value = value.strip()
        # If the value still has trailing garbage, keep only the date portion
        m = re.search(r"\b(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})\b", value)
        if m:
            value = m.group(1)
        formats = [
            "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d",
            "%d-%m-%Y", "%m-%d-%Y", "%Y-%m-%d",
            "%d.%m.%Y", "%m.%d.%Y", "%Y.%m.%d",
            "%d/%m/%y", "%m/%d/%y",
        ]
        for fmt in formats:
            try:
                dt = datetime.strptime(value, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return value

    def _normalize_currency(self, value: str) -> str:
        cleaned = re.sub(r"[$€£,\s]", "", value)
        try:
            return f"{float(cleaned):.2f}"
        except ValueError:
            return value

    # ──────────────────────────────────────────────────────────────────────
    # Line items
    # ──────────────────────────────────────────────────────────────────────

    def extract_line_items(self, text: str, word_boxes: List[Dict] = None) -> List[Dict]:
        if word_boxes:
            items = self._extract_line_items_from_boxes(word_boxes)
            if items:
                return items
        return self._extract_line_items_from_lines(text, word_boxes)

    def _extract_line_items_from_boxes(self, word_boxes: List[Dict]) -> List[Dict]:
        boxes = self._normalize_boxes(word_boxes)
        if not boxes:
            return []

        header_keywords = {"description", "usage", "rate", "amount"}
        header_row_y = None
        header_row_h = 12.0

        # Looser header detection: accept the row with ≥2 header keywords,
        # with a more forgiving y-tolerance.
        for b in boxes:
            if b["text"].lower() not in header_keywords:
                continue
            tol = max(14, b["h"] * 1.2)
            same_row = [
                x for x in boxes
                if abs(x["cy"] - b["cy"]) <= tol
                and x["text"].lower() in header_keywords
            ]
            if len({x["text"].lower() for x in same_row}) >= 2:
                header_row_y = b["cy"]
                header_row_h = b["h"]
                break

        if header_row_y is None:
            return []

        stop_words = {"subtotal", "gst", "total amount due"}
        rows: Dict[float, List[Dict]] = {}
        row_tol = max(10, header_row_h * 1.1)

        for b in boxes:
            if b["cy"] <= header_row_y + header_row_h * 0.6:
                continue
            lower = b["text"].lower()
            # stop when we hit the summary section
            if any(sw == lower for sw in stop_words):
                break

            matched_key = None
            for key in rows:
                if abs(key - b["cy"]) <= row_tol:
                    matched_key = key
                    break
            if matched_key is None:
                rows[b["cy"]] = [b]
            else:
                rows[matched_key].append(b)

        parsed = []
        for _, row_boxes in sorted(rows.items(), key=lambda kv: kv[0]):
            row_boxes.sort(key=lambda b: b["x1"])
            row_text = self._clean_inline_value(" ".join(b["text"] for b in row_boxes))
            lower = row_text.lower()
            if not row_text:
                continue
            if any(x == lower for x in ["description usage rate amount", "description usage rate"]):
                continue

            parsed_row = self._parse_line_item_row(row_text, len(parsed) + 1, method="box_table")
            if parsed_row:
                parsed.append(parsed_row)

        return parsed

    def _extract_line_items_from_lines(self, text: str, word_boxes: List[Dict] = None) -> List[Dict]:
        lines = self._get_text_lines(text, word_boxes)
        line_items: List[Dict] = []

        section_start = None
        section_end = None

        for i, line in enumerate(lines):
            lower = line.lower()
            if any(x in lower for x in [
                "gas consumption charges", "electricity usage summary",
                "electricity usage charges", "water consumption charges",
                "water charges", "charges summary",
            ]):
                section_start = i
                break

        search_lines = lines if section_start is None else lines[section_start:]

        if section_start is not None:
            for i, line in enumerate(search_lines):
                lower = line.lower()
                if any(x in lower for x in ["subtotal", "gst", "amount due", "total amount due"]):
                    section_end = i
                    break
            if section_end is not None:
                search_lines = search_lines[:section_end]

        for line in search_lines:
            clean = self._clean_inline_value(line)
            lower = clean.lower()

            if any(token in lower for token in [
                "description", "invoice", "billing period",
                "customer", "address", "meter id", "abn",
            ]):
                continue
            if lower.startswith("subtotal") or lower.startswith("gst") or lower.startswith("total amount"):
                continue

            parsed_row = self._parse_line_item_row(clean, len(line_items) + 1, method="line_regex")
            if parsed_row:
                line_items.append(parsed_row)

        return line_items

    def _parse_line_item_row(self, row_text: str, line_number: int, method: str) -> Optional[Dict]:
        """Try known row shapes in priority order.  Returns a line-item dict
        or None."""
        # Peak Usage 5,808 kWh $0.221/kWh $1283.57
        m1 = re.match(
            r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d+)?/[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d{2})?)$",
            row_text, flags=re.IGNORECASE,
        )
        if m1:
            d, q, r, a = m1.groups()
            return {
                "line_number": line_number, "description": d.strip(),
                "quantity": q.strip(), "unit_price": r.strip(),
                "total_price": a.strip(),
                "extraction_method": method, "confidence_score": 0.93,
            }

        # Total Usage 3,909 kWh - $824.80   (single dash)
        m2 = re.match(
            r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+[-–—]\s+(\$?[\d,]+(?:\.\d{2})?)$",
            row_text, flags=re.IGNORECASE,
        )
        if m2:
            d, q, a = m2.groups()
            return {
                "line_number": line_number, "description": d.strip(),
                "quantity": q.strip(), "unit_price": "-",
                "total_price": a.strip(),
                "extraction_method": method, "confidence_score": 0.90,
            }

        # Service Fee - - $51.46
        m3 = re.match(
            r"^(.*?)\s+[-–—]\s+[-–—]\s+(\$?[\d,]+(?:\.\d{2})?)$",
            row_text, flags=re.IGNORECASE,
        )
        if m3:
            d, a = m3.groups()
            return {
                "line_number": line_number, "description": d.strip(),
                "quantity": "-", "unit_price": "-",
                "total_price": a.strip(),
                "extraction_method": method, "confidence_score": 0.88,
            }

        return None


_extraction_service = None


def get_extraction_service() -> FieldExtractionService:
    global _extraction_service
    if _extraction_service is None:
        _extraction_service = FieldExtractionService()
    return _extraction_service