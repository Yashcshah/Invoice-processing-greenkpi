import cv2
import numpy as np
from typing import Dict, Any, List, Tuple
from pathlib import Path
import time


class PreprocessingService:
    """Service for preprocessing invoice images before OCR"""
    
    def __init__(self):
        self.steps_applied = []
    
    def preprocess(self, image_path: str, output_path: str = None) -> Dict[str, Any]:
        """
        Apply full preprocessing pipeline to an image
        
        Steps:
        1. Convert to grayscale
        2. Deskew
        3. Remove noise
        4. Binarize (adaptive thresholding)
        5. Remove borders
        """
        start_time = time.time()
        self.steps_applied = []
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        original_shape = image.shape
        
        # Apply preprocessing steps
        image = self.to_grayscale(image)
        image = self.deskew(image)
        image = self.remove_noise(image)
        image = self.binarize(image)
        image = self.remove_borders(image)
        
        # Save output
        if output_path is None:
            output_path = str(Path(image_path).with_suffix('.preprocessed.png'))
        
        cv2.imwrite(output_path, image)
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return {
            'output_path': output_path,
            'original_shape': original_shape,
            'final_shape': image.shape,
            'steps_applied': self.steps_applied,
            'processing_time_ms': processing_time,
            'quality_metrics': self.calculate_quality_metrics(image),
        }
    
    def to_grayscale(self, image: np.ndarray) -> np.ndarray:
        """Convert image to grayscale"""
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            self.steps_applied.append({
                'name': 'grayscale',
                'params': {}
            })
            return gray
        return image
    
    def deskew(self, image: np.ndarray) -> np.ndarray:
        """Deskew the image to straighten text"""
        # Find all non-zero points (text)
        coords = np.column_stack(np.where(image < 128))
        
        if len(coords) < 100:
            return image
        
        # Get the minimum area rectangle
        angle = cv2.minAreaRect(coords)[-1]
        
        # Adjust angle
        if angle < -45:
            angle = 90 + angle
        elif angle > 45:
            angle = angle - 90
        
        # Only deskew if angle is significant
        if abs(angle) > 0.5:
            (h, w) = image.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            image = cv2.warpAffine(
                image, M, (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE
            )
            self.steps_applied.append({
                'name': 'deskew',
                'params': {'angle': angle}
            })
        
        return image
    
    def remove_noise(self, image: np.ndarray) -> np.ndarray:
        """Remove noise using morphological operations"""
        # Apply Gaussian blur
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        
        # Apply bilateral filter to preserve edges
        denoised = cv2.bilateralFilter(blurred, 9, 75, 75)
        
        self.steps_applied.append({
            'name': 'denoise',
            'params': {'method': 'bilateral', 'd': 9}
        })
        
        return denoised
    
    def binarize(self, image: np.ndarray) -> np.ndarray:
        """Convert to binary using adaptive thresholding"""
        # Adaptive thresholding works better for documents
        binary = cv2.adaptiveThreshold(
            image,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11,  # Block size
            2    # C constant
        )
        
        self.steps_applied.append({
            'name': 'binarize',
            'params': {'method': 'adaptive_gaussian', 'block_size': 11}
        })
        
        return binary
    
    def remove_borders(self, image: np.ndarray) -> np.ndarray:
        """Remove black borders from the image"""
        # Find contours
        contours, _ = cv2.findContours(
            image, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        
        if not contours:
            return image
        
        # Find the largest contour (should be the document)
        largest = max(contours, key=cv2.contourArea)
        x, y, w, h = cv2.boundingRect(largest)
        
        # Add small margin
        margin = 5
        x = max(0, x - margin)
        y = max(0, y - margin)
        w = min(image.shape[1] - x, w + 2 * margin)
        h = min(image.shape[0] - y, h + 2 * margin)
        
        cropped = image[y:y+h, x:x+w]
        
        self.steps_applied.append({
            'name': 'remove_borders',
            'params': {'crop_rect': [x, y, w, h]}
        })
        
        return cropped
    
    def calculate_quality_metrics(self, image: np.ndarray) -> Dict[str, float]:
        """Calculate image quality metrics"""
        # Sharpness (Laplacian variance)
        laplacian = cv2.Laplacian(image, cv2.CV_64F)
        sharpness = laplacian.var()
        
        # Contrast (standard deviation)
        contrast = image.std()
        
        # Brightness (mean)
        brightness = image.mean()
        
        # Normalize to 0-1 range
        return {
            'sharpness': min(sharpness / 500, 1.0),  # Normalize
            'contrast': contrast / 128,  # Normalize
            'brightness': brightness / 255,
        }
    
    def enhance_contrast(self, image: np.ndarray) -> np.ndarray:
        """Enhance contrast using CLAHE"""
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(image)
        
        self.steps_applied.append({
            'name': 'contrast_enhancement',
            'params': {'method': 'CLAHE', 'clip_limit': 2.0}
        })
        
        return enhanced


# Singleton instance
_preprocessing_service = None

def get_preprocessing_service() -> PreprocessingService:
    global _preprocessing_service
    if _preprocessing_service is None:
        _preprocessing_service = PreprocessingService()
    return _preprocessing_service
