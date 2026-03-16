-- ============================================================
-- Invoice Processing System - Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. ORGANIZATION MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, organization_id)
);

-- ============================================================
-- 3. INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT,
    file_type TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
        'uploaded', 'preprocessing', 'preprocessed',
        'ocr_processing', 'ocr_complete',
        'extraction_processing', 'extraction_complete',
        'validated', 'exported', 'failed'
    )),
    upload_source TEXT DEFAULT 'web',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ============================================================
-- 4. OCR RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS ocr_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    ocr_engine TEXT NOT NULL,
    engine_version TEXT,
    raw_text TEXT,
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    word_boxes JSONB DEFAULT '[]',
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. EXTRACTED FIELDS
-- ============================================================
CREATE TABLE IF NOT EXISTS extracted_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    raw_value TEXT,
    normalized_value TEXT,
    extraction_method TEXT,
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    is_validated BOOLEAN NOT NULL DEFAULT FALSE,
    validated_value TEXT,
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. LINE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_number INTEGER,
    description TEXT,
    quantity FLOAT,
    unit_price FLOAT,
    total_price FLOAT,
    extraction_method TEXT,
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. PREPROCESSING STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS preprocessing_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    step_name TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    parameters JSONB DEFAULT '{}',
    success BOOLEAN NOT NULL DEFAULT TRUE,
    processing_time_ms INTEGER,
    quality_metrics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. PROCESSING LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS processing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    log_level TEXT NOT NULL DEFAULT 'info' CHECK (log_level IN ('debug', 'info', 'warning', 'error')),
    component TEXT,
    action TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. EXTRACTION RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS extraction_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    field_name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    rule_type TEXT NOT NULL DEFAULT 'regex' CHECK (rule_type IN ('regex', 'keyword', 'position')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. RPC FUNCTION: create_organization_with_owner
-- Called by Signup.jsx when user creates an organization
-- ============================================================
CREATE OR REPLACE FUNCTION create_organization_with_owner(
    org_name TEXT,
    owner_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    org_id UUID;
BEGIN
    -- Create the organization
    INSERT INTO organizations (name, owner_id)
    VALUES (org_name, owner_id)
    RETURNING id INTO org_id;

    -- Add the owner as a member
    INSERT INTO organization_members (user_id, organization_id, role, is_active)
    VALUES (owner_id, org_id, 'owner', TRUE);

    RETURN org_id;
END;
$$;

-- ============================================================
-- 11. INDEXES (for query performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_uploaded_by ON invoices(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_results_invoice_id ON ocr_results(invoice_id);
CREATE INDEX IF NOT EXISTS idx_extracted_fields_invoice_id ON extracted_fields(invoice_id);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice_id ON line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_preprocessing_steps_invoice_id ON preprocessing_steps(invoice_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_invoice_id ON processing_logs(invoice_id);

-- ============================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE preprocessing_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_rules ENABLE ROW LEVEL SECURITY;

-- Organizations: users can see their own organizations
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        owner_id = auth.uid() OR
        id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND is_active = TRUE)
    );

CREATE POLICY "Users can insert their own organizations" ON organizations
    FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Organization members: users can see members of their org
CREATE POLICY "Users can view org members" ON organization_members
    FOR SELECT USING (
        user_id = auth.uid() OR
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

CREATE POLICY "Users can insert themselves as members" ON organization_members
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Invoices: users can see their own invoices
CREATE POLICY "Users can view their invoices" ON invoices
    FOR SELECT USING (uploaded_by = auth.uid());

CREATE POLICY "Users can insert their invoices" ON invoices
    FOR INSERT WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can update their invoices" ON invoices
    FOR UPDATE USING (uploaded_by = auth.uid());

CREATE POLICY "Users can delete their invoices" ON invoices
    FOR DELETE USING (uploaded_by = auth.uid());

-- OCR results: users can see results for their invoices
CREATE POLICY "Users can view OCR results for their invoices" ON ocr_results
    FOR ALL USING (
        invoice_id IN (SELECT id FROM invoices WHERE uploaded_by = auth.uid())
    );

-- Extracted fields: users can see fields for their invoices
CREATE POLICY "Users can manage fields for their invoices" ON extracted_fields
    FOR ALL USING (
        invoice_id IN (SELECT id FROM invoices WHERE uploaded_by = auth.uid())
    );

-- Line items: users can see line items for their invoices
CREATE POLICY "Users can manage line items for their invoices" ON line_items
    FOR ALL USING (
        invoice_id IN (SELECT id FROM invoices WHERE uploaded_by = auth.uid())
    );

-- Preprocessing steps: users can see steps for their invoices
CREATE POLICY "Users can view preprocessing steps for their invoices" ON preprocessing_steps
    FOR ALL USING (
        invoice_id IN (SELECT id FROM invoices WHERE uploaded_by = auth.uid())
    );

-- Processing logs: users can see logs for their invoices
CREATE POLICY "Users can view processing logs for their invoices" ON processing_logs
    FOR ALL USING (
        invoice_id IN (SELECT id FROM invoices WHERE uploaded_by = auth.uid())
    );

-- Extraction rules: all authenticated users can read rules
CREATE POLICY "Authenticated users can view extraction rules" ON extraction_rules
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 13. STORAGE BUCKET + POLICIES
-- The bucket already exists. Run this to add the missing policies.
-- ============================================================

-- Ensure bucket exists (safe to re-run)
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices-raw', 'invoices-raw', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files to the bucket
CREATE POLICY "Authenticated users can upload invoices"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'invoices-raw');

-- Allow authenticated users to read/download their files
CREATE POLICY "Authenticated users can read invoices"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'invoices-raw');

-- Allow authenticated users to delete their files
CREATE POLICY "Authenticated users can delete invoices"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'invoices-raw');

-- Allow authenticated users to update files (needed for reprocessing)
CREATE POLICY "Authenticated users can update invoices"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'invoices-raw');

-- ============================================================
-- MIGRATION: Invoice folder classification
-- Run this block separately if schema was already applied above
-- ============================================================

-- User-created folders for invoice classification
CREATE TABLE IF NOT EXISTS invoice_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add folder columns to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES invoice_folders(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS suggested_folder_id UUID REFERENCES invoice_folders(id) ON DELETE SET NULL;

-- Indexes for fast folder filtering
CREATE INDEX IF NOT EXISTS idx_invoices_folder_id ON invoices(folder_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_name ON invoices(vendor_name);

-- RLS for invoice_folders
ALTER TABLE invoice_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their folders" ON invoice_folders
    FOR ALL USING (
        auth.uid() = created_by
        OR organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

-- ============================================================
-- DONE!
-- ============================================================
