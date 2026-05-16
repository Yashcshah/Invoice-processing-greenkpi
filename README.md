# InvoiceAI — Automated Invoice Processing System

AI-powered invoice processing with OCR, TrOCR fallback, rule-based document-type classification, mode-aware multimodal LLM encoding (Gemini 2.5 Flash), Graph Neural Network reasoning with node-level field prediction, ML vendor cluster agents, automatic ABN + GST validation via the Australian Business Register, sustainability tagging, Australian compliance checks, and folder organisation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite · Tailwind CSS · React Router · Recharts · Lucide React · Supabase Realtime |
| Backend | Python 3.11–3.13 · FastAPI · Uvicorn |
| OCR | Tesseract · PyMuPDF (PDFs) · OpenCV (preprocessing) · TrOCR fallback (HF API) |
| Doc-type Classifier | Rule-based pre-classifier (OCR confidence + keywords + page count) |
| LLM | Gemini 2.5 Flash (multimodal) · 4 mode-aware prompt templates · few-shot correction injection |
| Graph / GNN | scikit-learn (graph features) · PyTorch + torch-geometric (GAT + NODE_PRED head, optional) |
| ML Clustering | TF-IDF + KMeans (vendor cluster agents) |
| ABN Validation | Australian Business Register (ABR) JSON API · local mod-89 checksum |
| Database / Auth / Storage | Supabase (PostgreSQL + RLS + Realtime + Storage) |

---

## Features

- **Upload invoices** — drag & drop PDF, PNG, JPG, TIFF (up to 10 MB)
- **OCR pipeline** — Tesseract for images, PyMuPDF direct extraction for PDFs; auto-falls back to TrOCR when Tesseract confidence < 60%
- **Document-type classifier** — rule-based pre-classifier runs immediately after OCR and assigns each invoice one of five labels that control how much the pipeline relies on Gemini vs regex/GNN
- **Mode-aware multimodal LLM** — Gemini 2.5 Flash uses a different prompt template per doc type: standard refinement, primary (trust image over OCR), fuel-specific fields, or cross-page reconciliation
- **LLM adaptation** — user corrections accumulate in DB and are injected as few-shot examples into every future Gemini prompt (TRAIN_LLM feedback arc)
- **Graph construction** — invoice OCR boxes become a document graph; LLM field assignments guide node semantic typing (LLM_EMB → FEAT bridge)
- **GNN reasoning** — 2-layer GAT with a NODE_PRED classification head (9 field types); runs in lite mode without PyTorch; skipped automatically for handwritten invoices
- **Node-level field prediction** — GAT classifies every graph node into a field type and extracts or reinforces field values from the highest-confidence nodes
- **ML cluster agents** — TF-IDF + KMeans groups invoices by vendor/format; each cluster learns from user corrections
- **Self-improving accuracy** — every correction trains the agent and fine-tunes the GAT; next invoice from the same vendor is extracted better automatically
- **Automatic ABN + GST validation** — every invoice automatically checks ABN format, mod-89 checksum, and optionally calls the ABR API to confirm active registration and GST status
- **Supabase Realtime** — invoice status updates pushed to the UI via WebSocket; polling fallback if Realtime is unavailable
- **Green KPI** — sustainability tag extraction, GST reconciliation, ABN compliance, QBCC and retention checks, spend tracking
- **Folder organisation** — create folders (e.g. "AGL", "Utilities") and the AI suggests the right folder per invoice
- **Inline field editing** — correct any extracted value directly in the UI; corrections feed the learning loop
- **Confidence scores** — horizontal bar chart per field; GNN/LLM/agent-corrected fields show boosted confidence
- **Doc-type pills** — Invoice Detail shows a colour-coded pill next to the status badge; Invoices list has filter chips by document type
- **Dashboard** — animated stats, ML Agents panel, Green KPI panel (spend, tags, compliance, confidence trend chart)
- **List + Grid views** — Invoices page has filter chips (All / Needs Review / GST Issues / doc type) and a List/Grid segmented control

---

## Full Pipeline

