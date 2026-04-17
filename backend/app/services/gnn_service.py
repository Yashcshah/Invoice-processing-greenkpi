"""
GNN Service  —  2-layer Graph Attention Network (GAT)
======================================================
Refines field-level extraction using a GAT that reasons over the
invoice document graph produced by graph_builder.py.

Two modes
---------
• FULL  — PyTorch + torch-geometric installed  → real GAT inference
• LITE  — fallback when torch/pyg not available → graph-feature heuristics
           (still improves extraction without requiring GPU libs)

Install (optional, for FULL mode):
    pip install torch torchvision
    pip install torch-geometric

The model is saved to / loaded from  backend/ml_models/gat_model.pt
After enough validated invoices, call  GNNService.retrain()  to fine-tune.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ── Optional: PyTorch + torch-geometric ──────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False

try:
    from torch_geometric.nn import GATConv
    from torch_geometric.data import Data as PyGData
    _PYG_AVAILABLE = True
except ImportError:
    _PYG_AVAILABLE = False

_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "ml_models", "gat_model.pt"
)

_IN_FEATURES = 20    # must match graph_builder._FEATURE_DIM
_HIDDEN      = 64
_OUT         = 32    # per-node output dim; mean-pooled → graph embedding
_N_HEADS     = 4

# Node-level field type prediction classes (NODE_PRED stage)
_FIELD_TYPES = [
    "vendor_name",    # 0
    "invoice_number", # 1
    "invoice_date",   # 2
    "due_date",       # 3
    "total_amount",   # 4
    "subtotal",       # 5
    "tax_amount",     # 6
    "line_item",      # 7
    "other",          # 8
]
_N_FIELD_TYPES = len(_FIELD_TYPES)  # 9


# ── GAT model definition (only compiled when torch is available) ─────────────

if _TORCH_AVAILABLE and _PYG_AVAILABLE:
    class GATInvoiceModel(nn.Module):
        """
        2-layer GAT for invoice document graphs.

        Architecture:
          GATConv(20 → 64×4) → ELU → dropout →
          GATConv(256 → 32)   → node embeddings (N, 32)
          Linear(32 → 9)      → per-node field type logits (NODE_PRED)
        """

        def __init__(
            self,
            in_features: int = _IN_FEATURES,
            hidden: int = _HIDDEN,
            out: int = _OUT,
            heads: int = _N_HEADS,
            n_field_types: int = _N_FIELD_TYPES,
        ) -> None:
            super().__init__()
            self.conv1 = GATConv(in_features, hidden, heads=heads, dropout=0.3)
            self.conv2 = GATConv(hidden * heads, out, heads=1, concat=False, dropout=0.3)
            # NODE_PRED classification head: predicts which field type each node represents
            self.node_classifier = nn.Linear(out, n_field_types)

        def forward(self, x, edge_index):
            x = F.elu(self.conv1(x, edge_index))
            x = F.dropout(x, p=0.3, training=self.training)
            x = self.conv2(x, edge_index)
            return x          # (N, out=32)

        def forward_with_predictions(
            self, x, edge_index
        ) -> "Tuple[torch.Tensor, torch.Tensor]":
            """Return (node_embeddings (N,32), field_type_logits (N,9))."""
            node_embs = self.forward(x, edge_index)
            logits    = self.node_classifier(node_embs)   # (N, _N_FIELD_TYPES)
            return node_embs, logits

        def embed(self, x, edge_index) -> "torch.Tensor":
            """Return mean-pooled graph embedding (1, out)."""
            node_embs = self.forward(x, edge_index)
            return node_embs.mean(dim=0, keepdim=True)   # (1, out)


class GNNService:
    """
    Wraps GAT inference and exposes a field-refinement API.

    Usage in the pipeline:
        gnn = get_gnn_service()
        result = gnn.infer(graph_data, extracted_fields)
        refined_fields  = result["fields"]
        graph_embedding = result["graph_embedding"]   # List[float] length 32
    """

    def __init__(self) -> None:
        self._model = None
        self._mode  = "none"
        self._init()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def _init(self) -> None:
        if _TORCH_AVAILABLE and _PYG_AVAILABLE:
            self._model = GATInvoiceModel()
            self._load_weights()
            self._model.eval()
            self._mode = "full"
        elif _TORCH_AVAILABLE:
            self._mode = "torch_only"
        else:
            self._mode = "lite"

    def _load_weights(self) -> None:
        if os.path.exists(_MODEL_PATH):
            try:
                state = torch.load(_MODEL_PATH, map_location="cpu")
                self._model.load_state_dict(state)
            except Exception as exc:
                print(f"[GNNService] Could not load weights: {exc} — using fresh model")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def mode(self) -> str:
        return self._mode

    def infer(
        self,
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Refine extraction fields using the document graph.

        Args:
            graph_data  : output of GraphBuilder.build()
            fields      : {field_name: {raw_value, normalized_value, confidence_score, ...}}

        Returns:
            {
              fields: refined fields dict,
              graph_embedding: List[float] (32-dim),
              mode: str,
              processing_time_ms: int,
            }
        """
        start = time.time()

        node_features = graph_data.get("node_features")
        edge_index    = graph_data.get("edge_index")
        n_nodes       = graph_data.get("n_nodes", 0)

        if n_nodes == 0 or node_features is None:
            return self._passthrough(fields, start)

        # ── FULL mode (PyTorch + PyG) ────────────────────────────────
        if self._mode == "full":
            return self._full_infer(node_features, edge_index, graph_data, fields, start)

        # ── LITE mode (heuristics on graph features) ─────────────────
        return self._lite_infer(node_features, graph_data, fields, start)

    # ------------------------------------------------------------------
    # Full GAT inference
    # ------------------------------------------------------------------

    def _full_infer(
        self,
        node_features: np.ndarray,
        edge_index: np.ndarray,
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
        start: float,
    ) -> Dict[str, Any]:
        x  = torch.tensor(node_features, dtype=torch.float)
        ei = torch.tensor(edge_index, dtype=torch.long)

        # Handle zero-edge case
        if ei.numel() == 0:
            ei = torch.zeros((2, 0), dtype=torch.long)

        with torch.no_grad():
            # NODE_PRED: per-node field type logits
            node_embs, node_logits = self._model.forward_with_predictions(x, ei)
            graph_emb   = node_embs.mean(0).tolist()           # (32,)
            node_probs  = torch.softmax(node_logits, dim=1)    # (N, 9)
            node_preds  = node_logits.argmax(dim=1).tolist()   # (N,)  field type index
            node_scores = node_probs.max(dim=1).values.tolist()  # (N,) confidence

        # 1. Confidence boost using node activation norms (existing logic)
        fields = self._boost_confidence_by_activation(
            node_embs.numpy(), graph_data, fields
        )

        # 2. NODE_PRED: extract / reinforce fields from predicted node types
        fields = self._apply_node_predictions(
            node_preds, node_scores, graph_data, fields
        )

        return {
            "fields": fields,
            "graph_embedding": graph_emb,
            "mode": "full",
            "node_predictions": {
                "preds":  node_preds,
                "scores": [round(s, 3) for s in node_scores],
                "types":  _FIELD_TYPES,
            },
            "processing_time_ms": int((time.time() - start) * 1000),
        }

    # ------------------------------------------------------------------
    # Lite heuristic inference (no torch-geometric)
    # ------------------------------------------------------------------

    def _lite_infer(
        self,
        node_features: np.ndarray,
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
        start: float,
    ) -> Dict[str, Any]:
        # Graph embedding = mean of node features
        graph_emb = node_features.mean(axis=0).tolist() if len(node_features) else [0.0] * _IN_FEATURES

        # Confidence boost for fields confirmed by spatial neighbours
        fields = self._lite_confidence_boost(node_features, graph_data, fields)

        return {
            "fields": fields,
            "graph_embedding": graph_emb,
            "mode": "lite",
            "processing_time_ms": int((time.time() - start) * 1000),
        }

    # ------------------------------------------------------------------
    # Confidence helpers
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # NODE_PRED: apply per-node field type predictions
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_node_predictions(
        node_preds: List[int],
        node_scores: List[float],
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Use the GAT's per-node field type predictions (NODE_PRED stage) to:
          1. Add new fields when the GNN finds a node type not caught by regex/LLM.
          2. Boost confidence when the GNN prediction agrees with an existing value.

        Only acts on non-"other" predictions with score > 0.55.
        """
        texts = graph_data.get("node_texts", [])
        if not texts:
            return fields

        # Collect best candidate node per field type (highest prediction score)
        best: Dict[str, Tuple[float, str]] = {}  # field_name → (score, text)
        for i, (pred_idx, score, text) in enumerate(zip(node_preds, node_scores, texts)):
            if pred_idx >= _N_FIELD_TYPES - 1:   # skip "other"
                continue
            fname = _FIELD_TYPES[pred_idx]
            if not text.strip():
                continue
            if fname not in best or score > best[fname][0]:
                best[fname] = (score, text.strip())

        for fname, (score, text) in best.items():
            if score < 0.55:
                continue

            if fname not in fields:
                # GNN found a field the regex/LLM missed
                fields[fname] = {
                    "raw_value":         text,
                    "normalized_value":  text,
                    "confidence_score":  round(float(score) * 0.85, 4),
                    "extraction_method": "gnn_node_pred",
                }
            else:
                # Reinforce if GNN text overlaps with existing value
                existing = (
                    fields[fname].get("normalized_value")
                    or fields[fname].get("raw_value")
                    or ""
                ).lower().strip()
                if text.lower() in existing or existing[:8] in text.lower():
                    fields[fname]["confidence_score"] = min(
                        float(fields[fname].get("confidence_score", 0.8))
                        + 0.08 * float(score),
                        1.0,
                    )
                    # Only upgrade method if not already set to a higher-quality source
                    if fields[fname].get("extraction_method") not in (
                        "agent_learned", "llm"
                    ):
                        fields[fname]["extraction_method"] = "gnn_node_pred"

        return fields

    def _boost_confidence_by_activation(
        self,
        node_embs: np.ndarray,
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Nodes with high L2 activation (= high attention in the graph) near
        an extracted field value get that field's confidence boosted.
        """
        norms    = np.linalg.norm(node_embs, axis=1)           # (N,)
        texts    = graph_data.get("node_texts", [])
        sem_types = graph_data.get("semantic_types", [])

        if not texts:
            return fields

        norm_max = norms.max() + 1e-9

        for field_name, field_data in fields.items():
            val = (field_data.get("normalized_value") or "").lower().strip()
            if not val:
                continue
            # Find nodes whose text overlaps with the extracted value
            for i, (text, sem) in enumerate(zip(texts, sem_types)):
                if val[:8] in text.lower():
                    boost = 0.05 * float(norms[i] / norm_max)
                    field_data["confidence_score"] = min(
                        float(field_data.get("confidence_score", 0.8)) + boost, 1.0
                    )
                    if field_data.get("extraction_method") != "agent_learned":
                        field_data["extraction_method"] = "gnn"
                    break

        return fields

    def _lite_confidence_boost(
        self,
        node_features: np.ndarray,
        graph_data: Dict[str, Any],
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Lite mode: boost amount/date fields if corroborating nodes exist."""
        sem_types = graph_data.get("semantic_types", [])
        has_amount = "amount" in sem_types
        has_date   = "date"   in sem_types

        for fname, fdata in fields.items():
            method = fdata.get("extraction_method", "")
            if method == "agent_learned":
                continue
            if fname in ("total_amount", "subtotal", "tax_amount") and has_amount:
                fdata["confidence_score"] = min(float(fdata.get("confidence_score", 0.8)) + 0.05, 1.0)
                fdata["extraction_method"] = "gnn_lite"
            elif fname in ("invoice_date", "due_date") and has_date:
                fdata["confidence_score"] = min(float(fdata.get("confidence_score", 0.8)) + 0.03, 1.0)
                fdata["extraction_method"] = "gnn_lite"

        return fields

    # ------------------------------------------------------------------
    # Passthrough (no graph data)
    # ------------------------------------------------------------------

    @staticmethod
    def _passthrough(fields: Dict[str, Any], start: float) -> Dict[str, Any]:
        return {
            "fields": fields,
            "graph_embedding": [],
            "mode": "passthrough",
            "processing_time_ms": int((time.time() - start) * 1000),
        }

    # ------------------------------------------------------------------
    # Fine-tune from user corrections
    # ------------------------------------------------------------------

    def retrain_from_corrections(
        self,
        training_examples: List[Dict[str, Any]],
        n_epochs: int = 5,
        lr: float = 1e-3,
    ) -> Dict[str, Any]:
        """
        Fine-tune the GAT using validated invoice graphs.

        Args:
            training_examples: list of dicts, each with:
                - graph_data : output of GraphBuilder.build()
                - corrections: {field_name: {"original": str, "corrected": str}}
                                — fields the user changed
                - validated  : {field_name: str}
                                — fields the user accepted without change

        Returns:
            {"mode": str, "n_examples": int, "avg_loss": float or None}
        """
        if not training_examples:
            return {"mode": self._mode, "n_examples": 0, "avg_loss": None}

        if self._mode != "full":
            print(f"[GNNService] retrain_from_corrections: mode={self._mode}, skipping weight update")
            return {"mode": self._mode, "n_examples": len(training_examples), "avg_loss": None}

        # ── Build training tensors ────────────────────────────────────
        self._model.train()
        optimiser = torch.optim.Adam(self._model.parameters(), lr=lr)
        total_loss = 0.0
        n_steps = 0

        for ex in training_examples:
            graph_data = ex.get("graph_data", {})
            corrections = ex.get("corrections", {})     # corrected fields
            validated   = ex.get("validated", {})       # accepted fields

            node_features = graph_data.get("node_features")
            edge_index    = graph_data.get("edge_index")
            node_texts    = graph_data.get("node_texts", [])
            sem_types     = graph_data.get("semantic_types", [])

            if node_features is None or len(node_features) == 0:
                continue

            x  = torch.tensor(node_features, dtype=torch.float)
            ei = torch.tensor(edge_index, dtype=torch.long) if edge_index is not None and len(edge_index) else torch.zeros((2, 0), dtype=torch.long)

            # For each correction, build a contrastive signal:
            # — nodes matching the WRONG value should have lower activation norm
            # — nodes matching the CORRECT value should have higher activation norm
            # We use a simple margin loss on L2 norms of node embeddings.
            loss = torch.tensor(0.0, requires_grad=True)
            has_signal = False

            for epoch in range(n_epochs):
                optimiser.zero_grad()
                node_embs = self._model(x, ei)  # (N, out)
                norms = node_embs.norm(dim=1)   # (N,)

                epoch_loss = torch.tensor(0.0)

                for field_name, corr in corrections.items():
                    orig = (corr.get("original") or "").lower()[:8]
                    corrected = (corr.get("corrected") or "").lower()[:8]
                    if not orig or not corrected:
                        continue

                    wrong_idxs   = [i for i, t in enumerate(node_texts) if orig     in t.lower()]
                    correct_idxs = [i for i, t in enumerate(node_texts) if corrected in t.lower()]

                    if wrong_idxs and correct_idxs:
                        wrong_norm   = norms[wrong_idxs].mean()
                        correct_norm = norms[correct_idxs].mean()
                        # Margin loss: correct nodes should activate MORE than wrong nodes
                        margin = torch.tensor(0.1)
                        epoch_loss = epoch_loss + torch.clamp(wrong_norm - correct_norm + margin, min=0.0)
                        has_signal = True

                # Regularisation: high-confidence validated nodes should stay activated
                for field_name, val in validated.items():
                    v = (val or "").lower()[:8]
                    if not v:
                        continue
                    val_idxs = [i for i, t in enumerate(node_texts) if v in t.lower()]
                    if val_idxs:
                        # Keep norms reasonably high (>0.5) — L1 penalty on deviation from 0.8
                        val_norms = norms[val_idxs].mean()
                        epoch_loss = epoch_loss + 0.1 * torch.abs(val_norms - 0.8)
                        has_signal = True

                if has_signal and epoch_loss.requires_grad:
                    epoch_loss.backward()
                    optimiser.step()
                    total_loss += float(epoch_loss.detach())
                    n_steps += 1

        self._model.eval()

        if n_steps > 0:
            self.save_weights()
            avg_loss = total_loss / n_steps
            print(f"[GNNService] retrain_from_corrections: {len(training_examples)} examples, {n_steps} steps, avg_loss={avg_loss:.4f}")
        else:
            avg_loss = None
            print(f"[GNNService] retrain_from_corrections: no gradient signal found in {len(training_examples)} examples")

        return {
            "mode": self._mode,
            "n_examples": len(training_examples),
            "avg_loss": avg_loss,
        }

    # ------------------------------------------------------------------
    # Save weights (called after fine-tuning)
    # ------------------------------------------------------------------

    def save_weights(self) -> None:
        if self._model is None:
            return
        os.makedirs(os.path.dirname(_MODEL_PATH), exist_ok=True)
        torch.save(self._model.state_dict(), _MODEL_PATH)


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_gnn_service: Optional[GNNService] = None


def get_gnn_service() -> GNNService:
    global _gnn_service
    if _gnn_service is None:
        _gnn_service = GNNService()
    return _gnn_service
