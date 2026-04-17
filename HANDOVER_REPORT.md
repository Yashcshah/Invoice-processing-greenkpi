# Project Handover Report
**Project:** InvoiceAI — Automated Invoice Processing System
**Submitted by:** Yash Shah
**Date:** April 2026
**Submission type:** Academic Project Handover

---

## 1. Project Overview

This report documents the design, development, and delivery of InvoiceAI — an end-to-end automated invoice processing system built using modern AI and full-stack web technologies. The system was built to address a real-world challenge faced by businesses that process large volumes of supplier invoices manually: extracting structured data from unstructured documents, validating it against compliance rules, and continuously improving accuracy through user feedback.

The project went through seven development iterations (v0.1 through v0.7), each adding meaningful capability on top of the previous version. By the final version, the system combines traditional OCR with a multimodal large language model, a Graph Neural Network, and a cluster-based machine learning agent — all working together in a single automated pipeline.

---

## 2. Problem Statement

Manual invoice processing is slow, error-prone, and expensive. A single accounts team in a mid-sized construction or utilities company might receive hundreds of invoices per week in varying formats — PDFs, scanned images, emailed attachments — from dozens of vendors. Extracting fields like totals, GST amounts, vendor names, and line items by hand introduces human error and delays payment cycles.

Beyond data extraction, Australian businesses face specific compliance obligations: GST must be correctly applied at 10%, construction companies need to track QBCC licensing obligations, and retention clauses in progress payment invoices must be identified and flagged.

InvoiceAI was built to solve all of these problems in a single integrated platform.

---

## 3. System Architecture

The system follows a three-tier architecture: a React frontend, a FastAPI backend, and Supabase as the database, authentication, and file storage layer.

```
Browser (React + Vite)
        │
        │  REST API  /  Supabase Realtime (WebSocket)
        ▼
FastAPI Backend (Python 3.11–3.13)
        │
        ├── Core Pipeline: Preprocess → OCR → Extract → Validate
        ├── Green KPI Pipeline: LLM → Graph → GNN → Compliance → Store
        └── ML Services: Cluster Agents · GAT · Extraction Rules
        │
        ▼
Supabase (PostgreSQL + Storage + Auth + Realtime)
        ├── public schema  (invoices, OCR results, extracted fields, clusters)
        └── green_kpi schema  (analytics, corrections, compliance, logs)
```

### 3.1 Processing Pipeline

Every invoice goes through two pipeline stages that run sequentially.

**Core pipeline** (synchronous, user-facing):
1. The uploaded file is downloaded from Supabase Storage
2. OpenCV preprocessing is applied (grayscale, deskew, denoise, adaptive binarization)
3. OCR is run via Tesseract (images) or PyMuPDF (PDFs). If Tesseract confidence falls below 60%, the system automatically calls the TrOCR model (`microsoft/trocr-large-printed`) via the HuggingFace Inference API as a fallback
4. The ML cluster agent assigns the invoice to a vendor cluster and applies any previously learned corrections
5. Regex extraction pulls structured fields from the OCR text
6. Results are saved to the database and the invoice status is updated

**Green KPI pipeline** (non-blocking background, runs after core):
1. Gemini 2.5 Flash receives the invoice image and OCR text and returns a structured JSON with fields, sustainability tags, and compliance hints
2. OCR word boxes are turned into a document graph (nodes, edges, node features)
3. A 2-layer Graph Attention Network classifies each node into one of nine field roles and refines extraction confidence
4. A validation service checks GST compliance, QBCC keywords, and retention clauses; sustainability tags are matched against a 13-item catalogue
5. All results are written to the `green_kpi` schema tables

If any stage in the Green KPI pipeline fails, it is caught silently and logged — the core invoice result is never affected.

---

## 4. Key Features Delivered

### 4.1 Intelligent OCR with Fallback

The system uses a two-tier OCR strategy. Tesseract handles the majority of invoices quickly and cheaply. When it returns low-confidence output — typically from blurry scans, low-contrast images, or unusual fonts — the system escalates automatically to a deep learning OCR model via the HuggingFace API. The switch is invisible to the user. The final OCR engine used is recorded alongside the result in the database for auditing.

### 4.2 ML Cluster Agents

Invoices from the same vendor tend to have the same layout and the same systematic extraction errors. The cluster agent system exploits this. TF-IDF text vectorization and KMeans clustering group invoices by vendor similarity. Each cluster maintains a learned corrections dictionary — a record of known wrong values and their correct replacements. When a new invoice from a known vendor cluster arrives, the agent checks its extracted values against this dictionary and auto-corrects any known mistakes before the result is saved.

This means that once a human user corrects a recurring error, the system never makes that same mistake again for that vendor.

### 4.3 Multimodal LLM Integration

Gemini 2.5 Flash is used as a second opinion layer on top of regex extraction. It receives the invoice image and the OCR text together, and returns a structured JSON response. The LLM's extracted values are merged with the regex results — whichever source has higher confidence for a given field wins.