```
Invoice Upload
      │
      ▼
Supabase Storage (invoices-raw bucket)
      │
      ▼
Preprocessing  (grayscale · deskew · denoise · binarize)
      │
      ▼
OCR  (Tesseract / PyMuPDF)
      │  └─ confidence < 60%? → TrOCR fallback (HF API)
      ▼
Step 2.5: Document-Type Classifier  ← NEW
      │  Rule-based: page count · OCR confidence · fuel keywords · noise patterns
      │  Labels: standard_structured | multi_page | fuel_statement
      │          low_quality_scanned | handwritten_or_very_noisy
      │  → stores doc_type_label on invoice
      │  → selects LLM mode: llm_augment | llm_multipage | llm_fuel | llm_primary
      ▼
ML Cluster Agent  (TF-IDF + KMeans → assign vendor cluster → apply learned corrections)
      │
      ▼
Regex Extraction  (invoice # · date · total · vendor · line items)
      │
      ▼
Multimodal LLM  (Gemini 2.5 Flash — mode-aware prompt)
      │  llm_augment   → refines regex/GNN output (standard)
      │  llm_primary   → Gemini is primary source; image trusted over OCR (low-quality/handwritten)
      │  llm_fuel      → standard fields + fuel_details (litres, rate, rego, odometer…)
      │  llm_multipage → cross-page total reconciliation; OCR limit 10k chars
      │
      │  Field merge logic:
      │    llm_primary  → Gemini always wins (overrides regex/GNN)
      │    llm_augment  → Gemini wins only when confidence is higher
      │
      ├─ LLM field values → node semantic types (LLM_EMB → FEAT bridge)
      ▼
Graph Construction  (OCR boxes → nodes; LLM field matches guide semantic type one-hots; 4 edge types)
      │  [SKIPPED for handwritten_or_very_noisy — word-boxes unreliable]
      ▼
GNN Reasoning  (GAT 2-layer → NODE_PRED classification head → per-node field type prediction)
      │  [SKIPPED for handwritten_or_very_noisy — graph features unreliable]
      │  └─ node predictions → extract missing fields + reinforce existing values
      ▼
Consistency Layer  (GST reconciliation · date normalisation · QBCC · retention · tag catalogue)
      │
      ▼
ABN + GST Validation
      │  • ABN format check (11 digits)
      │  • ABN mod-89 checksum
      │  • GST math check (tax ≈ subtotal × 10 %)
      │  └─ ABR API lookup if ABR_GUID set → confirms Active + GST-registered
      ▼
Store → invoices (+ doc_type_label) + extracted_fields + line_items (core tables)
      │   → green_kpi.invoices + invoice_data + processing_logs (analytics layer)
      │   └─ compliance_flags includes ABN + GST results
      │
      ▼
User corrects fields in InvoiceDetail  (Supabase Realtime status updates)
      │
      ├─ → green_kpi.corrections (TRAIN_LLM: injected into next Gemini prompt as few-shot)
      ├─ → GAT fine-tune on Retrain  (TRAIN_GNN: contrastive margin loss on corrected nodes)
      └─ → cluster_agents.learned_patterns updated on Retrain  (TRAIN_CLUST)
```

---

## Document-Type Classifier

The classifier (`doc_type_classifier.py`) runs as **Step 2.5** — immediately after OCR, before the ML cluster agent. It assigns every invoice one of five labels using deterministic rules, with no ML model required.

### The five labels

| Label | Condition | LLM mode | GNN |
|-------|-----------|----------|-----|
| `standard_structured` | Default — clean single-page | `llm_augment` | high priority |
| `multi_page` | `page_count > 1` | `llm_multipage` | medium priority |
| `fuel_statement` | Fuel keywords in OCR text | `llm_fuel` | medium priority |
| `low_quality_scanned` | OCR confidence < 60% or TrOCR used | `llm_primary` | low priority |
| `handwritten_or_very_noisy` | Confidence < 40% + sparse + garble patterns | `llm_primary` | **skipped** |

Priority order: handwritten → low_quality → fuel → multi_page → standard.

### Fuel keywords detected
`fuel · diesel · petrol · unleaded · litres · l/100km · bowser · lpg · pump price · refuel · fuel card · fleet fuel · bulk fuel · avgas · biodiesel`

### Fuel-specific fields extracted (llm_fuel mode)
When an invoice is classified as `fuel_statement`, Gemini is prompted to extract a `fuel_details` object in addition to standard fields:

| Field | Description |
|-------|-------------|
| `fuel_litres` | Volume in litres |
| `fuel_rate_per_litre` | Price per litre |
| `fuel_fuel_type` | diesel / petrol / unleaded / lpg / avgas / biodiesel |
| `fuel_vehicle_rego` | Vehicle registration number |
| `fuel_odometer_km` | Odometer reading at fill |
| `fuel_pump_number` | Pump / bowser number |
| `fuel_card_number` | Fuel card number |

These are stored as individual extracted fields (prefixed `fuel_`) so future cluster agents can learn corrections specific to fuel statements.

### DB column
```sql
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_type_label TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_doc_type_label
  ON public.invoices (doc_type_label);
```

---

## Architecture Diagrams

### Multimodal LLM + Graph/GNN layer

