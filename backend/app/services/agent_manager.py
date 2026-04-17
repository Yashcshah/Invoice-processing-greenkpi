"""
Agent Manager
=============
Routes each invoice to the appropriate cluster agent and applies that
agent's learned corrections to the extraction results.

Usage in the processing pipeline:
  1. After OCR: agent_context = await agent_manager.get_agent_context(raw_text)
  2. After extraction: fields = agent_manager.apply_learned_patterns(fields, agent_context)
  3. Store agent_context["cluster_id"] for analytics.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.services.clustering_service import get_clustering_service
from app.services.learning_service import get_learning_service


class AgentManager:
    """
    Thin orchestration layer between the processing pipeline and the ML services.

    Responsibilities
    ----------------
    • Predict which cluster (= "agent") an invoice belongs to.
    • Fetch that agent's learned patterns from the DB.
    • Post-process extracted fields: if the system produced a value that was
      previously corrected by a user for this cluster, substitute the known-
      correct value and bump the confidence score.
    """

    def __init__(self) -> None:
        self._clustering = get_clustering_service()
        self._learning = get_learning_service()

    # ------------------------------------------------------------------
    # Step 1: get context after OCR
    # ------------------------------------------------------------------

    async def get_agent_context(self, ocr_text: str) -> Dict[str, Any]:
        """
        Return cluster assignment + learned patterns for the given OCR text.

        Shape:
            {
              cluster_id: int,
              confidence: float,
              is_trained: bool,
              learned_patterns: {field_name: {accuracy, known_corrections, ...}}
            }
        """
        cluster_info = self._clustering.predict(ocr_text)

        learned_patterns: Dict[str, Any] = {}
        if cluster_info["is_trained"]:
            learned_patterns = await self._learning.get_learned_patterns(
                cluster_info["cluster_id"]
            )

        return {**cluster_info, "learned_patterns": learned_patterns}

    # ------------------------------------------------------------------
    # Step 2: apply learned corrections after extraction
    # ------------------------------------------------------------------

    def apply_learned_patterns(
        self,
        fields: Dict[str, Any],
        agent_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Post-process extracted fields using the cluster agent's learned corrections.

        For each field:
        - If the extracted value exactly matches a previously corrected (wrong)
          value for this cluster, replace it with the known-correct value.
        - Mark the extraction_method as "agent_learned" so the UI can show it.
        - Boost confidence by 0.10 (capped at 1.0) to reflect the extra signal.

        Fields for which no corrections exist are returned unchanged.
        """
        learned_patterns: Dict[str, Any] = agent_context.get("learned_patterns", {})
        if not learned_patterns or not fields:
            return fields

        for field_name, pattern_data in learned_patterns.items():
            if field_name not in fields:
                continue

            known_corrections = pattern_data.get("known_corrections", [])
            if not known_corrections:
                continue

            field = fields[field_name]
            extracted_val = (
                field.get("normalized_value") or field.get("raw_value") or ""
            ).strip().lower()

            for correction in known_corrections:
                wrong = (correction.get("extracted") or "").strip().lower()
                right = (correction.get("correct") or "").strip()

                if wrong and right and wrong == extracted_val:
                    field["normalized_value"] = right
                    field["raw_value"] = right
                    field["confidence_score"] = min(
                        float(field.get("confidence_score", 0.8)) + 0.10, 1.0
                    )
                    field["extraction_method"] = "agent_learned"
                    break   # first matching correction wins

        return fields


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_agent_manager: Optional[AgentManager] = None


def get_agent_manager() -> AgentManager:
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
    return _agent_manager
