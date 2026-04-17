"""
Graph Builder
=============
Constructs a document graph from OCR word boxes + LLM layout hints.

Nodes  — one per OCR text block (word / phrase)
Edges  — four types:
  spatial    : distance between bounding boxes ≤ threshold
  semantic   : cosine similarity of TF-IDF vectors ≥ threshold
  hierarchical: parent → child layout (block → line → word)
  logical    : QUANTITY → UNIT_PRICE → LINE_TOTAL chains

Node feature vector (F = 12 + N_semantic_types):
  [x_norm, y_norm, w_norm, h_norm,   # normalised bbox (4)
   aspect_ratio,                      # w/h              (1)
   text_len_norm,                     # char count / 100 (1)
   confidence,                        # OCR conf 0-1     (1)
   tfidf_0 … tfidf_4,                # top-5 TF-IDF     (5)
   semantic_type_onehot * 8]          # layout class     (8)

Total: 20 dims  (kept small so GAT stays fast on CPU)
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# TF-IDF is the only non-stdlib dep (already in requirements via scikit-learn)
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# Semantic type labels and their one-hot index
_SEMANTIC_TYPES = {
    "header": 0,
    "vendor": 1,
    "date": 2,
    "amount": 3,
    "line_item": 4,
    "tax": 5,
    "footer": 6,
    "unknown": 7,
}
_N_SEMANTIC = len(_SEMANTIC_TYPES)
_FEATURE_DIM = 12 + _N_SEMANTIC  # = 20


class GraphBuilder:
    """Build an invoice document graph ready for GNN inference."""

    def __init__(
        self,
        spatial_dist_thresh: float = 0.15,   # normalised page coords
        semantic_sim_thresh: float = 0.30,
    ) -> None:
        self.spatial_dist_thresh = spatial_dist_thresh
        self.semantic_sim_thresh = semantic_sim_thresh

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build(
        self,
        word_boxes: List[Dict[str, Any]],
        llm_output: Optional[Dict[str, Any]] = None,
        page_w: int = 2480,   # A4 @ 300 dpi
        page_h: int = 3508,
    ) -> Dict[str, Any]:
        """
        Build graph from OCR word boxes.

        Returns:
            {
              node_features: np.ndarray (N, 20),
              edge_index:    np.ndarray (2, E)  — COO format,
              edge_types:    List[str]  length E,
              node_texts:    List[str],
              n_nodes:       int,
              n_edges:       int,
              feature_dim:   int,
            }
        """
        if not word_boxes:
            return self._empty_graph()

        texts = [b.get("text", "") for b in word_boxes]
        layout_hints = self._parse_layout_hints(llm_output)

        # Assign semantic type per node
        semantic_types = self._assign_semantic_types(word_boxes, texts, layout_hints)

        # Build TF-IDF embeddings (top-5 dims)
        tfidf_mat = self._tfidf_features(texts)

        # Build node features
        node_feats = self._build_node_features(
            word_boxes, texts, semantic_types, tfidf_mat, page_w, page_h
        )

        # Build edges
        edge_index, edge_types = self._build_edges(
            word_boxes, texts, tfidf_mat, page_w, page_h
        )

        return {
            "node_features": node_feats,
            "edge_index": edge_index,
            "edge_types": edge_types,
            "node_texts": texts,
            "semantic_types": semantic_types,
            "n_nodes": len(word_boxes),
            "n_edges": edge_index.shape[1] if edge_index.size else 0,
            "feature_dim": _FEATURE_DIM,
        }

    # ------------------------------------------------------------------
    # Node features
    # ------------------------------------------------------------------

    def _build_node_features(
        self,
        boxes: List[Dict],
        texts: List[str],
        semantic_types: List[str],
        tfidf_mat: np.ndarray,
        page_w: int,
        page_h: int,
    ) -> np.ndarray:
        N = len(boxes)
        feats = np.zeros((N, _FEATURE_DIM), dtype=np.float32)

        for i, box in enumerate(boxes):
            x = box.get("x", 0) / page_w
            y = box.get("y", 0) / page_h
            w = box.get("width", 1) / page_w
            h = box.get("height", 1) / page_h
            asp = w / (h + 1e-6)
            tlen = min(len(texts[i]), 100) / 100.0
            conf = float(box.get("confidence", 0.8))

            feats[i, 0] = x
            feats[i, 1] = y
            feats[i, 2] = w
            feats[i, 3] = h
            feats[i, 4] = asp
            feats[i, 5] = tlen
            feats[i, 6] = conf

            # TF-IDF (5 dims)
            if tfidf_mat is not None and i < tfidf_mat.shape[0]:
                row = np.asarray(tfidf_mat[i].todense()).flatten()
                feats[i, 7:12] = row[:5]

            # Semantic type one-hot
            st_idx = _SEMANTIC_TYPES.get(semantic_types[i], _SEMANTIC_TYPES["unknown"])
            feats[i, 12 + st_idx] = 1.0

        return feats

    # ------------------------------------------------------------------
    # Edge construction
    # ------------------------------------------------------------------

    def _build_edges(
        self,
        boxes: List[Dict],
        texts: List[str],
        tfidf_mat: np.ndarray,
        page_w: int,
        page_h: int,
    ) -> Tuple[np.ndarray, List[str]]:
        src_list, dst_list, etype_list = [], [], []

        # Pre-compute centres
        centres = np.array(
            [
                [
                    (b.get("x", 0) + b.get("width", 0) / 2) / page_w,
                    (b.get("y", 0) + b.get("height", 0) / 2) / page_h,
                ]
                for b in boxes
            ],
            dtype=np.float32,
        )

        # Pre-compute TF-IDF cosine similarity matrix (sparse → dense, capped at 500 nodes)
        sim_mat = None
        if tfidf_mat is not None and len(boxes) <= 500:
            sim_mat = cosine_similarity(tfidf_mat)

        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                # --- Spatial edge ---
                dist = float(np.linalg.norm(centres[i] - centres[j]))
                if dist <= self.spatial_dist_thresh:
                    src_list += [i, j]
                    dst_list += [j, i]
                    etype_list += ["spatial", "spatial"]

                # --- Semantic edge ---
                if (
                    sim_mat is not None
                    and sim_mat[i, j] >= self.semantic_sim_thresh
                    and dist > self.spatial_dist_thresh  # don't double-count
                ):
                    src_list += [i, j]
                    dst_list += [j, i]
                    etype_list += ["semantic", "semantic"]

                # --- Hierarchical (same block/line) ---
                b_i = boxes[i]
                b_j = boxes[j]
                if b_i.get("block_num") == b_j.get("block_num") and b_i.get(
                    "block_num"
                ) is not None:
                    src_list += [i, j]
                    dst_list += [j, i]
                    etype_list += ["hierarchical", "hierarchical"]

        # --- Logical edges (QUANTITY → UNIT_PRICE → LINE_TOTAL chains) ------
        # These are directional edges encoding the financial structure of a row:
        #   qty_node → unit_price_node → line_total_node
        # and for summary rows:
        #   subtotal_node → tax_node → total_node
        logical_src, logical_dst = self._build_logical_edges(boxes, texts)
        for s, d in zip(logical_src, logical_dst):
            src_list += [s, d]      # bidirectional so GAT can propagate both ways
            dst_list += [d, s]
            etype_list += ["logical", "logical"]

        if not src_list:
            return np.zeros((2, 0), dtype=np.int64), []

        edge_index = np.array([src_list, dst_list], dtype=np.int64)
        return edge_index, etype_list

    # ------------------------------------------------------------------
    # Logical edge construction
    # ------------------------------------------------------------------

    # Keyword sets for logical role detection
    _QTY_KEYWORDS   = {"qty", "quantity", "units", "hrs", "hours", "days", "pcs", "pieces"}
    _PRICE_KEYWORDS = {"price", "rate", "unit", "each", "per", "cost"}
    _TOTAL_KEYWORDS = {"total", "amount", "subtotal", "sub-total", "sum", "line total"}
    _TAX_KEYWORDS   = {"gst", "tax", "vat", "bas"}
    _GRAND_KEYWORDS = {"grand total", "balance due", "amount due", "total due", "total payable"}

    @classmethod
    def _classify_logical_role(cls, text: str) -> Optional[str]:
        """Return the logical financial role of a node text, or None."""
        t = text.lower().strip()
        # Amount-like text (number)
        is_number = bool(re.search(r"\$?\s*\d[\d,]*\.?\d*", t))

        if any(k in t for k in cls._GRAND_KEYWORDS):
            return "grand_total"
        if any(k in t for k in cls._TAX_KEYWORDS):
            return "tax"
        if any(k in t for k in cls._TOTAL_KEYWORDS) and is_number:
            return "line_total"
        if any(k in t for k in cls._PRICE_KEYWORDS) and is_number:
            return "unit_price"
        if any(k in t for k in cls._QTY_KEYWORDS):
            return "quantity"
        # Pure number on a line → likely a quantity or price in context
        if re.fullmatch(r"[\$]?\s*\d[\d,]*\.?\d*", t):
            return "numeric"
        return None

    def _build_logical_edges(
        self,
        boxes: List[Dict],
        texts: List[str],
    ) -> Tuple[List[int], List[int]]:
        """
        Build logical edges encoding financial calculation chains:

          Line item rows (same line_num, left → right by x):
            QUANTITY → UNIT_PRICE → LINE_TOTAL

          Summary section (top → bottom by y position):
            SUBTOTAL → TAX → GRAND_TOTAL

        Returns (src_indices, dst_indices) — directional pairs (not yet doubled).
        """
        src_list: List[int] = []
        dst_list: List[int] = []

        # ── Line item chains ─────────────────────────────────────────────────
        # Group nodes by line_num; within each line sort left-to-right by x
        from collections import defaultdict
        lines: dict = defaultdict(list)
        for idx, (box, text) in enumerate(zip(boxes, texts)):
            ln = box.get("line_num")
            if ln is not None:
                lines[ln].append((idx, box.get("x", 0), text))

        for ln, nodes in lines.items():
            if len(nodes) < 2:
                continue
            # Sort left-to-right
            nodes_sorted = sorted(nodes, key=lambda n: n[1])
            roles = [self._classify_logical_role(n[2]) for n in nodes_sorted]

            # Find qty → unit_price → line_total ordering
            qty_idx = unit_idx = tot_idx = None
            for pos, (node_idx, _, _) in enumerate(nodes_sorted):
                r = roles[pos]
                if r == "quantity" and qty_idx is None:
                    qty_idx = node_idx
                elif r in ("unit_price", "numeric") and qty_idx is not None and unit_idx is None:
                    unit_idx = node_idx
                elif r in ("line_total", "numeric") and unit_idx is not None and tot_idx is None:
                    tot_idx = node_idx

            if qty_idx is not None and unit_idx is not None:
                src_list.append(qty_idx)
                dst_list.append(unit_idx)
            if unit_idx is not None and tot_idx is not None:
                src_list.append(unit_idx)
                dst_list.append(tot_idx)

        # ── Summary chain: SUBTOTAL → TAX → GRAND_TOTAL ──────────────────────
        # Find the summary nodes anywhere in the document and link top → bottom
        summary_nodes: List[Tuple[int, float, str]] = []  # (idx, y_norm, role)
        for idx, (box, text) in enumerate(zip(boxes, texts)):
            role = self._classify_logical_role(text)
            if role in ("tax", "grand_total", "line_total"):
                y_norm = box.get("y", 0)
                summary_nodes.append((idx, y_norm, role))

        # Sort by vertical position
        summary_nodes.sort(key=lambda n: n[1])

        subtotal_idx = tax_idx = grand_idx = None
        for node_idx, _, role in summary_nodes:
            if role == "line_total" and subtotal_idx is None:
                subtotal_idx = node_idx
            elif role == "tax" and tax_idx is None:
                tax_idx = node_idx
            elif role == "grand_total" and grand_idx is None:
                grand_idx = node_idx

        if subtotal_idx is not None and tax_idx is not None:
            src_list.append(subtotal_idx)
            dst_list.append(tax_idx)
        if tax_idx is not None and grand_idx is not None:
            src_list.append(tax_idx)
            dst_list.append(grand_idx)
        if subtotal_idx is not None and grand_idx is not None and tax_idx is None:
            # No tax node found — connect subtotal directly to grand total
            src_list.append(subtotal_idx)
            dst_list.append(grand_idx)

        return src_list, dst_list

    # ------------------------------------------------------------------
    # Semantic type assignment
    # ------------------------------------------------------------------

    def _assign_semantic_types(
        self,
        boxes: List[Dict],
        texts: List[str],
        layout_hints: Dict[str, Any],
    ) -> List[str]:
        """
        Assign a semantic type to every node.

        Priority order:
          1. LLM line-region hints (header_lines / line_item_lines / tax_lines / footer_lines)
          2. LLM field-value matches — if node text appears in an LLM-extracted
             field value, assign that field's semantic type  (LLM_EMB → FEAT bridge)
          3. Regex heuristics (dates, amounts, keywords)
        """
        field_value_types: Dict[str, str] = layout_hints.get("field_value_types", {})
        types: List[str] = []

        for i, (box, text) in enumerate(zip(boxes, texts)):
            line_num  = box.get("line_num", i)
            text_low  = text.lower().strip()

            # 1. Line-region layout hints
            if line_num in layout_hints.get("header_lines", set()):
                types.append("header")
            elif line_num in layout_hints.get("line_item_lines", set()):
                types.append("line_item")
            elif line_num in layout_hints.get("tax_lines", set()):
                types.append("tax")
            elif line_num in layout_hints.get("footer_lines", set()):
                types.append("footer")

            # 2. LLM field value match — bridges LLM span embeddings → node features
            elif field_value_types and text_low:
                matched_type: Optional[str] = None
                for fval, ftype in field_value_types.items():
                    # Partial-match: node text contained in field value or vice-versa
                    if len(fval) >= 3 and (text_low in fval or fval in text_low):
                        matched_type = ftype
                        break
                types.append(matched_type if matched_type else self._infer_semantic_type(text))

            # 3. Regex heuristics
            else:
                types.append(self._infer_semantic_type(text))

        return types

    @staticmethod
    def _infer_semantic_type(text: str) -> str:
        t = text.lower().strip()
        if re.search(r"\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}", t):
            return "date"
        if re.search(r"[$€£]?\s*\d[\d,]*\.?\d*", t):
            return "amount"
        if any(k in t for k in ("gst", "tax", "vat", "bas")):
            return "tax"
        if any(k in t for k in ("total", "subtotal", "balance", "due", "amount")):
            return "amount"
        if any(k in t for k in ("invoice", "bill", "receipt", "abn", "acn")):
            return "header"
        return "unknown"

    # ------------------------------------------------------------------
    # TF-IDF
    # ------------------------------------------------------------------

    @staticmethod
    def _tfidf_features(texts: List[str]):
        if not texts:
            return None
        clean = [t if t.strip() else "_" for t in texts]
        try:
            vec = TfidfVectorizer(max_features=5, min_df=1)
            return vec.fit_transform(clean)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Layout hint parsing
    # ------------------------------------------------------------------

    # Maps LLM field names → graph semantic types
    _FIELD_TO_SEMANTIC: Dict[str, str] = {
        "vendor_name":    "vendor",
        "total_amount":   "amount",
        "subtotal":       "amount",
        "tax_amount":     "tax",
        "invoice_date":   "date",
        "due_date":       "date",
        "invoice_number": "header",
    }

    @staticmethod
    def _parse_layout_hints(llm_output: Optional[Dict]) -> Dict[str, Any]:
        """
        Extract layout hints from LLM output.

        Returns a dict with:
          - Line-region sets (header_lines, line_item_lines, tax_lines, footer_lines)
          - field_value_types: {text_fragment_lower → semantic_type}
            derived from the LLM's actual field values — this bridges
            LLM_EMB → FEAT in the pipeline graph.
        """
        if not llm_output:
            return {}

        hints: Dict[str, Any] = {}

        # Line-level layout segment hints
        segs = llm_output.get("layout_segments", {})
        for k, v in segs.items():
            if isinstance(v, list):
                hints[k] = set(v)

        # Field value → semantic type — use LLM-identified field values
        # to tag specific node texts with the correct field role.
        # This converts LLM span knowledge into graph node features.
        fields = llm_output.get("fields", {})
        field_value_types: Dict[str, str] = {}
        for fname, sem_type in GraphBuilder._FIELD_TO_SEMANTIC.items():
            fdata = fields.get(fname) or {}
            val = (fdata.get("raw_value") or fdata.get("normalized_value") or "").strip()
            if val and len(val) >= 2:
                field_value_types[val.lower()] = sem_type

        hints["field_value_types"] = field_value_types
        return hints

    @staticmethod
    def _empty_graph() -> Dict[str, Any]:
        return {
            "node_features": np.zeros((0, _FEATURE_DIM), dtype=np.float32),
            "edge_index": np.zeros((2, 0), dtype=np.int64),
            "edge_types": [],
            "node_texts": [],
            "semantic_types": [],
            "n_nodes": 0,
            "n_edges": 0,
            "feature_dim": _FEATURE_DIM,
        }


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_graph_builder: Optional[GraphBuilder] = None


def get_graph_builder() -> GraphBuilder:
    global _graph_builder
    if _graph_builder is None:
        _graph_builder = GraphBuilder()
    return _graph_builder