```
OCR Output ──────────────────────────────────────────────► Graph Builder
(word_boxes + raw_text)                                         │
                                                                │
Doc-Type Classifier ──► llm_mode selection                     │
                              │                                 │
Invoice Image ──► Gemini 2.5 Flash (mode-aware prompt)         │
OCR Text ───────►  (vision + text)  ──► Structured JSON        │
                                     ──► LLM Field Values ──► Node Semantic Types
                                     ──► Layout Segments ──► (LLM_EMB → FEAT bridge)
                                     ──► fuel_details (fuel mode only)
                                                                │
                                                          Node Features (20-dim)
                                                          [bbox · TF-IDF · sem-type]
                                                                │
                                                    4 Edge Types (spatial · semantic
                                                    · hierarchical · logical)
                                                                │
                                                        GAT 2-layer
                                                        [skipped: handwritten]
                                                                │
                                                    NODE_PRED head (9 field types)
                                                    VENDOR_NAME · TOTAL · LINE_QTY
                                                    INVOICE_DATE · TAX_AMOUNT · ...
                                                                │
                                                    Consistency Layer
                                                    (GST · QBCC · dates)
                                                                │
                                                    ABN + GST Validation
                                                    (format · checksum · ABR API)
                                                                │
                                                      Final Field Values
```

### Feedback / retraining loop

```
Supabase DB ──► Processing Pipeline ──► invoice_data, processing_logs
                      ▲
                      │
             ┌────────┴────────┐
             │                 │
     TRAIN_GNN           TRAIN_CLUST
  (GAT fine-tune)    (TF-IDF + KMeans)
             │                 │
             └────────┬────────┘
                      │
              green_kpi.corrections
                      ▲
                      │
             User edits fields in React UI
                      ▲
                      │
              invoice_data (InvoiceDetail)
                      ▲
                      │
        TRAIN_LLM: correction shots injected
        into next Gemini prompt automatically
```

---

## Project Structure

```
invoice-processing/
├── .gitignore
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx        # Stats · ML Agents · Green KPI · Recent invoices
│   │   │   ├── Upload.jsx           # Drag-and-drop upload
│   │   │   ├── Invoices.jsx         # List/Grid · status + doc-type filter chips · folder sidebar
│   │   │   └── InvoiceDetail.jsx    # Fields · DocTypePill · Green KPI strip · Realtime
│   │   ├── components/
│   │   │   ├── Layout.jsx           # Sidebar + top bar
│   │   │   ├── charts/
│   │   │   │   ├── FieldConfidenceMiniChart.jsx  # Horizontal bar chart per field
│   │   │   │   ├── ConfidenceTrendChart.jsx
│   │   │   │   ├── KpiDoughnutChart.jsx
│   │   │   │   └── ClusterAccuracyChart.jsx
│   │   │   └── ui/
│   │   │       ├── StatusPill.jsx   # Colour-coded status badge
│   │   │       ├── ConfidenceBar.jsx
│   │   │       └── KpiChip.jsx
│   │   └── lib/
│   │       └── supabase.js
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app + routers
│   │   ├── config.py                # Settings from .env (incl. ABR_GUID, GEMINI_API_KEY)
│   │   ├── routers/
│   │   │   ├── invoices.py          # Invoice CRUD + folder assign
│   │   │   ├── processing.py        # Full pipeline: OCR → DocType → LLM(mode) → GNN → Store
│   │   │   ├── extraction.py        # Field validation + green_kpi.corrections write
│   │   │   ├── folders.py           # Folder CRUD
│   │   │   ├── learning.py          # ML cluster agent + GAT retrain endpoints
│   │   │   └── green_kpi.py         # Green KPI endpoints
│   │   └── services/
│   │       ├── doc_type_classifier.py  # Rule-based doc-type classifier (5 labels) ← NEW
│   │       ├── ocr_service.py          # Tesseract + PyMuPDF + TrOCR fallback
│   │       ├── preprocessing_service.py
│   │       ├── extraction_service.py
│   │       ├── clustering_service.py   # TF-IDF + KMeans
│   │       ├── learning_service.py     # Correction learning + retraining
│   │       ├── agent_manager.py        # Cluster routing + correction application
│   │       ├── llm_service.py          # Gemini 2.5 Flash · 4 mode-aware prompts · few-shot
│   │       ├── graph_builder.py        # Document graph + LLM_EMB→FEAT node typing
│   │       ├── gnn_service.py          # 2-layer GAT + NODE_PRED head + fine-tune
│   │       ├── validation_service.py   # GST · QBCC · sustainability tags
│   │       ├── abn_service.py          # ABN checksum + ABR API lookup
│   │       ├── green_kpi_service.py    # green_kpi.* DB writes + stats
│   │       └── supabase_client.py
│   ├── ml_models/                   # Auto-created; .pkl + .pt model files (git-ignored)
│   ├── supabase_schema.sql          # Base schema — run first
│   ├── green_kpi_schema.sql         # Green KPI schema — run second
│   └── requirements.txt
│
└── README.md
```

---

## Prerequisites

