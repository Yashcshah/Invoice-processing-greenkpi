"""
Clustering Service
==================
Groups invoices by OCR-text similarity using TF-IDF + KMeans.
Each cluster represents a distinct "invoice format type" (usually one vendor).
The trained model is persisted to disk so it survives server restarts.
"""

import os
import pickle
from typing import Any, Dict, List, Optional

import numpy as np
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer


_MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "ml_models")
_VECTORIZER_PATH = os.path.join(_MODEL_DIR, "tfidf_vectorizer.pkl")
_KMEANS_PATH = os.path.join(_MODEL_DIR, "kmeans_model.pkl")

# Default number of clusters.  Grows automatically when we have more data.
_DEFAULT_K = 8
_MIN_INVOICES_TO_TRAIN = 2


class ClusteringService:
    """TF-IDF + KMeans invoice clustering."""

    def __init__(self) -> None:
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.kmeans: Optional[KMeans] = None
        self._load_models()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def is_trained(self) -> bool:
        return self.vectorizer is not None and self.kmeans is not None

    def fit(self, texts: List[str]) -> None:
        """Train (or retrain) the model on a corpus of OCR texts."""
        texts = [t for t in texts if t and t.strip()]
        if len(texts) < _MIN_INVOICES_TO_TRAIN:
            return

        k = min(_DEFAULT_K, len(texts))

        self.vectorizer = TfidfVectorizer(
            max_features=500,
            stop_words="english",
            ngram_range=(1, 2),
            min_df=1,
            sublinear_tf=True,
        )
        X = self.vectorizer.fit_transform(texts)

        self.kmeans = KMeans(
            n_clusters=k,
            random_state=42,
            n_init=10,
            max_iter=300,
        )
        self.kmeans.fit(X)
        self._save_models()

    def predict(self, text: str) -> Dict[str, Any]:
        """
        Predict the cluster for a single OCR text.

        Returns:
            {cluster_id: int, confidence: float, is_trained: bool}
        """
        if not self.is_trained or not text or not text.strip():
            return {"cluster_id": 0, "confidence": 0.0, "is_trained": False}

        X = self.vectorizer.transform([text])
        cluster_id = int(self.kmeans.predict(X)[0])

        # Confidence: 1 minus normalised distance to assigned centroid
        distances = self.kmeans.transform(X)[0]       # shape (k,)
        min_dist = distances[cluster_id]
        max_dist = distances.max()
        confidence = float(1.0 - min_dist / (max_dist + 1e-9))

        return {
            "cluster_id": cluster_id,
            "confidence": round(confidence, 4),
            "is_trained": True,
        }

    def get_n_clusters(self) -> int:
        if self.kmeans is None:
            return 0
        return int(self.kmeans.n_clusters)

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _load_models(self) -> None:
        try:
            if os.path.exists(_VECTORIZER_PATH) and os.path.exists(_KMEANS_PATH):
                with open(_VECTORIZER_PATH, "rb") as f:
                    self.vectorizer = pickle.load(f)
                with open(_KMEANS_PATH, "rb") as f:
                    self.kmeans = pickle.load(f)
        except Exception:
            # Corrupt model files — start fresh
            self.vectorizer = None
            self.kmeans = None

    def _save_models(self) -> None:
        os.makedirs(_MODEL_DIR, exist_ok=True)
        with open(_VECTORIZER_PATH, "wb") as f:
            pickle.dump(self.vectorizer, f)
        with open(_KMEANS_PATH, "wb") as f:
            pickle.dump(self.kmeans, f)


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_clustering_service: Optional[ClusteringService] = None


def get_clustering_service() -> ClusteringService:
    global _clustering_service
    if _clustering_service is None:
        _clustering_service = ClusteringService()
    return _clustering_service
