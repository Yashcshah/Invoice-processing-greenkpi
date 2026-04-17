-- ============================================================
-- Green KPI Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Requires: existing base schema (supabase_schema.sql) already applied
-- ============================================================

-- Enable pgvector extension for graph embeddings (if not already enabled)
-- If this line fails your Supabase plan doesn't include it — remove the
-- graph_embedding column below and it will still work.
CREATE EXTENSION IF NOT EXISTS vector;

-- Create green_kpi schema
CREATE SCHEMA IF NOT EXISTS green_kpi;

-- ============================================================
-- 1. GREEN KPI INVOICES
-- High-level invoice record linked to the source invoice
-- ============================================================
CREATE TABLE IF NOT EXISTS green_kpi.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_invoice_id UUID UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    file_path TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN (
        'pending', 'preprocessing', 'ocr_complete', 'llm_processed',
        'graph_built', 'gnn_processed', 'validated', 'completed',
        'needs_review', 'failed'
    )),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. GREEN KPI INVOICE DATA
-- Normalized extracted fields + sustainability metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS green_kpi.invoice_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    green_kpi_invoice_id UUID NOT NULL UNIQUE REFERENCES green_kpi.invoices(id) ON DELETE CASCADE,

    -- Core extracted fields
    vendor_name TEXT,
    invoice_number TEXT,
    invoice_date DATE,
    due_date DATE,
    subtotal FLOAT,
    tax_amount FLOAT,
    total_amount FLOAT,
    currency TEXT DEFAULT 'AUD',

    -- Structured data
    line_items JSONB DEFAULT '[]',            -- [{description, qty, unit_price, total, sustainability_tag}]
    sustainability_tags JSONB DEFAULT '[]',   -- ["renewable_energy", "carbon_offset", ...]
    compliance_flags JSONB DEFAULT '{}',      -- {gst_valid: bool, qbcc_applicable: bool, retention_applicable: bool}

    -- ML outputs
    confidence_score FLOAT,
    graph_embedding JSONB DEFAULT '[]',       -- 128-dim float array (GAT mean-pool output)
    extraction_method TEXT DEFAULT 'regex',   -- regex | llm | gnn | agent_learned

    -- LLM tracing
    llm_prompt TEXT,
    llm_response JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. GREEN KPI CORRECTIONS
-- Per-field correction history for continuous learning
-- ============================================================
CREATE TABLE IF NOT EXISTS green_kpi.corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    green_kpi_invoice_id UUID NOT NULL REFERENCES green_kpi.invoices(id) ON DELETE CASCADE,
    source_invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    original_value TEXT,
    corrected_value TEXT NOT NULL,
    correction_source TEXT NOT NULL DEFAULT 'user' CHECK (correction_source IN ('user', 'llm', 'gnn', 'rule')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. GREEN KPI PROCESSING LOGS
-- Per-stage audit trail: stage, status, duration, metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS green_kpi.processing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    green_kpi_invoice_id UUID NOT NULL REFERENCES green_kpi.invoices(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,        -- preprocess | ocr | llm | graph | gnn | validate | store
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'skipped', 'error')),
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_gkpi_invoices_source ON green_kpi.invoices(source_invoice_id);
CREATE INDEX IF NOT EXISTS idx_gkpi_invoices_uploaded_by ON green_kpi.invoices(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_gkpi_invoices_status ON green_kpi.invoices(processing_status);
CREATE INDEX IF NOT EXISTS idx_gkpi_invoice_data_gkpi_id ON green_kpi.invoice_data(green_kpi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_gkpi_corrections_gkpi_id ON green_kpi.corrections(green_kpi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_gkpi_logs_gkpi_id ON green_kpi.processing_logs(green_kpi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_gkpi_invoice_data_vendor ON green_kpi.invoice_data(vendor_name);
CREATE INDEX IF NOT EXISTS idx_gkpi_invoice_data_tags ON green_kpi.invoice_data USING GIN (sustainability_tags);

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE green_kpi.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE green_kpi.invoice_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE green_kpi.corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE green_kpi.processing_logs ENABLE ROW LEVEL SECURITY;

-- Users see their own records
CREATE POLICY "Users can manage their green_kpi invoices" ON green_kpi.invoices
    FOR ALL USING (uploaded_by = auth.uid());

CREATE POLICY "Users can view their green_kpi invoice data" ON green_kpi.invoice_data
    FOR ALL USING (
        green_kpi_invoice_id IN (
            SELECT id FROM green_kpi.invoices WHERE uploaded_by = auth.uid()
        )
    );

CREATE POLICY "Users can manage their green_kpi corrections" ON green_kpi.corrections
    FOR ALL USING (
        green_kpi_invoice_id IN (
            SELECT id FROM green_kpi.invoices WHERE uploaded_by = auth.uid()
        )
    );

CREATE POLICY "Users can view their green_kpi logs" ON green_kpi.processing_logs
    FOR SELECT USING (
        green_kpi_invoice_id IN (
            SELECT id FROM green_kpi.invoices WHERE uploaded_by = auth.uid()
        )
    );

-- ============================================================
-- 7. GRANT SCHEMA ACCESS TO AUTHENTICATED USERS
-- Required for Supabase PostgREST to expose the schema
-- ============================================================
GRANT USAGE ON SCHEMA green_kpi TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA green_kpi TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA green_kpi TO authenticated;

-- ============================================================
-- 8. ADD SCHEMA TO SUPABASE API (run in Supabase dashboard)
-- Go to: Settings → API → Extra Search Path → add "green_kpi"
-- ============================================================

-- ============================================================
-- DONE!
-- ============================================================
