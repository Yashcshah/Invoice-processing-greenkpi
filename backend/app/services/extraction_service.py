import re
from typing import Dict, Any, List, Optional
from datetime import datetime
import json


class FieldExtractionService:
    """Service for extracting invoice fields using rules and NER"""
    
    def __init__(self):
        self.rules = self._load_default_rules()
    
    def _load_default_rules(self) -> Dict[str, List[Dict]]:
        """Load default extraction rules"""
        return {
            'invoice_number': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Invoice|Inv|INV)[\s#:.-]*([A-Z0-9-]{4,20})',
                    'flags': re.IGNORECASE,
                },
                {
                    'type': 'regex',
                    'pattern': r'(?:Number|No|#)[\s:.-]*([A-Z0-9-]{4,20})',
                    'flags': re.IGNORECASE,
                },
            ],
            'invoice_date': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Date|Dated|Invoice Date)[\s:.-]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
                    'flags': re.IGNORECASE,
                },
                {
                    'type': 'regex',
                    'pattern': r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
                    'flags': 0,
                },
                {
                    'type': 'regex',
                    'pattern': r'(\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2})',  # ISO format
                    'flags': 0,
                },
            ],
            'due_date': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Due Date|Payment Due|Pay By)[\s:.-]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})',
                    'flags': re.IGNORECASE,
                },
            ],
            'total_amount': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Total|Grand Total|Amount Due|Total Due|Balance Due)[\s:$€£]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',
                    'flags': re.IGNORECASE,
                },
                {
                    'type': 'regex',
                    'pattern': r'\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:Total|Due)',
                    'flags': re.IGNORECASE,
                },
            ],
            'subtotal': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Subtotal|Sub-total|Sub Total)[\s:$€£]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',
                    'flags': re.IGNORECASE,
                },
            ],
            'tax_amount': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Tax|VAT|GST|Sales Tax)[\s:$€£]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',
                    'flags': re.IGNORECASE,
                },
            ],
            'po_number': [
                {
                    'type': 'regex',
                    'pattern': r'(?:PO|P\.O\.|Purchase Order)[\s#:.-]*([A-Z0-9-]{4,20})',
                    'flags': re.IGNORECASE,
                },
            ],
            'vendor_name': [
                {
                    'type': 'position',
                    'region': 'top',
                    'max_lines': 3,
                },
            ],
            'email': [
                {
                    'type': 'regex',
                    'pattern': r'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})',
                    'flags': 0,
                },
            ],
            'phone': [
                {
                    'type': 'regex',
                    'pattern': r'(?:Tel|Phone|Ph|Mobile)[\s:.-]*([+]?[\d\s\-().]{10,20})',
                    'flags': re.IGNORECASE,
                },
            ],
        }
    
    def extract_fields(self, text: str, word_boxes: List[Dict] = None) -> Dict[str, Any]:
        """
        Extract all fields from OCR text
        
        Returns:
            Dict with field_name -> {value, confidence, method, bounding_box}
        """
        results = {}
        
        for field_name, rules in self.rules.items():
            result = self._extract_field(field_name, text, rules, word_boxes)
            if result:
                results[field_name] = result
        
        return results
    
    def _extract_field(
        self, 
        field_name: str, 
        text: str, 
        rules: List[Dict],
        word_boxes: List[Dict] = None
    ) -> Optional[Dict[str, Any]]:
        """Extract a single field using its rules"""
        
        for rule in rules:
            if rule['type'] == 'regex':
                result = self._apply_regex_rule(text, rule)
                if result:
                    return {
                        'raw_value': result,
                        'normalized_value': self._normalize_value(field_name, result),
                        'confidence_score': 0.8,  # Rule-based confidence
                        'extraction_method': 'regex',
                    }
            
            elif rule['type'] == 'position':
                if rule.get('region') == 'top' and word_boxes:
                    result = self._extract_from_top(word_boxes, rule.get('max_lines', 3))
                    if result:
                        return {
                            'raw_value': result,
                            'normalized_value': result,
                            'confidence_score': 0.6,  # Position-based is less confident
                            'extraction_method': 'position_based',
                        }
        
        return None
    
    def _apply_regex_rule(self, text: str, rule: Dict) -> Optional[str]:
        """Apply a regex rule and return the matched value"""
        pattern = rule['pattern']
        flags = rule.get('flags', 0)
        
        match = re.search(pattern, text, flags)
        if match:
            return match.group(1) if match.groups() else match.group(0)
        return None
    
    def _extract_from_top(self, word_boxes: List[Dict], max_lines: int) -> Optional[str]:
        """Extract text from the top of the document (for vendor name)"""
        if not word_boxes:
            return None
        
        # Sort by Y position
        sorted_boxes = sorted(word_boxes, key=lambda x: x.get('y', 0))
        
        # Get unique line numbers
        lines = {}
        for box in sorted_boxes:
            line_num = box.get('line_num', 0)
            if line_num not in lines:
                lines[line_num] = []
            lines[line_num].append(box['text'])
        
        # Get first N lines
        result_lines = []
        for i, line_num in enumerate(sorted(lines.keys())[:max_lines]):
            line_text = ' '.join(lines[line_num])
            if line_text.strip():
                result_lines.append(line_text.strip())
        
        return result_lines[0] if result_lines else None
    
    def _normalize_value(self, field_name: str, value: str) -> str:
        """Normalize extracted value based on field type"""
        if not value:
            return value
        
        if field_name in ['invoice_date', 'due_date']:
            return self._normalize_date(value)
        
        if field_name in ['total_amount', 'subtotal', 'tax_amount']:
            return self._normalize_currency(value)
        
        return value.strip()
    
    def _normalize_date(self, value: str) -> str:
        """Normalize date to ISO format"""
        # Common date formats
        formats = [
            '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d',
            '%m-%d-%Y', '%d-%m-%Y', '%Y-%m-%d',
            '%m.%d.%Y', '%d.%m.%Y', '%Y.%m.%d',
            '%m/%d/%y', '%d/%m/%y',
        ]
        
        for fmt in formats:
            try:
                dt = datetime.strptime(value.strip(), fmt)
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                continue
        
        return value
    
    def _normalize_currency(self, value: str) -> str:
        """Normalize currency value"""
        # Remove currency symbols and commas
        cleaned = re.sub(r'[$€£,\s]', '', value)
        try:
            amount = float(cleaned)
            return f"{amount:.2f}"
        except ValueError:
            return value
    
    def extract_line_items(self, text: str, word_boxes: List[Dict] = None) -> List[Dict]:
        """
        Extract line items from invoice
        
        This is a simplified implementation - Sprint 3 will improve this
        """
        line_items = []
        
        # Simple pattern for line items: description, quantity, price
        pattern = r'(.+?)\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)'
        
        matches = re.findall(pattern, text)
        
        for i, match in enumerate(matches):
            description, qty, unit_price, total = match
            line_items.append({
                'line_number': i + 1,
                'description': description.strip(),
                'quantity': float(qty),
                'unit_price': float(unit_price.replace(',', '')),
                'total_price': float(total.replace(',', '')),
                'extraction_method': 'regex',
                'confidence_score': 0.7,
            })
        
        return line_items


# Singleton instance
_extraction_service = None

def get_extraction_service() -> FieldExtractionService:
    global _extraction_service
    if _extraction_service is None:
        _extraction_service = FieldExtractionService()
    return _extraction_service
