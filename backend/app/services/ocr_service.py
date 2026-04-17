from PIL import Image
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional
import time
import base64
import io
from app.config import get_settings

settings = get_settings()

_TROCR_CONFIDENCE_THRESHOLD = 0.60   # fall back to TrOCR when Tesseract avg conf < this

# NOTE: pytesseract is imported lazily inside _tesseract_ocr() to avoid
# Python 3.13 compatibility issues at module load time.


class OCRService:
    """Service for performing OCR on invoice images"""
    
    def __init__(self, engine: str = "tesseract"):
        self.engine = engine
        
        if engine == "easyocr":
            import easyocr
            self.reader = easyocr.Reader(['en'])
    
    def extract_text(self, image_path: str) -> Dict[str, Any]:
        """
        Extract text from an image using OCR.
        If Tesseract confidence is below threshold, falls back to TrOCR via HF API.

        Returns:
            Dict with raw_text, confidence, word_boxes, processing_time
        """
        start_time = time.time()

        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")

        if self.engine == "tesseract":
            result = self._tesseract_ocr(image)
            # TrOCR fallback: when Tesseract confidence is low
            if (
                result.get('confidence_score', 1.0) < _TROCR_CONFIDENCE_THRESHOLD
                and settings.hf_token
            ):
                try:
                    trocr_result = self._trocr_ocr(image_path)
                    if trocr_result and trocr_result.get('raw_text', '').strip():
                        # Merge: use TrOCR text but keep Tesseract word boxes
                        result['raw_text'] = trocr_result['raw_text']
                        result['ocr_engine'] = 'trocr'
                        result['confidence_score'] = max(
                            result['confidence_score'],
                            trocr_result.get('confidence_score', 0.85)
                        )
                except Exception as exc:
                    print(f"[OCR] TrOCR fallback failed: {exc}")
        else:
            result = self._easyocr_ocr(image)

        result['processing_time_ms'] = int((time.time() - start_time) * 1000)
        return result
    
    def _tesseract_ocr(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform OCR using Tesseract"""
        # Lazy import to avoid Python 3.13 compatibility issues at module load time
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_path

        # Convert BGR to RGB
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)
        
        # Get detailed OCR data
        ocr_data = pytesseract.image_to_data(
            pil_image,
            output_type=pytesseract.Output.DICT,
            config='--psm 6'  # Assume uniform block of text
        )

        # Extract raw text
        raw_text = pytesseract.image_to_string(pil_image, config='--psm 6')

        # Build word boxes with confidence
        word_boxes = []
        confidences = []

        for i in range(len(ocr_data['text'])):
            text = ocr_data['text'][i].strip()
            conf = int(ocr_data['conf'][i])

            if text and conf > 0:
                word_boxes.append({
                    'text': text,
                    'x': ocr_data['left'][i],
                    'y': ocr_data['top'][i],
                    'width': ocr_data['width'][i],
                    'height': ocr_data['height'][i],
                    'confidence': conf / 100.0,
                    'line_num': ocr_data['line_num'][i],
                    'block_num': ocr_data['block_num'][i],
                })
                confidences.append(conf)

        # Calculate average confidence
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # get_tesseract_version() returns a Version object in newer pytesseract
        try:
            engine_version = str(pytesseract.get_tesseract_version())
        except Exception:
            engine_version = 'unknown'

        return {
            'raw_text': raw_text,
            'confidence_score': avg_confidence / 100.0,
            'word_boxes': word_boxes,
            'ocr_engine': 'tesseract',
            'engine_version': engine_version,
        }
    
    def _trocr_ocr(self, image_path: str) -> Dict[str, Any]:
        """
        Fallback OCR using Microsoft TrOCR via Hugging Face Inference API.
        Called when Tesseract confidence is below _TROCR_CONFIDENCE_THRESHOLD.
        Requires HF_TOKEN set in .env.
        """
        import urllib.request
        import json as _json

        # Read image and base64-encode it
        with open(image_path, 'rb') as f:
            img_bytes = f.read()

        # Resize if large (HF API has a 10 MB limit)
        pil_img = Image.open(io.BytesIO(img_bytes))
        if max(pil_img.size) > 2000:
            pil_img.thumbnail((2000, 2000), Image.LANCZOS)
            buf = io.BytesIO()
            pil_img.save(buf, format='PNG')
            img_bytes = buf.getvalue()

        url = "https://api-inference.huggingface.co/models/microsoft/trocr-large-printed"
        req = urllib.request.Request(
            url,
            data=img_bytes,
            headers={
                "Authorization": f"Bearer {settings.hf_token}",
                "Content-Type": "image/png",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = _json.loads(resp.read())

        # HF returns [{"generated_text": "..."}]
        if isinstance(data, list) and data:
            text = data[0].get('generated_text', '')
        else:
            text = str(data)

        return {
            'raw_text': text,
            'confidence_score': 0.85,
            'word_boxes': [],
            'ocr_engine': 'trocr',
            'engine_version': 'microsoft/trocr-large-printed',
        }

    def _easyocr_ocr(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform OCR using EasyOCR"""
        results = self.reader.readtext(image)
        
        raw_text_parts = []
        word_boxes = []
        confidences = []
        
        for (bbox, text, conf) in results:
            raw_text_parts.append(text)
            confidences.append(conf)
            
            # Convert bbox format
            x_coords = [p[0] for p in bbox]
            y_coords = [p[1] for p in bbox]
            
            word_boxes.append({
                'text': text,
                'x': int(min(x_coords)),
                'y': int(min(y_coords)),
                'width': int(max(x_coords) - min(x_coords)),
                'height': int(max(y_coords) - min(y_coords)),
                'confidence': conf,
            })
        
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        return {
            'raw_text': '\n'.join(raw_text_parts),
            'confidence_score': avg_confidence,
            'word_boxes': word_boxes,
            'ocr_engine': 'easyocr',
            'engine_version': '1.7.1',
        }
    
    def extract_from_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Extract text from each page of a PDF using PyMuPDF.

        Uses direct text extraction (no OCR) which is faster, more accurate,
        and avoids pytesseract/Python 3.13 compatibility issues.
        """
        import fitz  # PyMuPDF

        results = []
        doc = fitz.open(pdf_path)

        try:
            for page_num in range(len(doc)):
                start_time = time.time()
                page = doc[page_num]

                # Direct text extraction — no OCR needed for text-based PDFs
                raw_text = page.get_text("text")

                # Extract word positions: (x0, y0, x1, y1, word, block_no, line_no, word_no)
                word_boxes = []
                for w in page.get_text("words"):
                    x0, y0, x1, y1, word, block_no, line_no, word_no = w
                    word_boxes.append({
                        'text': word,
                        'x': int(x0),
                        'y': int(y0),
                        'width': int(x1 - x0),
                        'height': int(y1 - y0),
                        'confidence': 1.0,
                        'line_num': line_no,
                        'block_num': block_no,
                    })

                processing_time = int((time.time() - start_time) * 1000)

                results.append({
                    'raw_text': raw_text,
                    'confidence_score': 1.0 if word_boxes else 0.0,
                    'word_boxes': word_boxes,
                    'ocr_engine': 'pymupdf',
                    'engine_version': fitz.version[0],
                    'processing_time_ms': processing_time,
                    'page_number': page_num + 1,
                })
        finally:
            doc.close()

        return results


# Singleton instance
_ocr_service: Optional[OCRService] = None

def get_ocr_service() -> OCRService:
    global _ocr_service
    if _ocr_service is None:
        _ocr_service = OCRService(engine=settings.ocr_engine)
    return _ocr_service