- Node.js 18+
- Python 3.11, 3.12, or 3.13
- Tesseract OCR installed
- Supabase account
- Gemini API key (free at https://aistudio.google.com/apikey) — optional but recommended
- HuggingFace token — optional, only needed for TrOCR fallback
- ABR GUID — optional, enables live ABN lookup (free at https://api.abn.business.gov.au/)

---

## Quick Start

### Step 1 — Install Tesseract OCR

**Windows:**
1. Download from https://github.com/UB-Mannheim/tesseract/wiki
2. Install to the default path: `C:\Program Files\Tesseract-OCR\`

**Ubuntu/Debian:**
```bash
sudo apt-get install tesseract-ocr poppler-utils
```

**macOS:**
```bash
brew install tesseract poppler
```

---

### Step 2 — Apply the database schema

In your Supabase project → **SQL Editor**, run these **two files in order**:

1. `backend/supabase_schema.sql` — base tables, RLS, storage bucket, RPC functions
2. `backend/green_kpi_schema.sql` — Green KPI analytics tables (`green_kpi` schema)

Then also run this to create the remaining tables and columns used by the pipeline:

```sql
-- Cluster assignments
CREATE TABLE IF NOT EXISTS public.invoice_clusters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  cluster_id   integer NOT NULL,
  confidence   float,
  assigned_at  timestamptz DEFAULT now(),
  UNIQUE (invoice_id)
);

-- Line items extracted from invoices
CREATE TABLE IF NOT EXISTS public.line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  line_number     integer,
  description     text,
  quantity        float,
  unit_price      float,
  total_price     float,
  tax_amount      float,
  confidence_score float,
  created_at      timestamptz DEFAULT now()
);

-- Learned correction rules per cluster
CREATE TABLE IF NOT EXISTS public.extraction_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id  integer,
  field_name  text NOT NULL,
  rule_type   text,
  pattern     text,
  replacement text,
  priority    integer DEFAULT 0,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Document-type label column (v0.9)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_type_label TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_doc_type_label
  ON public.invoices (doc_type_label);
```

Then go to **Supabase → Settings → API → Extra Search Path** and add `green_kpi`.

---

### Step 3 — Backend setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
.\venv\Scripts\activate        # Windows
source venv/bin/activate       # macOS / Linux

# Install dependencies
pip install -r requirements.txt
```

Create `backend/.env`:
```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# API
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=True

# OCR (Windows path — adjust for macOS/Linux)
TESSERACT_PATH=C:/Program Files/Tesseract-OCR/tesseract.exe
OCR_ENGINE=tesseract
POPPLER_PATH=C:/Program Files/poppler-25.12.0/Library/bin

# Green KPI — Gemini API (free tier available)
GEMINI_API_KEY=your-gemini-key

# ABN Lookup — Australian Business Register (optional)
# Register free at: https://api.abn.business.gov.au/
# Leave blank to skip live ABN lookup (local checksum + GST math still runs)
ABR_GUID=your-abr-guid

# TrOCR fallback — HuggingFace token (optional)
# Only used when Tesseract confidence < 60%
HF_TOKEN=your-hf-token

# Feature flags (set to false to disable a stage)
GREEN_KPI_ENABLED=true
LLM_ENABLED=true
GNN_ENABLED=true
```

Start the server:
```bash
uvicorn app.main:app --reload --port 8000
# API at http://localhost:8000
# Docs at http://localhost:8000/docs
```

---

### Step 4 — Frontend setup

Open a new terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Start the dev server:
```bash
npm run dev
# App at http://localhost:5173
```

---

### Step 5 — Optional: full GNN mode (PyTorch + GAT)

Without this the system runs in **GNN-lite mode** (heuristic graph features) which still improves accuracy. For the full 2-layer Graph Attention Network with NODE_PRED:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install torch-geometric
```

Restart the backend — it detects PyTorch automatically and switches to full GAT mode.

---

## Using the App

1. **Sign up** at `/signup` — creates your account and organisation
2. **Upload** — go to Upload, drag & drop invoice files
3. **Process** — click the ↻ button on any invoice to run the full pipeline
4. **Review** — open the invoice to see extracted fields with confidence bars; the **doc-type pill** next to the status badge tells you which processing mode was used
5. **Green KPI strip** — compliance chips: GST validity, ABN status, QBCC, retention, sustainability tags
6. **Filter by doc type** — use the *Fuel / Multi-page / Low-quality / Handwritten* chips in the Invoices list to see invoices by type
7. **Organise** — create folders in the Invoices sidebar; the AI suggests the right folder per vendor
8. **Retrain agents** — after correcting a few invoices, click **Retrain** on the Dashboard

---

## Green KPI

The Green KPI layer runs automatically after every invoice is processed. No user action required.

### Sustainability tagging
Tags extracted by Gemini from line item descriptions and vendor context:

`renewable_energy` · `solar` · `wind` · `carbon_offset` · `recycled_materials` ·
`low_emissions` · `green_building` · `water_conservation` · `waste_management` ·
`electric_vehicle` · `sustainable_packaging` · `energy_efficiency` · `other_green`

### Australian compliance checks

| Check | Logic |
|-------|-------|
| **GST math** | Validates tax_amount ≈ subtotal × 10% (±2%); infers tax if missing |
| **ABN format** | Strips spaces/dashes, checks 11 digits |
| **ABN checksum** | Weighted mod-89 algorithm — catches transcription errors |
| **ABN active** | ABR API: confirms AbnStatus = "Active" (requires ABR_GUID) |
| **GST registered** | ABR API: confirms supplier holds a valid GST registration (requires ABR_GUID) |
| **QBCC** | Flags building/construction invoices (Queensland licencing context) |
| **Retention** | Detects progress-claim / retention clauses in line item descriptions |

### ABN Badge colours (Invoice Detail → Green KPI strip)

| Colour | Meaning |
|--------|---------|
| 🟢 Green | ABN active + GST-registered (confirmed via ABR API) |
| 🔵 Blue | ABN format + checksum valid (local only — no ABR_GUID configured) |
| 🟠 Orange | ABN checksum failed |
| 🔴 Red | ABN format invalid or supplier not GST-registered |

### Dashboard Green KPI panel
- Total spend (AUD)
- Average extraction confidence %
- GST compliance %
- Total corrections learned
- Top sustainability tags with counts
- Status breakdown: completed / needs review / failed
- Daily confidence trend chart (last 30 days)

### Green KPI API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/green-kpi/stats` | Aggregate stats for the dashboard |
| `GET` | `/api/green-kpi/confidence-trend` | Daily avg confidence (last N days) |
| `GET` | `/api/green-kpi/invoices` | List with sustainability metadata |
| `GET` | `/api/green-kpi/invoices/{id}` | Full detail + processing stages |
| `POST` | `/api/green-kpi/corrections` | Submit correction (feeds learning loop) |
| `GET` | `/api/green-kpi/compliance/{id}` | GST / ABN / QBCC / retention report |

