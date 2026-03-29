import re
from typing import Dict, Any, List, Optional
from datetime import datetime


class FieldExtractionService:
    """Service for extracting invoice fields using safer label-aware rules."""

    def __init__(self):
        self.rules = self._load_default_rules()

    def _load_default_rules(self) -> Dict[str, List[Dict]]:
        return {
            "invoice_number": [
                {
                    "type": "regex",
                    "pattern": r"(?:Invoice\s*(?:ID|Number|No|#)?)[\s:.\-]*([A-Z0-9][A-Z0-9\-_\/]{2,40})",
                    "flags": re.IGNORECASE,
                },
            ],
            "invoice_date": [
                {
                    "type": "regex",
                    "pattern": r"(?:Invoice Date|Date|Dated)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                    "flags": re.IGNORECASE,
                },
            ],
            "due_date": [
                {
                    "type": "regex",
                    "pattern": r"(?:Due Date|Payment Due|Pay By|Due)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})",
                    "flags": re.IGNORECASE,
                },
            ],
            "billing_period": [
                {
                    "type": "regex",
                    "pattern": r"(?:Billing Period|Service Period|Period)[\s:.\-]*([A-Za-z0-9\/\-. ]{6,100})",
                    "flags": re.IGNORECASE,
                },
            ],
            "total_amount": [
                {
                    "type": "regex",
                    "pattern": r"(?:TOTAL AMOUNT DUE|Amount Due|Grand Total|Total Due|Balance Due|TOTAL)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                    "flags": re.IGNORECASE,
                },
            ],
            "subtotal": [
                {
                    "type": "regex",
                    "pattern": r"(?:Subtotal|Sub-total|Sub Total)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
                    "flags": re.IGNORECASE,
                },
            ],
            "tax_amount": [
                {
                    "type": "regex",
                    "pattern": r"(?:GST|VAT|Sales Tax|Tax)[^\d$€£]{0,20}[$€£]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)",
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
                    "type": "regex",
                    "pattern": r"(?:Meter\s*ID|Meter|NMI)[\s:.\-]*([A-Z0-9\-_]{4,40})",
                    "flags": re.IGNORECASE,
                },
            ],
            "customer_name": [
                {
                    "type": "regex",
                    "pattern": r"(?:Customer|Account Name|Bill To)[\s:.\-]*(.+)",
                    "flags": re.IGNORECASE,
                },
            ],
            "site_name": [
                {
                    "type": "regex",
                    "pattern": r"(?:Site|Property|Premises|Location)[\s:.\-]*(.+)",
                    "flags": re.IGNORECASE,
                },
            ],
            "supply_address": [
                {
                    "type": "regex",
                    "pattern": r"(?:Supply Address|Address|Service Address)[\s:.\-]*(.+)",
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

        for field_name, rules in self.rules.items():
            result = self._extract_field(field_name, clean_text, rules, word_boxes)
            if result:
                results[field_name] = result

        return results

    def _extract_field(
        self,
        field_name: str,
        text: str,
        rules: List[Dict],
        word_boxes: List[Dict] = None,
    ) -> Optional[Dict[str, Any]]:
        for rule in rules:
            if rule["type"] == "regex":
                result = self._apply_regex_rule(text, rule, field_name)
                if result:
                    return {
                        "raw_value": result,
                        "normalized_value": self._normalize_value(field_name, result),
                        "confidence_score": 0.84,
                        "extraction_method": "regex",
                    }

            elif rule["type"] == "vendor_top":
                result = self._extract_vendor_name(text, word_boxes)
                if result:
                    return {
                        "raw_value": result,
                        "normalized_value": result,
                        "confidence_score": 0.75,
                        "extraction_method": "vendor_top",
                    }

        return None

    def _apply_regex_rule(self, text: str, rule: Dict, field_name: str) -> Optional[str]:
        match = re.search(rule["pattern"], text, rule.get("flags", 0))
        if not match:
            return None

        value = match.group(1) if match.groups() else match.group(0)
        value = self._clean_inline_value(value)

        if not value:
            return None

        # extra guards for noisy captures
        if field_name in {"customer_name", "site_name", "supply_address"}:
            if self._looks_like_header_noise(value):
                return None

        if field_name == "invoice_number":
            if self._looks_like_bad_invoice_number(value):
                return None

        return value

    def _extract_vendor_name(self, text: str, word_boxes: List[Dict] = None) -> Optional[str]:
        lines = self._get_text_lines(text, word_boxes)
        if not lines:
            return None

        top_lines = lines[:8]
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

            if re.search(r"\b(pty ltd|limited|ltd|inc|llc|group|services|energy|water|gas|electric|origin|agl)\b", cleaned, re.IGNORECASE):
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
            "water charges summary",
            "gas consumption charges",
            "electricity usage summary",
            "amount due",
            "subtotal",
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
            "account",
            "account number",
            "meter id",
            "abn:",
        ]
        if any(p in lower for p in bad_patterns):
            return True
        if len(value) > 100:
            return True
        return False

    def _looks_like_address(self, value: str) -> bool:
        return bool(
            re.search(
                r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|nsw|qld|vic|wa|sa|tas|nt|act)\b",
                value,
                re.IGNORECASE,
            )
        )

    def _looks_like_bad_invoice_number(self, value: str) -> bool:
        lower = value.lower()
        if lower in {"invoice", "inv", "number", "id", "oice"}:
            return True
        if len(value) < 3:
            return True
        return False

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
        value = re.sub(r"\s+", " ", value).strip(" :-\t")
        return value

    def _get_text_lines(self, text: str, word_boxes: List[Dict] = None) -> List[str]:
        if word_boxes:
            try:
                sorted_boxes = sorted(word_boxes, key=lambda x: (x.get("line_num", 0), x.get("x", 0)))
                lines = {}
                for box in sorted_boxes:
                    line_num = box.get("line_num", 0)
                    lines.setdefault(line_num, []).append(box.get("text", ""))
                result = []
                for line_num in sorted(lines.keys()):
                    line = self._clean_inline_value(" ".join(lines[line_num]))
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
        """
        Extract line items from invoice using line-by-line matching.
        Expected examples:
        - Gas Consumption 29,091 MJ $0.0263/MJ $765.09
        - Service Fee - - $71.95
        - Water Consumption 120 kL $2.46/kL $295.20
        """
        lines = self._get_text_lines(text, word_boxes)
        line_items: List[Dict] = []

        skip_patterns = [
            r"invoice",
            r"billing period",
            r"due date",
            r"subtotal",
            r"gst",
            r"total",
            r"amount due",
            r"description",
            r"usage",
            r"rate",
            r"customer",
            r"address",
            r"meter id",
            r"abn",
        ]

        for line in lines:
            lower = line.lower()
            if any(re.search(p, lower) for p in skip_patterns):
                continue

            # full row with description, usage, rate, amount
            match_full = re.match(
                r"^(.*?)\s+(\d[\d,]*\s*[A-Za-z]+)\s+\$?([\d,]+(?:\.\d+)?)(?:/[A-Za-z]+)?\s+\$?([\d,]+(?:\.\d{2})?)$",
                line,
            )
            if match_full:
                description, quantity, unit_price, total = match_full.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": quantity.strip(),
                    "unit_price": float(unit_price.replace(",", "")),
                    "total_price": float(total.replace(",", "")),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.85,
                })
                continue

            # service fee style row
            match_fee = re.match(
                r"^(.*?)\s+[-]\s+[-]\s+\$?([\d,]+(?:\.\d{2})?)$",
                line,
            )
            if match_fee:
                description, total = match_fee.groups()
                line_items.append({
                    "line_number": len(line_items) + 1,
                    "description": description.strip(),
                    "quantity": "-",
                    "unit_price": "-",
                    "total_price": float(total.replace(",", "")),
                    "extraction_method": "line_regex",
                    "confidence_score": 0.8,
                })
                continue

        return line_items


_extraction_service = None


def get_extraction_service() -> FieldExtractionService:
    global _extraction_service
    if _extraction_service is None:
        _extraction_service = FieldExtractionService()
    return _extraction_service