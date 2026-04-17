-- ============================================================
-- MIGRATION: Fix disconnected tables
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Fixes:
--   1. invoices.source_invoice_id column was missing (FK existed, column didn't)
--   2. invoice_clusters → cluster_agents: add FK on cluster_id
--   3. extraction_rules → cluster_agents: add cluster_id for cluster-specific rules
--   4. extracted_fields → extraction_rules: add rule_id for traceability
-- ============================================================


-- ── Fix 1: Add missing source_invoice_id column ──────────────────────────────
-- The FK constraint was declared but the column never existed.
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS source_invoice_id UUID
    REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source_invoice_id
    ON public.invoices(source_invoice_id);


-- ── Fix 2: Connect invoice_clusters → cluster_agents ─────────────────────────
-- cluster_agents is the parent registry; invoice_clusters references it.
-- Without this FK, a cluster_id in invoice_clusters could point to a
-- cluster_agents row that doesn't exist (or was deleted).
ALTER TABLE public.invoice_clusters
    ADD CONSTRAINT invoice_clusters_cluster_agent_fkey
    FOREIGN KEY (cluster_id)
    REFERENCES public.cluster_agents(cluster_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
-- DEFERRABLE so the backend can insert cluster_agents and invoice_clusters
-- in the same transaction without ordering constraints.


-- ── Fix 3: Add cluster_id to extraction_rules ────────────────────────────────
-- NULL  = global rule (applies to all invoices)
-- SET   = cluster-specific rule (only used for invoices in that cluster)
--
-- This closes the gap between the ML learning loop and the extraction layer:
-- when a cluster agent learns a correction pattern it can promote it into
-- a concrete extraction_rule row, which extraction_service.py will pick up
-- on the next invoice from that cluster.
ALTER TABLE public.extraction_rules
    ADD COLUMN IF NOT EXISTS cluster_id INTEGER
    REFERENCES public.cluster_agents(cluster_id)
    ON DELETE CASCADE;

ALTER TABLE public.extraction_rules
    ADD COLUMN IF NOT EXISTS match_value TEXT;
-- match_value stores the exact string a cluster-learned rule should match,
-- complementing the regex pattern for "known-good value" rules.

CREATE INDEX IF NOT EXISTS idx_extraction_rules_cluster_id
    ON public.extraction_rules(cluster_id);

CREATE INDEX IF NOT EXISTS idx_extraction_rules_field_cluster
    ON public.extraction_rules(field_name, cluster_id);


-- ── Fix 4: Add rule_id to extracted_fields ───────────────────────────────────
-- Traceability: every extracted value now records which extraction_rules row
-- produced it. NULL = extracted by LLM / GNN / agent (no DB rule row).
ALTER TABLE public.extracted_fields
    ADD COLUMN IF NOT EXISTS rule_id UUID
    REFERENCES public.extraction_rules(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_extracted_fields_rule_id
    ON public.extracted_fields(rule_id);


-- ── RLS: allow service role to write cluster-specific rules ──────────────────
-- The existing policy only allows SELECT for authenticated users.
-- Backend (service role) needs INSERT/UPDATE to sync learned patterns.
DROP POLICY IF EXISTS "Service can manage extraction rules" ON extraction_rules;
CREATE POLICY "Service can manage extraction rules" ON extraction_rules
    FOR ALL USING (auth.uid() IS NOT NULL);
-- Note: the service role key bypasses RLS entirely, so this policy only
-- affects anon/authenticated client calls.


-- ── Helpful view: rule accuracy ──────────────────────────────────────────────
-- Shows how many times each rule was used and what fraction were corrected.
CREATE OR REPLACE VIEW public.rule_accuracy AS
SELECT
    er.id                                               AS rule_id,
    er.field_name,
    er.rule_type,
    er.cluster_id,
    er.pattern,
    COUNT(ef.id)                                        AS times_used,
    COUNT(ef.id) FILTER (WHERE ef.is_validated = TRUE)  AS times_validated,
    COUNT(ef.id) FILTER (
        WHERE ef.is_validated = TRUE
          AND ef.validated_value IS NOT NULL
          AND lower(ef.validated_value) != lower(coalesce(ef.normalized_value, ef.raw_value, ''))
    )                                                   AS times_corrected,
    ROUND(
        1.0 - COUNT(ef.id) FILTER (
            WHERE ef.is_validated = TRUE
              AND ef.validated_value IS NOT NULL
              AND lower(ef.validated_value) != lower(coalesce(ef.normalized_value, ef.raw_value, ''))
        )::NUMERIC
        / NULLIF(COUNT(ef.id) FILTER (WHERE ef.is_validated = TRUE), 0),
        4
    )                                                   AS accuracy
FROM public.extraction_rules er
LEFT JOIN public.extracted_fields ef ON ef.rule_id = er.id
GROUP BY er.id, er.field_name, er.rule_type, er.cluster_id, er.pattern;

-- ============================================================
-- DONE
-- ============================================================