---

## ABN + GST Validation

The `abn_service.py` module runs automatically as **Stage 4.5** of the pipeline (after Consistency validation, before storing to the DB). It requires no user action.

### What always runs (no API key needed)
1. **ABN extraction** — reads `abn` / `supplier_abn` / `vendor_abn` from extracted fields
2. **Format check** — confirms 11 digits after stripping spaces and dashes
3. **Checksum** — weighted mod-89 algorithm (same as the ATO standard)
4. **GST math** — `tax_amount ≈ subtotal × 10%` within ±2%

### What runs with ABR_GUID
5. **Live ABR lookup** — calls `abr.business.gov.au` JSON endpoint
6. **Active status** — confirms `AbnStatus == "Active"`
7. **GST registration** — checks `Gst` date field is populated (means registered)
8. **Entity name** — returns the registered business name for display

### Getting an ABR GUID (free)
1. Go to https://api.abn.business.gov.au/
2. Register with your email
3. Add the GUID to `backend/.env` as `ABR_GUID=your-guid`

Results are stored in `green_kpi.invoice_data.compliance_flags` and shown instantly in the Green KPI strip on the Invoice Detail page.

---

## ML Cluster Agents

Invoices are automatically grouped into clusters by OCR text similarity (TF-IDF + KMeans). Each cluster has a dedicated agent that learns from user corrections.

> **Important:** The vendor TF-IDF + KMeans clusters are separate from the doc-type classifier. Every invoice has both a `cluster_id` (vendor/format cluster for ML learning) and a `doc_type_label` (routing label for LLM/GNN trust). They work together — the cluster agent learns vendor-specific corrections; the doc-type label governs how much Gemini is trusted.

### How it works

```
Invoice processed
      │
      ▼
  Cluster assigned (TF-IDF cosine distance to KMeans centroid)
      │
      ▼
  Agent Manager checks learned_patterns for this cluster
      │
      ├─ Known correction exists for extracted value?
      │       YES → replace with correct value, boost confidence
      │       NO  → use raw extraction result
      │
      ▼
  User corrects field → stored in extracted_fields (validated_value)
      │
      ▼
  Click Retrain → LearningService:
    1. Re-clusters all invoices
    2. Computes field accuracy per cluster
    3. Updates cluster_agents.learned_patterns
    4. Fine-tunes GAT weights from correction graph examples
      │
      ▼
  Next invoice from same vendor → auto-corrected
```

### ML Agents API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/learning/retrain` | Trigger full retrain: clusters + GAT fine-tune (background) |
| `GET`  | `/api/learning/stats` | Cluster stats for the dashboard |
| `POST` | `/api/learning/assign/{id}` | Re-assign one invoice to its cluster |

---

## GNN Details

### Node features (20-dim)

| Dims | Feature | Source |
|------|---------|--------|
| 0–3 | Normalised bounding box (x, y, w, h) | OCR |
| 4 | Aspect ratio | OCR |
| 5 | Text length (normalised) | OCR |
| 6 | OCR confidence | Tesseract / PyMuPDF |
| 7–11 | TF-IDF top-5 | scikit-learn |
| 12–19 | Semantic type one-hot (8 classes) | **LLM field values + layout hints** |

The 8 semantic type classes are: `header · vendor · date · amount · line_item · tax · footer · unknown`

