from PIL import Image
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional
import time
import io
import tempfile
import os
from app.config import get_settings

settings = get_settings()

_TROCR_CONFIDENCE_THRESHOLD = 0.60
_MIN_TEXT_CHARS_FOR_NATIVE_PDF = 20
_MIN_WORDS_FOR_NATIVE_PDF = 5
_PDF_OCR_DPI = 300

# NOTE: pytesseract is imported lazily inside _tesseract_ocr() to avoid
# Python 3.13 compatibility issues at module load time.


class OCRService:
    """Service for performing OCR on invoice images and PDFs.

    PDF behaviour:
    - First tries native PyMuPDF text extraction for normal text-based PDFs.
    - If the page has no useful text, it renders the page as an image and runs OCR.
      This is required for scanned/image-only PDFs.
    """

    def __init__(self, engine: str = "tesseract"):
        self.engine = engine

        if engine == "easyocr":
            import easyocr
            self.reader = easyocr.Reader(["en"])

    def extract_text(self, image_path: str) -> Dict[str, Any]:
        """
        Extract text from an image file using OCR.

        Returns:
            Dict with raw_text, confidence_score, word_boxes, processing_time_ms
        """
        start_time = time.time()

        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")

        if self.engine == "tesseract":
            result = self._tesseract_ocr(image)
            result = self._maybe_trocr_fallback(result, image_path)
        else:
            result = self._easyocr_ocr(image)

        result["processing_time_ms"] = int((time.time() - start_time) * 1000)
        return result

    # ------------------------------------------------------------------
    # Image OCR
    # ------------------------------------------------------------------

    def _preprocess_for_ocr(self, image: np.ndarray) -> np.ndarray:
        """Prepare scanned/photo invoices for better OCR.

        Keeps output as a BGR image because _tesseract_ocr converts BGR -> RGB.
        """
        if image is None:
            return image

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

        # Upscale small scans/photos so Tesseract has enough pixels.
        h, w = gray.shape[:2]
        scale = 1.0
        if max(h, w) < 1800:
            scale = 2.0
        elif max(h, w) < 2400:
            scale = 1.5
        if scale > 1.0:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

        # Reduce noise but keep text edges.
        gray = cv2.fastNlMeansDenoising(gray, h=10)

        # Improve contrast for pale/scanned PDF images.
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

        # Adaptive threshold works better for uneven lighting / scanned pages.
        thresh = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            15,
        )

        return cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)

    def _tesseract_ocr(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform OCR using Tesseract."""
        import pytesseract

        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_path

        processed = self._preprocess_for_ocr(image)
        rgb_image = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)

        # psm 6 works well for document/table-like invoices.
        # preserve_interword_spaces helps table columns stay more readable.
        config = "--oem 3 --psm 6 -c preserve_interword_spaces=1"

        ocr_data = pytesseract.image_to_data(
            pil_image,
            output_type=pytesseract.Output.DICT,
            config=config,
        )
        raw_text = pytesseract.image_to_string(pil_image, config=config)

        word_boxes = []
        confidences = []

        for i in range(len(ocr_data["text"])):
            text = str(ocr_data["text"][i]).strip()
            try:
                conf = float(ocr_data["conf"][i])
            except (ValueError, TypeError):
                conf = -1

            if text and conf > 0:
                word_boxes.append({
                    "text": text,
                    "x": int(ocr_data["left"][i]),
                    "y": int(ocr_data["top"][i]),
                    "width": int(ocr_data["width"][i]),
                    "height": int(ocr_data["height"][i]),
                    "confidence": conf / 100.0,
                    "line_num": int(ocr_data["line_num"][i]),
                    "block_num": int(ocr_data["block_num"][i]),
                })
                confidences.append(conf)

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        try:
            engine_version = str(pytesseract.get_tesseract_version())
        except Exception:
            engine_version = "unknown"

        return {
            "raw_text": raw_text,
            "confidence_score": avg_confidence / 100.0,
            "word_boxes": word_boxes,
            "ocr_engine": "tesseract",
            "engine_version": engine_version,
        }

    def _maybe_trocr_fallback(self, result: Dict[str, Any], image_path: str) -> Dict[str, Any]:
        """Use TrOCR only when configured and Tesseract confidence is weak."""
        if not (
            result.get("confidence_score", 1.0) < _TROCR_CONFIDENCE_THRESHOLD
            and getattr(settings, "hf_token", None)
        ):
            return result

        try:
            trocr_result = self._trocr_ocr(image_path)
            if trocr_result and trocr_result.get("raw_text", "").strip():
                # Keep Tesseract word boxes because table extraction needs positions.
                result["raw_text"] = trocr_result["raw_text"]
                result["ocr_engine"] = "trocr+tesseract_boxes"
                result["confidence_score"] = max(
                    result.get("confidence_score", 0),
                    trocr_result.get("confidence_score", 0.85),
                )
        except Exception as exc:
            print(f"[OCR] TrOCR fallback failed: {exc}")
        return result

    def _trocr_ocr(self, image_path: str) -> Dict[str, Any]:
        """Fallback OCR using Microsoft TrOCR via Hugging Face Inference API."""
        import urllib.request
        import json as _json

        with open(image_path, "rb") as f:
            img_bytes = f.read()

        pil_img = Image.open(io.BytesIO(img_bytes))
        if max(pil_img.size) > 2000:
            pil_img.thumbnail((2000, 2000), Image.LANCZOS)
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
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

        text = data[0].get("generated_text", "") if isinstance(data, list) and data else str(data)

        return {
            "raw_text": text,
            "confidence_score": 0.85,
            "word_boxes": [],
            "ocr_engine": "trocr",
            "engine_version": "microsoft/trocr-large-printed",
        }

    def _easyocr_ocr(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform OCR using EasyOCR."""
        results = self.reader.readtext(image)

        raw_text_parts = []
        word_boxes = []
        confidences = []

        for (bbox, text, conf) in results:
            raw_text_parts.append(text)
            confidences.append(conf)

            x_coords = [p[0] for p in bbox]
            y_coords = [p[1] for p in bbox]

            word_boxes.append({
                "text": text,
                "x": int(min(x_coords)),
                "y": int(min(y_coords)),
                "width": int(max(x_coords) - min(x_coords)),
                "height": int(max(y_coords) - min(y_coords)),
                "confidence": conf,
                "line_num": 0,
                "block_num": 0,
            })

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        return {
            "raw_text": "\n".join(raw_text_parts),
            "confidence_score": avg_confidence,
            "word_boxes": word_boxes,
            "ocr_engine": "easyocr",
            "engine_version": "1.7.1",
        }

    # ------------------------------------------------------------------
    # PDF extraction with scanned-PDF fallback
    # ------------------------------------------------------------------

    def _native_pdf_page_text(self, page: Any, page_num: int, fitz_version: str, start_time: float) -> Dict[str, Any]:
        raw_text = page.get_text("text") or ""

        word_boxes = []
        for w in page.get_text("words"):
            x0, y0, x1, y1, word, block_no, line_no, word_no = w
            word_boxes.append({
                "text": word,
                "x": int(x0),
                "y": int(y0),
                "width": int(x1 - x0),
                "height": int(y1 - y0),
                "confidence": 1.0,
                "line_num": int(line_no),
                "block_num": int(block_no),
            })

        return {
            "raw_text": raw_text,
            "confidence_score": 1.0 if word_boxes else 0.0,
            "word_boxes": word_boxes,
            "ocr_engine": "pymupdf",
            "engine_version": fitz_version,
            "processing_time_ms": int((time.time() - start_time) * 1000),
            "page_number": page_num + 1,
            "is_scanned_pdf": False,
        }

    def _ocr_pdf_page(self, page: Any, page_num: int, start_time: float) -> Dict[str, Any]:
        """Render one PDF page to image and OCR it."""
        import fitz

        zoom = _PDF_OCR_DPI / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)

        img_bytes = pix.tobytes("png")
        np_arr = np.frombuffer(img_bytes, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not render PDF page {page_num + 1} to image")

        if self.engine == "easyocr":
            result = self._easyocr_ocr(image)
        else:
            result = self._tesseract_ocr(image)
            # TrOCR expects a file path, so save a temporary page image only if needed.
            if result.get("confidence_score", 1.0) < _TROCR_CONFIDENCE_THRESHOLD and getattr(settings, "hf_token", None):
                tmp_path = None
                try:
                    fd, tmp_path = tempfile.mkstemp(suffix=".png")
                    os.close(fd)
                    cv2.imwrite(tmp_path, image)
                    result = self._maybe_trocr_fallback(result, tmp_path)
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        os.remove(tmp_path)

        result["processing_time_ms"] = int((time.time() - start_time) * 1000)
        result["page_number"] = page_num + 1
        result["is_scanned_pdf"] = True
        result["ocr_engine"] = f"pdf_render_{result.get('ocr_engine', 'ocr')}"
        return result

    def extract_from_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Extract text from each page of a PDF.

        This supports both:
        1. Text-based PDFs: fast native PyMuPDF extraction.
        2. Scanned/image-only PDFs: render page to image, then OCR with Tesseract/EasyOCR.
        """
        import fitz  # PyMuPDF

        results = []
        doc = fitz.open(pdf_path)

        try:
            fitz_version = fitz.version[0]
            for page_num in range(len(doc)):
                start_time = time.time()
                page = doc[page_num]

                native_result = self._native_pdf_page_text(page, page_num, fitz_version, start_time)
                native_text = (native_result.get("raw_text") or "").strip()
                native_words = native_result.get("word_boxes") or []

                # IMPORTANT: scanned PDFs usually have image content but no text layer.
                # In that case PyMuPDF returns empty text/words, so we must OCR the page image.
                if len(native_text) >= _MIN_TEXT_CHARS_FOR_NATIVE_PDF and len(native_words) >= _MIN_WORDS_FOR_NATIVE_PDF:
                    results.append(native_result)
                else:
                    print(f"[OCR] Page {page_num + 1} looks scanned/image-only. Running OCR fallback...")
                    results.append(self._ocr_pdf_page(page, page_num, start_time))

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