The LLM also identifies sustainability indicators in the line item descriptions, which feeds the Green KPI analytics.

Importantly, the LLM improves over time without any model retraining. Every time a user corrects a field, the correction is stored in the database. On the next invoice, the five most recent corrections are injected into the Gemini prompt as few-shot examples. This prompt-based adaptation is the practical equivalent of fine-tuning for a hosted API.

### 4.4 Graph Neural Network Reasoning

The third layer of intelligence is a Graph Attention Network (GAT). After the document graph is built from OCR word boxes, the GAT processes each node and classifies it into one of nine field roles: vendor name, invoice number, invoice date, due date, total amount, subtotal, tax amount, line item, or other.

This serves two purposes. First, it catches fields that regex and LLM both missed — if the GAT is confident a node contains a total amount but no total was extracted yet, it adds that field. Second, it reinforces confidence on fields where all three sources agree.

The model runs in full mode when PyTorch and torch-geometric are installed, and falls back to a heuristic lite mode otherwise. Weights are stored in `ml_models/gat_model.pt` and are updated during Retrain.

### 4.5 Continuous Improvement Loop

The system's most important long-term property is that it gets better the more it is used. The feedback loop works as follows:

When a user corrects a field value in the UI, the correction is written to `green_kpi.corrections`. When Retrain is triggered from the dashboard:

- The cluster agents re-cluster all invoices and update their correction dictionaries
- The learned corrections are promoted into cluster-specific extraction rules in the database, so they apply on the next invoice even before the LLM or GNN stages run
- The GAT is fine-tuned using a contrastive margin loss: nodes that matched wrong values are penalised, nodes that matched correct values are reinforced
- The updated GAT weights are saved to disk

On the next invoice from the same vendor, all three mechanisms (rules, LLM shots, GAT) apply the learned knowledge simultaneously.

### 4.6 Green KPI Analytics

The Green KPI layer was added to address sustainability and compliance reporting needs for Australian businesses, particularly in the construction and utilities sectors.

**Sustainability tagging:** The system maintains a catalogue of 13 sustainability-related tags. Gemini identifies relevant tags from context, and a keyword scanner checks line item descriptions as a second pass. Tags are stored per invoice and aggregated on the dashboard.

**GST compliance:** The system verifies that the declared tax amount equals 10% of the subtotal within a defined tolerance. Non-compliant invoices are flagged in the compliance report.

**QBCC and retention detection:** The system checks vendor names and line item descriptions for construction-related keywords that may indicate QBCC licensing obligations, and detects retention or progress payment clauses that require separate tracking under Queensland building contracts.

### 4.7 Real-Time UI

The invoice detail page subscribes to Supabase Realtime via a WebSocket channel filtered to the specific invoice. Status changes (preprocessing, OCR running, extraction complete) are pushed to the UI instantly without polling. If the WebSocket connection fails, the app falls back to HTTP polling automatically and transparently.

---

## 5. Database Design

The database uses two PostgreSQL schemas within Supabase.

**Public schema** holds the operational tables: invoices, OCR results, extracted fields, line items, preprocessing steps, processing logs, invoice folders, invoice clusters, cluster agents, and extraction rules.

**green_kpi schema** holds the analytics layer: one invoice record per processed invoice, one data record per invoice containing all extracted fields and compliance flags, a corrections table that feeds the learning loop, and a processing_logs table that records timing and status for every pipeline stage.

Key design decisions:

- `extracted_fields.rule_id` links every extracted value back to the specific extraction rule that produced it, enabling per-rule accuracy tracking via the `rule_accuracy` view
- `invoice_clusters.cluster_id` is a foreign key to `cluster_agents`, enforcing referential integrity between the two ML tables
- `extraction_rules.cluster_id` allows rules to be scoped to a specific vendor cluster, so cluster-learned corrections are applied only where relevant
- All Green KPI tables use unique constraints on their linking columns to prevent duplicate processing records

Row Level Security is enabled on all public schema tables. Users can only see invoices they uploaded. The backend uses the service role key which bypasses RLS for all write operations.

---

## 6. Technology Decisions and Rationale

**FastAPI over Django/Flask:** FastAPI's async-first design was essential for the background pipeline. All five Green KPI stages run as non-blocking async tasks, allowing the API to respond immediately while processing continues.

**Supabase over raw Postgres:** Supabase provided auth, storage, row-level security, and real-time subscriptions out of the box. This significantly reduced infrastructure setup time and allowed the frontend to subscribe directly to database changes.

**Gemini 2.5 Flash over GPT-4:** Gemini's multimodal support allowed both the image and the OCR text to be sent in a single API call. The flash variant provides a good balance of capability and latency for a per-invoice call pattern.

**GAT over simpler GNN architectures:** Attention-based graph neural networks are well-suited to document understanding because they can learn which neighbouring nodes are most relevant when classifying a given node. A standard GCN would treat all neighbours equally, which is not appropriate for invoice layouts where proximity and semantic similarity have varying importance.