### NODE_PRED classification head

The GAT's output layer feeds into a `Linear(32 → 9)` classifier that predicts the field role of every node:

| Class | Field |
|-------|-------|
| 0 | vendor_name |
| 1 | invoice_number |
| 2 | invoice_date |
| 3 | due_date |
| 4 | total_amount |
| 5 | subtotal |
| 6 | tax_amount |
| 7 | line_item |
| 8 | other |

Predictions with confidence > 55% either create new fields (when regex/LLM missed them) or boost the confidence of matching existing values.

> GNN is automatically **skipped** for `handwritten_or_very_noisy` invoices — graph features derived from noisy word-boxes are unreliable and would hurt accuracy.

### GAT fine-tuning from corrections

When **Retrain** is clicked:
1. All validated corrections are fetched from the DB
2. Each corrected invoice's OCR is re-built into a document graph
3. A contrastive margin loss is computed — nodes matching wrong values are penalised, nodes matching the corrected values are reinforced
4. Gradient descent runs for 5 epochs; updated weights are saved to `ml_models/gat_model.pt`

---

## LLM Mode Routing

The Gemini prompt template is selected automatically based on the `doc_type_label` assigned at Step 2.5.

| doc_type_label | LLM mode | Prompt focus | OCR chars |
|---|---|---|---|
| `standard_structured` | `llm_augment` | Refines regex/GNN; Gemini wins on higher confidence | 6,000 |
| `multi_page` | `llm_multipage` | Cross-page total reconciliation; all pages concatenated | **10,000** |
| `fuel_statement` | `llm_fuel` | Standard fields + `fuel_details` schema | 6,000 |
| `low_quality_scanned` | `llm_primary` | Gemini is primary; image trusted over OCR text | 6,000 |
| `handwritten_or_very_noisy` | `llm_primary` | Same as low-quality; GNN skipped | 6,000 |

### Field merge rules
- **`llm_primary`** — Gemini wins unconditionally for every field (overrides regex and GNN output)
- **`llm_augment`** — Gemini wins only when its `confidence_score` is higher than the existing value

---

## LLM Adaptation (TRAIN_LLM)

The Gemini API does not expose LoRA fine-tuning directly. Instead, the system uses **prompt-based adaptation**:

1. Every time a user corrects a field, the correction is written to `green_kpi.corrections`
2. On the next invoice processed, `encode_invoice()` fetches the 5 most recent unique corrections and appends them to the Gemini prompt as few-shot examples:

```
PREVIOUS CORRECTIONS — patterns learned from user feedback:
  vendor_name: was "AGL Energy Pty" → correct is "AGL Energy"
  invoice_date: was "2024-01-15" → correct is "2024-01-16"
```

3. Gemini incorporates this context and adjusts its extraction accordingly

The more corrections accumulate, the better Gemini extracts — without any model weight updates.

---

## TrOCR Fallback

When Tesseract's average word confidence is below **60%** (blurry scans, handwriting, poor image quality), the pipeline automatically:

1. Calls Microsoft TrOCR (`microsoft/trocr-large-printed`) via the HuggingFace Inference API
2. Uses the TrOCR text output for all downstream extraction
3. Keeps Tesseract's spatial word boxes (for graph construction)
4. Reports `ocr_engine: trocr` in the OCR result — which also triggers `low_quality_scanned` or `handwritten_or_very_noisy` classification at Step 2.5

Requires `HF_TOKEN` in `.env`. If not set, Tesseract output is used regardless of confidence.

---

## Supabase Realtime

`InvoiceDetail` subscribes to `postgres_changes` on the `invoices` table (filtered to the current invoice ID) via a Supabase WebSocket channel. Status changes (preprocessing → ocr_processing → extraction_complete) are pushed instantly to the UI without polling. If the channel errors, it falls back to 2.5s HTTP polling automatically.

`Invoices` also subscribes to `postgres_changes` on the `invoices` table so newly uploaded or just-processed invoices appear instantly without a manual refresh.

---

## Full API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/invoices` | List invoices (filter by `status`, `folder_id`) |
| `GET` | `/api/invoices/{id}` | Invoice + OCR + fields + line items |
| `DELETE` | `/api/invoices/{id}` | Delete invoice and storage file |
| `PATCH` | `/api/invoices/{id}/folder` | Assign or unassign a folder |
| `POST` | `/api/processing/process` | Trigger full pipeline (doc-type classify + ABN check included) |
| `GET` | `/api/processing/status/{id}` | Poll processing status |
| `POST` | `/api/processing/reset-stuck` | Reset preprocessing/OCR/extraction stuck invoices to failed |
| `POST` | `/api/extraction/validate` | Save validated field values + write corrections |
| `GET` | `/api/folders` | List all folders |
| `POST` | `/api/folders` | Create a folder |
| `DELETE` | `/api/folders/{id}` | Delete a folder |
| `POST` | `/api/learning/retrain` | Retrain ML cluster agents + GAT fine-tune |
| `GET` | `/api/learning/stats` | Cluster agent statistics |
| `POST` | `/api/learning/assign/{id}` | Re-assign invoice to cluster |
| `GET` | `/api/green-kpi/stats` | Green KPI dashboard stats |
| `GET` | `/api/green-kpi/confidence-trend` | Daily confidence trend (last N days) |
| `GET` | `/api/green-kpi/invoices` | Green KPI invoice list |
| `GET` | `/api/green-kpi/invoices/{id}` | Green KPI invoice detail |
| `POST` | `/api/green-kpi/corrections` | Submit field correction |
| `GET` | `/api/green-kpi/compliance/{id}` | Compliance report (GST · ABN · QBCC · retention) |

