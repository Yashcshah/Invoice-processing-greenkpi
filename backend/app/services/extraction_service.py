import re
from typing import Dict, Any, List, Optional
from datetime import datetime


class FieldExtractionService:
    """Structured invoice field extraction with row-aware and section-aware rules."""

    def __init__(self):
        self.rules = self._load_default_rules()

    def _load_default_rules(self) -> Dict[str, List[Dict]]:
        return {
            "invoice_number": [
                {
                    "type": "row_label",
                    "labels": ["Invoice ID", "Invoice Number", "Invoice No", "Invoice #"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Invoice\s*(?:ID|Number|No|#)?)[\s:.\-]*([A-Z0-9][A-Z0-9\-_\/]{2,40})",
                    "flags": re.IGNORECASE,
                },
            ],
            "invoice_date": [
                {
                    "type": "row_label",
                    "labels": ["Invoice Date", "Date", "Dated"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Invoice Date|Date|Dated)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                    "flags": re.IGNORECASE,
                },
            ],
            "due_date": [
                {
                    "type": "row_label",
                    "labels": ["Due Date", "Payment Due", "Pay By", "Due"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Due Date|Payment Due|Pay By|Due)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                    "flags": re.IGNORECASE,
                },
            ],
            "billing_period": [
                {
                    "type": "row_label",
                    "labels": ["Billing Period", "Service Period", "Period"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Billing Period|Service Period|Period)[\s:.\-]*([A-Za-z0-9\/\-. ]{6,100})",
                    "flags": re.IGNORECASE,
                },
            ],
            "total_amount": [
                {
                    "type": "summary_label",
                    "labels": ["TOTAL AMOUNT DUE", "Amount Due", "Grand Total", "Total Due", "Balance Due", "TOTAL"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:TOTAL AMOUNT DUE|Amount Due|Grand Total|Total Due|Balance Due|TOTAL)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                    "flags": re.IGNORECASE,
                },
            ],
            "subtotal": [
                {
                    "type": "summary_label",
                    "labels": ["Subtotal", "Sub-total", "Sub Total"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Subtotal|Sub-total|Sub Total)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                    "flags": re.IGNORECASE,
                },
            ],
            "tax_amount": [
                {
                    "type": "summary_label",
                    "labels": ["GST", "GST (10%)", "VAT", "Sales Tax", "Tax"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:GST(?:\s*\(10%\))?|VAT|Sales Tax|Tax)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                    "flags": re.IGNORECASE,
                },
            ],
            "abn": [
                {
                    "type": "regex",
                    "pattern": r"\bABN[\s:.\-]*([\d ]{8,20})",
                    "flags": re.IGNORECASE,
                },
            ],
            "meter_id": [
                {
                    "type": "row_label",
                    "labels": ["Meter ID", "Meter", "NMI"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Meter\s*ID|Meter|NMI)[\s:.\-]*([A-Z0-9\-_]{4,40})",
                    "flags": re.IGNORECASE,
                },
            ],
            "customer_name": [
                {
                    "type": "row_label",
                    "labels": ["Customer", "Account Name", "Bill To"],
                },
            ],
            "site_name": [
                {
                    "type": "row_label",
                    "labels": ["Site", "Property", "Premises", "Location"],
                },
            ],
            "supply_address": [
                {
                    "type": "row_label",
                    "labels": ["Supply Address", "Address", "Service Address"],
                },
            ],
            "tariff_type": [
                {
                    "type": "row_label",
                    "labels": ["Tariff Type", "Tariff", "Plan", "Plan Name", "Service Type"],
                },
                {
                    "type": "regex",
                    "pattern": r"(?:Tariff Type|Tariff|Plan Name|Plan|Service Type)[\s:.\-]*(.+)",
                    "flags": re.IGNORECASE,
                },
            ],
            "vendor_name": [
                {
                    "type": "vendor_top",
                },
            ],
            "email": [
                {
                    "type": "regex",
                    "pattern": r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})",
                    "flags": 0,
                },
            ],
            "phone": [
                {
                    "type": "regex",
                    "pattern": r"(?:Tel|Phone|Ph|Mobile)[\s:.\-]*([+]?\d[\d\s\-().]{7,20})",
                    "flags": re.IGNORECASE,
                },
            ],
        }

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
            if rule["type"] == "row_label":
                value = self._extract_from_same_row_box(word_boxes, rule["labels"], field_name)
                if not value:
                    value = self._extract_label_value_from_lines(lines, rule["labels"], field_name)
                if value:
                    return self._pack_result(field_name, value, "row_label", 0.93)

            elif rule["type"] == "summary_label":
                value = self._extract_summary_value(word_boxes, lines, rule["labels"], field_name)
                if value:
                    return self._pack_result(field_name, value, "summary_label", 0.93)

            elif rule["type"] == "regex":
                value = self._apply_regex_rule(text, rule, field_name)
                if value:
                    return self._pack_result(field_name, value, "regex", 0.82)

            elif rule["type"] == "vendor_top":
                value = self._extract_vendor_name(text, word_boxes)
                if value:
                    return self._pack_result(field_name, value, "vendor_top", 0.75)

        return None

    def _pack_result(self, field_name: str, value: str, method: str, confidence: float) -> Dict[str, Any]:
        return {
            "raw_value": value,
            "normalized_value": self._normalize_value(field_name, value),
            "confidence_score": confidence,
            "extraction_method": method,
        }

    def _apply_regex_rule(self, text: str, rule: Dict, field_name: str) -> Optional[str]:
        match = re.search(rule["pattern"], text, rule.get("flags", 0))
        if not match:
            return None

        value = match.group(1) if match.groups() else match.group(0)
        value = self._clean_inline_value(value)

        if not value:
            return None

        if field_name in {"customer_name", "site_name", "supply_address", "tariff_type"}:
            if self._looks_like_header_noise(value):
                return None

        if field_name == "invoice_number" and self._looks_like_bad_invoice_number(value):
            return None

        return value

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
                "x1": x,
                "y1": y,
                "x2": x + w,
                "y2": y + h,
                "w": w,
                "h": h,
                "cx": x + w / 2,
                "cy": y + h / 2,
                "line_num": b.get("line_num", 0),
                "block_num": b.get("block_num", 0),
            })
        return out

    def _extract_from_same_row_box(
        self,
        word_boxes: List[Dict],
        labels: List[str],
        field_name: str,
    ) -> Optional[str]:
        boxes = self._normalize_boxes(word_boxes)
        if not boxes:
            return None

        for label in labels:
            label_lower = label.lower()

            for box in boxes:
                if box["text"].lower() != label_lower:
                    continue

                label_y = box["cy"]
                label_x2 = box["x2"]
                tolerance = max(10, box["h"] * 0.9)

                row_candidates = []
                for other in boxes:
                    if other["x1"] <= label_x2:
                        continue
                    if abs(other["cy"] - label_y) > tolerance:
                        continue
                    if self._looks_like_header_noise(other["text"]):
                        continue
                    row_candidates.append(other)

                row_candidates.sort(key=lambda b: b["x1"])
                if row_candidates:
                    value = self._clean_inline_value(" ".join(b["text"] for b in row_candidates))
                    if self._is_valid_field_value(value, field_name):
                        return value

        return None

    def _extract_label_value_from_lines(
        self,
        lines: List[str],
        labels: List[str],
        field_name: str,
    ) -> Optional[str]:
        for i, line in enumerate(lines):
            clean_line = self._clean_inline_value(line)

            for label in labels:
                # same line
                m = re.match(rf"^{re.escape(label)}\s*[:.\-]?\s+(.+)$", clean_line, flags=re.IGNORECASE)
                if m:
                    value = self._clean_inline_value(m.group(1))
                    if self._is_valid_field_value(value, field_name):
                        return value

                # label on one line, value on next line(s)
                if clean_line.lower() == label.lower():
                    for j in range(i + 1, min(i + 4, len(lines))):
                        candidate = self._clean_inline_value(lines[j])
                        if self._is_valid_field_value(candidate, field_name):
                            return candidate

        return None

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
            for label in labels:
                label_lower = label.lower()
                for box in boxes:
                    if box["text"].lower() != label_lower:
                        continue

                    row_candidates = []
                    tolerance = max(10, box["h"] * 0.9)
                    for other in boxes:
                        if other["x1"] <= box["x2"]:
                            continue
                        if abs(other["cy"] - box["cy"]) > tolerance:
                            continue
                        row_candidates.append(other)

                    row_candidates.sort(key=lambda b: b["x1"])
                    if row_candidates:
                        row_text = " ".join(b["text"] for b in row_candidates)
                        amounts = money_pattern.findall(row_text)
                        if amounts:
                            return amounts[-1]

        for line in lines:
            lower = line.lower()
            if any(label.lower() in lower for label in labels):
                amounts = money_pattern.findall(line)
                if amounts:
                    return amounts[-1]

        return None

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
                cleaned,
                re.IGNORECASE,
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

    def _looks_like_header_noise(self, value: str) -> bool:
        lower = value.lower()
        bad_patterns = [
            "invoice details",
            "property details",
            "customer & site information",
            "customer / site details",
            "site details",
            "water charges summary",
            "gas consumption charges",
            "electricity usage summary",
            "electricity usage charges",
            "amount due",
            "subtotal",
            "total amount due",
            "total",
            "gst",
            "vat",
            "tax",
            "billing period",
            "invoice date",
            "due date",
            "description",
            "usage",
            "rate",
            "amount",
            "account",
            "account number",
            "meter id",
            "invoice id",
            "abn:",
        ]
        if any(p in lower for p in bad_patterns):
            return True
        return len(value) > 140

    def _looks_like_address(self, value: str) -> bool:
        return bool(
            re.search(
                r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|vic|nsw|qld|wa|sa|tas|nt|act)\b",
                value,
                re.IGNORECASE,
            )
        )

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

        return [self._clean_inline_value(line) for line in text.splitlines() if self._clean_inline_value(line)]

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
        formats = [
            "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d",
            "%m-%d-%Y", "%d-%m-%Y", "%Y-%m-%d",
            "%m.%d.%Y", "%d.%m.%Y", "%Y.%m.%d",
            "%m/%d/%y", "%d/%m/%y",
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
            amount = float(cleaned)
            return f"{amount:.2f}"
        except ValueError:
            return value

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

        header_candidates = {"description", "usage", "rate", "amount"}
        header_row_y = None

        for b in boxes:
            if b["text"].lower() == "description":
                # Prefer description header that has other header columns roughly on same row
                same_row = [
                    x for x in boxes
                    if abs(x["cy"] - b["cy"]) <= max(10, b["h"] * 0.9)
                    and x["text"].lower() in header_candidates
                ]
                if len(same_row) >= 3:
                    header_row_y = b["cy"]
                    break

        if header_row_y is None:
            return []

        stop_words = {"subtotal", "gst", "total", "amount due", "total amount due"}
        rows: Dict[float, List[Dict]] = {}

        for b in boxes:
            if b["cy"] <= header_row_y + 8:
                continue

            lower = b["text"].lower()
            if any(sw in lower for sw in stop_words):
                continue

            matched_key = None
            for key in rows:
                if abs(key - b["cy"]) <= 8:
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
            if any(x in lower for x in ["description", "usage", "rate", "amount", "invoice", "customer", "billing period"]):
                continue

            # Peak Usage 5,808 kWh $0.221/kWh $1283.57
            m1 = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d+)?/[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d{2})?)$",
                row_text,
                flags=re.IGNORECASE,
            )
            if m1:
                description, usage, rate, amount = m1.groups()
                parsed.append({
                    "line_number": len(parsed) + 1,
                    "description": description.strip(),
                    "quantity": usage.strip(),
                    "unit_price": rate.strip(),
                    "total_price": amount.strip(),
                    "extraction_method": "box_table",
                    "confidence_score": 0.94,
                })
                continue

            # Total Usage 9,608 kWh - $2123.37
            m2 = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+[-–]\s+(\$?[\d,]+(?:\.\d{2})?)$",
                row_text,
                flags=re.IGNORECASE,
            )
            if m2:
                description, usage, amount = m2.groups()
                parsed.append({
                    "line_number": len(parsed) + 1,
                    "description": description.strip(),
                    "quantity": usage.strip(),
                    "unit_price": "-",
                    "total_price": amount.strip(),
                    "extraction_method": "box_table",
                    "confidence_score": 0.92,
                })
                continue

            # Service Fee - - $51.46
            m3 = re.match(
                r"^(.*?)\s+[-–]\s+[-–]\s+(\$?[\d,]+(?:\.\d{2})?)$",
                row_text,
                flags=re.IGNORECASE,
            )
            if m3:
                description, amount = m3.groups()
                parsed.append({
                    "line_number": len(parsed) + 1,
                    "description": description.strip(),
                    "quantity": "-",
                    "unit_price": "-",
                    "total_price": amount.strip(),
                    "extraction_method": "box_table",
                    "confidence_score": 0.90,
                })
                continue

        return parsed

    def _extract_line_items_from_lines(self, text: str, word_boxes: List[Dict] = None) -> List[Dict]:
        lines = self._get_text_lines(text, word_boxes)
        line_items: List[Dict] = []

        section_start = None
        section_end = None

        for i, line in enumerate(lines):
            lower = line.lower()
            if any(x in lower for x in [
                "gas consumption charges",
                "electricity usage summary",
                "electricity usage charges",
                "water consumption charges",
                "water charges",
                "charges summary",
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
                "description", "usage", "rate", "amount",
                "subtotal", "gst", "invoice", "billing period",
                "customer", "address", "meter id", "abn",
            ]):
                continue

            # Peak Usage 5,808 kWh $0.221/kWh $1283.57
            m1 = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d+)?/[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d{2})?)$",
                clean,
                flags=re.IGNORECASE,
            )
            if m1:
                description, usage, rate, amount = m1.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": usage.strip(),
                    "unit_price": rate.strip(),
                    "total_price": amount.strip(),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.90,
                })
                continue

            # Total Usage 9,608 kWh - $2123.37
            m2 = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+[-–]\s+(\$?[\d,]+(?:\.\d{2})?)$",
                clean,
                flags=re.IGNORECASE,
            )
            if m2:
                description, usage, amount = m2.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": usage.strip(),
                    "unit_price": "-",
                    "total_price": amount.strip(),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.88,
                })
                continue

            # Gas Consumption 19,448 MJ $0.022/MJ $427.86
            m3 = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d+)?/[A-Za-z]{1,6})\s+(\$?[\d,]+(?:\.\d{2})?)$",
                clean,
                flags=re.IGNORECASE,
            )
            if m3:
                description, usage, rate, amount = m3.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": usage.strip(),
                    "unit_price": rate.strip(),
                    "total_price": amount.strip(),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.88,
                })
                continue

            # Service Fee - - $51.46
            m4 = re.match(
                r"^(.*?)\s+[-–]\s+[-–]\s+(\$?[\d,]+(?:\.\d{2})?)$",
                clean,
                flags=re.IGNORECASE,
            )
            if m4:
                description, amount = m4.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": "-",
                    "unit_price": "-",
                    "total_price": amount.strip(),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.85,
                })

        return line_items


_extraction_service = None


def get_extraction_service() -> FieldExtractionService:
    global _extraction_service
    if _extraction_service is None:
        _extraction_service = FieldExtractionService()
    return _extraction_service