**TF-IDF + KMeans over deep clustering:** The cluster agent system needed to run quickly and incrementally on CPU without GPU resources. TF-IDF + KMeans is fast, interpretable, and works well for grouping invoices by vendor text patterns — the dominant source of layout variation.

---

## 7. Setup and Deployment

### Prerequisites
- Python 3.11–3.13
- Node.js 18+
- Tesseract OCR installed
- Supabase project

### Environment Variables (backend/.env)
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
GEMINI_API_KEY=          # Gemini 2.5 Flash (free tier available)
HF_TOKEN=                # HuggingFace token (for TrOCR fallback, optional)
GREEN_KPI_ENABLED=true
LLM_ENABLED=true
GNN_ENABLED=true
```

### Database Setup
Run the following SQL files in Supabase SQL Editor in this order:
1. `backend/supabase_schema.sql`
2. `backend/green_kpi_schema.sql`
3. `backend/schema_connections_migration.sql`

Then go to Supabase → Integrations → Data API → Settings and add `green_kpi` to both the Exposed Schemas and Extra Search Path fields.

### Running Locally
```bash
# Backend
cd backend
python -m venv venv && .\venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload-dir app

# Frontend (separate terminal)
cd frontend
npm install && npm run dev
```

### Optional: Full GNN Mode
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install torch-geometric
```
Restart the backend. It detects the libraries automatically and switches from lite to full GAT mode.

---

## 8. Testing and Validation

The system was validated end-to-end across all major functional areas. The following areas were confirmed working:

- File upload, storage, and initial DB record creation
- Preprocessing (grayscale, deskew, denoise, binarize)
- Tesseract OCR and PyMuPDF PDF extraction with word box output
- TrOCR fallback trigger at the 60% confidence threshold
- Regex extraction for all nine field types
- Inline field editing and validation with `validated_value` persistence
- ML cluster assignment and learned correction application
- Retrain flow (clusters, extraction rules, GAT fine-tune)
- Gemini LLM integration with few-shot correction injection
- Document graph construction with all four edge types (spatial, semantic, hierarchical, logical)
- GAT node prediction and confidence reinforcement
- All five Green KPI pipeline stages
- GST, QBCC, and retention compliance checks
- Sustainability tag extraction and dashboard display
- Supabase Realtime status subscription with polling fallback
- All three database schema files and their connection constraints
- Feature flag degradation (disabling LLM/GNN/Green KPI individually without crashes)

---

## 9. Known Limitations and Future Work

**GAT training data:** The GAT model starts with random weights. Its full value is realised after several retrains with real correction data. In a fresh deployment, the model runs but the NODE_PRED head predictions are not meaningfully useful until enough labelled examples have been accumulated through use.

**TrOCR latency:** The HuggingFace Inference API adds 3–8 seconds to OCR processing when the fallback triggers. This is acceptable for batch processing but may be noticeable in interactive use. Self-hosting the model would remove this dependency.

**Gemini API cost:** The free tier of Gemini API has rate limits. High-volume deployments should plan for API costs or implement a request queue with retries.

**Cluster cold start:** Clustering requires at least two invoices with OCR text before the first retrain can run. This is handled gracefully — the system processes invoices without cluster assignment until enough data exists.

**LLM adaptation is prompt-based, not weight-based:** The few-shot correction injection is an effective and practical mechanism, but it is not as persistent as true fine-tuning. Corrections older than the five most recent may not influence Gemini's output. For production use, a larger correction window or a retrieval-based approach (selecting the most similar past corrections for each invoice) would be an improvement.

---

## 10. File Structure Summary

```
invoice-processing/
├── .gitignore
├── README.md
├── HANDOVER_REPORT.md
├── frontend/
│   └── src/
│       ├── pages/          Dashboard, Upload, Invoices, InvoiceDetail
│       ├── components/     Layout (sidebar + header)
│       └── lib/            supabase.js client
├── backend/
│   ├── app/
│   │   ├── main.py         FastAPI app entry point
│   │   ├── config.py       Settings + feature flags
│   │   ├── routers/        invoices, processing, extraction, folders, learning, green_kpi
│   │   └── services/       All business logic services
│   ├── ml_models/          Auto-created; stores .pkl and .pt model files (git-ignored)
│   ├── supabase_schema.sql
│   ├── green_kpi_schema.sql
│   ├── schema_connections_migration.sql
│   └── requirements.txt
└── UPDATES.md
```

---

## 11. Summary

InvoiceAI delivers a complete, production-ready invoice processing system that goes significantly beyond basic OCR and extraction. The system combines four distinct AI layers — rule-based extraction, an LLM, a GNN, and ML cluster agents — in a coordinated pipeline where each layer improves upon the last and all four learn from user feedback over time.

The Green KPI layer addresses real Australian compliance requirements and provides actionable sustainability analytics. The real-time UI keeps users informed without manual refreshing. The architecture is modular — each AI stage can be disabled independently via feature flags without breaking the rest of the system.

All features described in this report have been implemented, tested, and confirmed working as documented.

---

*Report prepared by Yash Shah — April 2026*