---

## Troubleshooting

**"Tesseract not found"**
Update `TESSERACT_PATH` in `backend/.env` to the full path of `tesseract.exe`.

**CORS error in browser**
Ensure backend is on port 8000 and `vite.config.js` proxies `/api/*` to it.

**ECONNREFUSED in Vite terminal**
The backend is not running. Start it: `uvicorn app.main:app --reload --port 8000` from the `backend/` directory.

**Storage upload failing**
Run storage policies in `supabase_schema.sql` in the Supabase SQL Editor.

**Database RLS blocking queries**
Ensure `SUPABASE_SERVICE_KEY` is the service role key (not anon key) in `backend/.env`.

**Invoices showing "Processing" after they completed**
The `StatusPill` correctly maps `extraction_complete` → green Completed pill. If you see this after an old deployment, do a hard refresh (`Ctrl+Shift+R`).

**Invoices stuck in "Processing" after server restart**
Background tasks are killed when uvicorn restarts. Call the reset endpoint to unblock them:
```bash
curl -X POST http://localhost:8000/api/processing/reset-stuck
```
Or click the amber **Reset Stuck** button that appears in the Invoices list when stuck invoices are detected.

**doc_type_label is NULL for old invoices**
Only invoices processed after v0.9 get a `doc_type_label`. Reprocess old invoices by clicking ↻ to backfill the label.

**All invoices classified as standard_structured**
The classifier runs after OCR. If OCR fails or returns very short text, there may not be enough signal for fuel/multi-page detection. Check the `[DocType]` log lines in the backend terminal.

**Fuel fields (litres, rego) not appearing**
Ensure the invoice was classified as `fuel_statement` (check `doc_type_label` in Supabase). If the keywords weren't found in OCR text, you can reprocess — or the field will appear if Gemini extracts it regardless.

**LLM mode always llm_augment**
The mode is derived from `doc_type_label`. If classification failed (see entry above), the pipeline defaults to `standard_structured` → `llm_augment`. Check `[DocType]` logs.

**ABN check not running / always shows blue badge**
`ABR_GUID` is not set in `backend/.env`. The local checksum still runs (blue = format + checksum valid). To enable live ABR lookup, register free at https://api.abn.business.gov.au/ and add the GUID to `.env`.

**Pydantic ValidationError: abr_guid Extra inputs are not permitted**
Add `abr_guid: str = ""` to the `Settings` class in `backend/app/config.py`. This was fixed in v0.8.

**Python 3.13 install errors**
`easyocr` and `spacy` have been removed. Run `pip install -r requirements.txt` — all remaining packages support Python 3.13.

**ML Agents panel shows "No clusters yet"**
Process at least 2 invoices, then click **Retrain** on the Dashboard.

**Green KPI panel empty after processing**
1. Confirm `green_kpi_schema.sql` was run in Supabase SQL Editor
2. Confirm `green_kpi` is in Supabase → Settings → API → Extra Search Path
3. Check backend terminal for `[GreenKPI]` log lines

**LLM stage skipped**
Set `GEMINI_API_KEY` in `backend/.env`. Without it, the LLM stage is skipped silently and regex + GNN-lite extraction is used instead.

**GNN running in lite mode**
Install PyTorch and torch-geometric (see Step 5). Lite mode still improves confidence scores — full GAT mode adds neural network weights and NODE_PRED classification on top.

**Supabase Realtime not updating status**
Ensure Realtime is enabled for the `invoices` table in Supabase → Database → Replication. The UI falls back to polling automatically if Realtime is unavailable.

**TrOCR fallback not triggering**
Set `HF_TOKEN` in `backend/.env`. Without it the fallback is disabled and Tesseract output is always used.

**VS Code / Pylance out of memory**
Add to VS Code `settings.json`:
```json
{
  "python.analysis.exclude": ["**/node_modules", "**/venv", "**/.venv", "**/__pycache__"],
  "python.analysis.indexing": false
}
```

---

## Changelog

### v0.9 — Document-Type Classifier + LLM Mode Routing

