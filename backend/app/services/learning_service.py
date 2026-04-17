"""
Learning Service
================
Reads user-validated field corrections from the DB, groups them by cluster,
and updates each cluster agent's learned patterns + accuracy stats.

Flow:
  1. User corrects an extracted field in the UI → stored in extracted_fields
     (is_validated=True, validated_value set).
  2. Call retrain_all() (on-demand or scheduled) to:
       a. Re-cluster all invoices (TF-IDF + KMeans on OCR text).
       b. For every cluster, compute field-level accuracy and store
          known corrections in cluster_agents.learned_patterns.
  3. When a new invoice is processed, assign_invoice_to_cluster() is called
     so the pipeline can immediately look up the cluster's learned patterns.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.services.clustering_service import get_clustering_service
from app.services.supabase_client import get_supabase_admin


class LearningService:

    def __init__(self) -> None:
        self._clustering = get_clustering_service()

    # ------------------------------------------------------------------
    # Full retrain
    # ------------------------------------------------------------------

    async def retrain_all(self) -> Dict[str, Any]:
        """
        Re-cluster every invoice and update all cluster agents.
        Safe to call at any time; skips gracefully if there is not enough data.
        """
        supabase = get_supabase_admin()

        # 1. Fetch all OCR texts
        ocr_rows = (
            supabase.table("ocr_results")
            .select("invoice_id, raw_text")
            .execute()
            .data
            or []
        )
        valid_rows = [r for r in ocr_rows if r.get("raw_text", "").strip()]

        if len(valid_rows) < 2:
            return {
                "status": "skipped",
                "reason": "need at least 2 invoices with OCR text to train",
            }

        texts = [r["raw_text"] for r in valid_rows]
        invoice_ids = [r["invoice_id"] for r in valid_rows]

        # 2. Retrain clustering model
        self._clustering.fit(texts)

        # 3. Assign every invoice to its new cluster
        for invoice_id, text in zip(invoice_ids, texts):
            pred = self._clustering.predict(text)
            supabase.table("invoice_clusters").upsert(
                {
                    "invoice_id": invoice_id,
                    "cluster_id": pred["cluster_id"],
                    "confidence": pred["confidence"],
                    "assigned_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="invoice_id",
            ).execute()

        # 4. Update each cluster agent from validated corrections
        clusters_updated = await self._update_all_cluster_agents()

        return {
            "status": "success",
            "invoices_clustered": len(invoice_ids),
            "clusters_updated": clusters_updated,
            "n_clusters": self._clustering.get_n_clusters(),
        }

    # ------------------------------------------------------------------
    # Single-invoice cluster assignment (called after every OCR run)
    # ------------------------------------------------------------------

    async def assign_invoice_to_cluster(
        self, invoice_id: str, ocr_text: str
    ) -> Dict[str, Any]:
        """
        Assign a newly processed invoice to its cluster.
        If the model is not yet trained, attempt a quick train first.
        """
        supabase = get_supabase_admin()

        if not self._clustering.is_trained:
            ocr_rows = (
                supabase.table("ocr_results")
                .select("raw_text")
                .execute()
                .data
                or []
            )
            texts = [r["raw_text"] for r in ocr_rows if r.get("raw_text", "").strip()]
            if len(texts) >= 2:
                self._clustering.fit(texts)

        pred = self._clustering.predict(ocr_text)

        supabase.table("invoice_clusters").upsert(
            {
                "invoice_id": invoice_id,
                "cluster_id": pred["cluster_id"],
                "confidence": pred["confidence"],
                "assigned_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="invoice_id",
        ).execute()

        return pred

    # ------------------------------------------------------------------
    # Pattern retrieval (called by AgentManager)
    # ------------------------------------------------------------------

    async def get_learned_patterns(self, cluster_id: int) -> Dict[str, Any]:
        """Return the learned_patterns dict for a cluster (empty if none)."""
        supabase = get_supabase_admin()
        result = (
            supabase.table("cluster_agents")
            .select("learned_patterns")
            .eq("cluster_id", cluster_id)
            .execute()
            .data
        )
        if result:
            return result[0].get("learned_patterns") or {}
        return {}

    # ------------------------------------------------------------------
    # Dashboard stats
    # ------------------------------------------------------------------

    async def get_stats(self) -> Dict[str, Any]:
        supabase = get_supabase_admin()
        agents = (
            supabase.table("cluster_agents").select("*").execute().data or []
        )

        if not agents:
            return {
                "is_trained": self._clustering.is_trained,
                "total_clusters": 0,
                "avg_accuracy": 0.0,
                "total_corrections": 0,
                "agents": [],
            }

        total_corrections = sum(a.get("correction_count", 0) for a in agents)
        avg_accuracy = sum(a.get("accuracy_score", 1.0) for a in agents) / len(agents)

        return {
            "is_trained": self._clustering.is_trained,
            "total_clusters": len(agents),
            "avg_accuracy": round(avg_accuracy * 100, 1),
            "total_corrections": total_corrections,
            "agents": sorted(
                [
                    {
                        "cluster_id": a["cluster_id"],
                        "cluster_label": a.get("cluster_label"),
                        "invoice_count": a.get("invoice_count", 0),
                        "accuracy_score": round(
                            a.get("accuracy_score", 1.0) * 100, 1
                        ),
                        "correction_count": a.get("correction_count", 0),
                        "last_trained_at": a.get("last_trained_at"),
                    }
                    for a in agents
                ],
                key=lambda x: x["invoice_count"],
                reverse=True,
            ),
        }

    # ------------------------------------------------------------------
    # Internal: update all cluster agents
    # ------------------------------------------------------------------

    async def _update_all_cluster_agents(self) -> int:
        supabase = get_supabase_admin()

        # Group invoice_ids by cluster
        assignments = (
            supabase.table("invoice_clusters")
            .select("invoice_id, cluster_id")
            .execute()
            .data
            or []
        )

        cluster_invoices: Dict[int, List[str]] = defaultdict(list)
        for row in assignments:
            cluster_invoices[row["cluster_id"]].append(row["invoice_id"])

        updated = 0
        for cluster_id, inv_ids in cluster_invoices.items():
            await self._update_cluster_agent(cluster_id, inv_ids)
            updated += 1

        return updated

    async def _update_cluster_agent(
        self, cluster_id: int, invoice_ids: List[str]
    ) -> None:
        """
        Analyse corrections for one cluster and persist learned patterns.

        learned_patterns shape:
        {
          "<field_name>": {
            "accuracy": float,           # correct / total validated
            "correction_count": int,
            "confirmation_count": int,
            "known_corrections": [       # last 20 unique wrong→right pairs
              {"extracted": str, "correct": str}
            ]
          }
        }
        """
        if not invoice_ids:
            return

        supabase = get_supabase_admin()

        # Fetch all validated fields for invoices in this cluster
        fields = (
            supabase.table("extracted_fields")
            .select(
                "field_name, normalized_value, raw_value, validated_value, is_validated"
            )
            .in_("invoice_id", invoice_ids)
            .eq("is_validated", True)
            .execute()
            .data
            or []
        )

        stats: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {"correct": 0, "incorrect": 0, "corrections": []}
        )

        for f in fields:
            fname = f["field_name"]
            extracted = (f.get("normalized_value") or f.get("raw_value") or "").strip()
            validated = (f.get("validated_value") or "").strip()

            if not validated:
                continue

            if validated.lower() != extracted.lower():
                stats[fname]["incorrect"] += 1
                # Deduplicate: only store unique wrong→right pairs
                pair = {"extracted": extracted, "correct": validated}
                if pair not in stats[fname]["corrections"]:
                    stats[fname]["corrections"].append(pair)
            else:
                stats[fname]["correct"] += 1

        learned_patterns: Dict[str, Any] = {}
        for fname, s in stats.items():
            total = s["correct"] + s["incorrect"]
            accuracy = s["correct"] / total if total else 1.0
            learned_patterns[fname] = {
                "accuracy": round(accuracy, 4),
                "correction_count": s["incorrect"],
                "confirmation_count": s["correct"],
                "known_corrections": s["corrections"][-20:],
            }

        total_corrections = sum(
            v["correction_count"] for v in learned_patterns.values()
        )
        avg_accuracy = (
            sum(v["accuracy"] for v in learned_patterns.values())
            / len(learned_patterns)
            if learned_patterns
            else 1.0
        )

        # Derive a cluster label from the most common vendor name in this cluster
        vendor_result = (
            supabase.table("invoices")
            .select("vendor_name")
            .in_("id", invoice_ids)
            .not_.is_("vendor_name", "null")
            .execute()
            .data
            or []
        )
        vendor_counts: Dict[str, int] = defaultdict(int)
        for row in vendor_result:
            v = (row.get("vendor_name") or "").strip()
            if v:
                vendor_counts[v] += 1
        cluster_label = (
            max(vendor_counts, key=vendor_counts.get) if vendor_counts else None
        )

        supabase.table("cluster_agents").upsert(
            {
                "cluster_id": cluster_id,
                "cluster_label": cluster_label,
                "invoice_count": len(invoice_ids),
                "correction_count": total_corrections,
                "accuracy_score": round(avg_accuracy, 4),
                "learned_patterns": learned_patterns,
                "last_trained_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="cluster_id",
        ).execute()

        # ── Sync learned corrections → extraction_rules ──────────────────────
        # For every known wrong→right correction pair, upsert a cluster-specific
        # extraction_rule row so extraction_service.py picks it up on the next
        # invoice from this cluster.  This closes the loop:
        #   corrections → cluster_agents.learned_patterns → extraction_rules → extracted_fields
        self._sync_cluster_rules(supabase, cluster_id, learned_patterns)


    # ------------------------------------------------------------------
    # Sync learned patterns → extraction_rules
    # ------------------------------------------------------------------

    @staticmethod
    def _sync_cluster_rules(
        supabase,
        cluster_id: int,
        learned_patterns: Dict[str, Any],
    ) -> None:
        """
        For each correction pair in learned_patterns, ensure a
        cluster-specific extraction_rule row exists in the DB.

        Uses upsert on (field_name, cluster_id, match_value) so re-running
        retrain is idempotent.
        """
        for field_name, pattern_data in learned_patterns.items():
            corrections: List[Dict] = pattern_data.get("known_corrections", [])
            for pair in corrections:
                correct_val = (pair.get("correct") or "").strip()
                if not correct_val:
                    continue

                # Build a regex that matches the correct value literally
                import re as _re
                escaped = _re.escape(correct_val)

                try:
                    # Check if this cluster+field+value rule already exists
                    existing = (
                        supabase.table("extraction_rules")
                        .select("id")
                        .eq("field_name", field_name)
                        .eq("cluster_id", cluster_id)
                        .eq("match_value", correct_val)
                        .execute()
                        .data
                    )
                    if existing:
                        continue  # already synced

                    supabase.table("extraction_rules").insert(
                        {
                            "field_name":  field_name,
                            "pattern":     escaped,
                            "rule_type":   "regex",
                            "match_value": correct_val,
                            "cluster_id":  cluster_id,
                            "is_active":   True,
                            "priority":    10,  # higher than default rules (priority 1)
                        }
                    ).execute()
                except Exception as exc:
                    # Rule sync is non-critical; never block retrain
                    print(f"[LearningService] _sync_cluster_rules error: {exc}")


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_learning_service: Optional[LearningService] = None


def get_learning_service() -> LearningService:
    global _learning_service
    if _learning_service is None:
        _learning_service = LearningService()
    return _learning_service
