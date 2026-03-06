import pytesseract
from PIL import Image
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional
import time
from app.config import get_settings

settings = get_settings()

# Configure Tesseract path
pytesseract.pytesseract.tesseract_cmd = settings.tesseract_path


class OCRService:
    """Service for performing OCR on invoice images"""
    
    def __init__(self, engine: str = "tesseract"):
        self.engine = engine
        
        if engine == "easyocr":
            import easyocr
            self.reader = easyocr.Reader(['en'])
    
    def extract_text(self, image_path: str) -> Dict[str, Any]:
        """
        Extract text from an image using OCR
        
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
        else:
            result = self._easyocr_ocr(image)
        
        result['processing_time_ms'] = int((time.time() - start_time) * 1000)
        return result
    
    def _tesseract_ocr(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform OCR using Tesseract"""
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
        
        return {
            'raw_text': raw_text,
            'confidence_score': avg_confidence / 100.0,
            'word_boxes': word_boxes,
            'ocr_engine': 'tesseract',
            'engine_version': pytesseract.get_tesseract_version().split()[0] if pytesseract.get_tesseract_version() else 'unknown',
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
        """Extract text from each page of a PDF"""
        from pdf2image import convert_from_path
        
        pages = convert_from_path(pdf_path)
        results = []
        
        for i, page in enumerate(pages):
            # Convert PIL image to numpy array
            image = np.array(page)
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
            
            # Save temp image
            temp_path = f"/tmp/page_{i}.png"
            cv2.imwrite(temp_path, image)
            
            result = self.extract_text(temp_path)
            result['page_number'] = i + 1
            results.append(result)
        
        return results


# Singleton instance
_ocr_service: Optional[OCRService] = None

def get_ocr_service() -> OCRService:
    global _ocr_service
    if _ocr_service is None:
        _ocr_service = OCRService(engine=settings.ocr_engine)
    return _ocr_service