- **Rule-based document-type classifier** (`doc_type_classifier.py`) — new Step 2.5 in the pipeline, runs immediately after OCR:
  - Assigns one of five labels: `standard_structured` · `multi_page` · `fuel_statement` · `low_quality_scanned` · `handwritten_or_very_noisy`
  - Priority order: handwritten → low_quality → fuel → multi_page → standard
  - Uses: OCR confidence score, page count, fuel keyword matching, word-box sparsity, garble pattern detection
  - Stored in new `invoices.doc_type_label` column (TEXT)
- **Mode-aware Gemini prompts** — `llm_service.encode_invoice()` now accepts a `mode` parameter and dispatches to one of four prompt templates:
  - `llm_augment` — standard; Gemini refines regex/GNN output
  - `llm_primary` — low-quality/handwritten; Gemini is the primary source of truth; image trusted over OCR text
  - `llm_fuel` — fuel statement; standard schema + `fuel_details` (litres, rate_per_litre, vehicle_rego, odometer_km, fuel_type, pump_number, card_number)
  - `llm_multipage` — multi-page; all pages concatenated; OCR char limit raised from 6k → 10k; cross-page total reconciliation
- **Smart field merge** — field merge logic respects the mode:
  - `llm_primary` → Gemini always wins (overrides regex and GNN)
  - `llm_augment` → Gemini wins only when confidence is higher
- **Fuel fields stored** — `fuel_*` fields (e.g. `fuel_litres`, `fuel_vehicle_rego`) stored as extracted fields for cluster agent learning
- **GNN skip for handwritten** — graph construction and GNN inference are both skipped when `gnn_priority == "skip"` (handwritten/very-noisy invoices); logged in processing_stages
- **`DocTypePill` component** — colour-coded pill displayed next to the StatusPill in Invoice Detail header with tooltip explaining the processing mode used:
  - 🩶 Standard (slate) · 🟣 Multi-page (violet) · 🟡 Fuel statement (amber) · 🟠 Low-quality scan (orange) · 🔴 Handwritten / noisy (rose)
- **Doc-type filter chips** in Invoices list — *All types / Standard / Multi-page / Fuel / Low-quality / Handwritten* filter row below existing quick filters
- **Doc-type mini-pill** in Invoices list view — shown inline on each invoice row for non-standard types

### v0.8 — ABN Validation + UI Overhaul

- **Automatic ABN + GST validation** — new `abn_service.py` runs as Stage 4.5 on every invoice processed
- **AbnBadge** — colour-coded ABN status chip in the Green KPI strip (green/blue/orange/red)
- **FieldConfidenceMiniChart** — horizontal Recharts bar chart in Invoice Detail
- **OcrCollapsible** — OCR raw text section is now a collapsible card
- **GreenKpiStrip** — full-width compliance + sustainability strip
- **Invoices list redesign** — filter chips, List/Grid control, VendorConfidenceSparkline
- **StatusPill fix** — `extraction_complete`, `validated`, `exported` now correctly map to green Completed pill
- **Reset Stuck endpoint** — `POST /api/processing/reset-stuck`
- **`abr_guid` added to Settings** — prevents Pydantic `ValidationError` on startup

### v0.7 — NODE_PRED + LLM Adaptation + Supabase Realtime
- NODE_PRED: GAT now has a `Linear(32 → 9)` classification head
- LLM_EMB → FEAT bridge: LLM-extracted field values guide node semantic type assignment
- TRAIN_LLM: correction shots injected into every Gemini prompt
- Supabase Realtime: replaced HTTP polling with `postgres_changes` WebSocket subscription
- GAT fine-tuning from corrections: contrastive margin loss
- TrOCR fallback: when Tesseract confidence < 60%
- green_kpi.corrections write from `/extraction/validate`

### v0.6 — Green KPI Architecture (GNN + LLM + Sustainability)
- Multimodal LLM: Gemini 2.5 Flash analyses invoice image + OCR text
- Document graph: OCR word boxes become graph nodes with 20-dim features; 4 edge types
- GNN (GAT): 2-layer Graph Attention Network refines field confidence
- Validation service: GST reconciliation, date normalisation, QBCC/retention compliance
- Green KPI tables and 5 new API endpoints

### v0.5 — ML Cluster Agents + Security
- TF-IDF + KMeans clustering; per-cluster learned correction patterns
- Self-improving extraction: corrections → `cluster_agents.learned_patterns` → auto-fix on next invoice
- Dashboard ML Agents panel with accuracy bars and Retrain button

### v0.4 — UI/UX Animations Round 2
- Page transitions, count-up stats, InvoiceDetail step tracker, shimmer skeletons

### v0.3 — UI/UX Animations Round 1
- Shimmer loading, hover lift cards, toast notifications, staggered rows, frosted glass header

### v0.2 — Folder Classification
- User-created folders, AI folder suggestion from vendor name, folder sidebar + filter

### v0.1 — Core Fixes & Initial Build
- Tesseract path fix, Python 3.13 compatibility, storage RLS, full schema, Invoice Detail page
