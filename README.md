# InvoiceAI — Automated Invoice Processing System

AI-powered invoice processing with OCR, TrOCR fallback, multimodal LLM encoding, Graph Neural Network reasoning with node-level field prediction, ML cluster agents, sustainability tagging, Australian compliance checks, and folder organisation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite · Tailwind CSS · React Router · Lucide React · Supabase Realtime |
| Backend | Python 3.11–3.13 · FastAPI · Uvicorn |
| OCR | Tesseract · PyMuPDF (PDFs) · OpenCV (preprocessing) · TrOCR fallback (HF API) |
| LLM | Gemini 2.5 Flash (multimodal — image + OCR text) · few-shot correction injection |
| Graph / GNN | scikit-learn (graph features) · PyTorch + torch-geometric (GAT + NODE_PRED head, optional) |
| ML Clustering | TF-IDF + KMeans (vendor cluster agents) |
| Database / Auth / Storage | Supabase (PostgreSQL + RLS + Realtime + Storage) |

---

## Features

- **Upload invoices** — drag & drop PDF, PNG, JPG, TIFF (up to 10 MB)
- **OCR pipeline** — Tesseract for images, PyMuPDF direct extraction for PDFs; auto-falls back to TrOCR (Microsoft HF model) when Tesseract confidence < 60%
- **Multimodal LLM** — Gemini 2.5 Flash analyses image + OCR text → structured JSON fields + sustainability tags
- **LLM adaptation** — user corrections accumulate in DB and are injected as few-shot examples into every future Gemini prompt (TRAIN_LLM feedback arc)
- **Graph construction** — invoice OCR boxes become a document graph; LLM field assignments guide node semantic typing (LLM_EMB → FEAT bridge)
- **GNN reasoning** — 2-layer GAT with a NODE_PRED classification head (9 field types); runs in lite mode without PyTorch
- **Node-level field prediction** — GAT classifies every graph node into a field type (VENDOR_NAME, TOTAL, LINE_QTY, etc.) and extracts or reinforces field values from the highest-confidence nodes
- **ML cluster agents** — TF-IDF + KMeans groups invoices by vendor/format; each cluster learns from user corrections
- **Self-improving accuracy** — every correction trains the agent and fine-tunes the GAT; next invoice from the same vendor is extracted better automatically
- **Supabase Realtime** — invoice status updates pushed to the UI via WebSocket; polling fallback if Realtime is unavailable
- **Green KPI** — sustainability tag extraction, GST reconciliation, QBCC and retention compliance checks, spend tracking
- **Folder organisation** — create folders (e.g. "AGL", "Utilities") and the AI suggests the right folder per invoice
- **Inline field editing** — correct any extracted value directly in the UI; corrections feed the learning loop
- **Confidence scores** — animated bar per field; GNN/LLM/agent-corrected fields show boosted confidence
- **Dashboard** — animated stats, ML Agents panel (cluster accuracy), Green KPI panel (spend, tags, compliance), recent invoices

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
ML Cluster Agent  (TF-IDF + KMeans → assign vendor cluster → apply learned corrections)
      │
      ▼
Regex Extraction  (invoice # · date · total · vendor · line items)
      │
      ▼
Multimodal LLM  (Gemini 2.5 Flash — image + OCR + correction shots → structured JSON + sustainability tags)
      │
      ├─ LLM field values → node semantic types (LLM_EMB → FEAT bridge)
      ▼
Graph Construction  (OCR boxes → nodes; LLM field matches guide semantic type one-hots; 4 edge types)
      │
      ▼
GNN Reasoning  (GAT 2-layer → NODE_PRED classification head → per-node field type prediction)
      │  └─ node predictions → extract missing fields + reinforce existing values
      ▼
Consistency Layer  (GST reconciliation · date normalisation · QBCC · retention · tag catalogue)
      │
      ▼
Store → invoices + extracted_fields + line_items (core tables)
      │   → green_kpi.invoices + invoice_data + processing_logs (analytics layer)
      │
      ▼
User corrects fields in InvoiceDetail  (Supabase Realtime status updates)
      │
      ├─ → green_kpi.corrections (TRAIN_LLM: injected into next Gemini prompt as few-shot)
      ├─ → GAT fine-tune on Retrain  (TRAIN_GNN: contrastive margin loss on corrected nodes)
      └─ → cluster_agents.learned_patterns updated on Retrain  (TRAIN_CLUST)
```

---

## Architecture Diagrams

### Multimodal LLM + Graph/GNN layer

```
OCR Output ──────────────────────────────────────────────► Graph Builder
(word_boxes + raw_text)                                         │
                                                                │
Invoice Image ──► Gemini 2.5 Flash ──► Structured JSON         │
OCR Text ───────►  (vision + text)  ──► LLM Field Values ──► Node Semantic Types
                                     ──► Layout Segments ──► (LLM_EMB → FEAT bridge)
                                                                │
                                                          Node Features (20-dim)
                                                          [bbox · TF-IDF · sem-type]
                                                                │
                                                    4 Edge Types (spatial · semantic
                                                    · hierarchical · logical)
                                                                │
                                                        GAT 2-layer
                                                                │
                                                    NODE_PRED head (9 field types)
                                                    VENDOR_NAME · TOTAL · LINE_QTY
                                                    INVOICE_DATE · TAX_AMOUNT · ...
                                                                │
                                                    Consistency Layer
                                                    (GST · QBCC · dates)
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
│   │   │   ├── Invoices.jsx         # Invoice list + folder sidebar
│   │   │   └── InvoiceDetail.jsx    # OCR text · extracted fields · Supabase Realtime
│   │   ├── components/
│   │   │   └── Layout.jsx           # Sidebar + top bar
│   │   └── lib/
│   │       └── supabase.js
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app + routers
│   │   ├── config.py                # Settings from .env (incl. GEMINI_API_KEY, HF_TOKEN)
│   │   ├── routers/
│   │   │   ├── invoices.py          # Invoice CRUD + folder assign
│   │   │   ├── processing.py        # Full pipeline orchestration
│   │   │   ├── extraction.py        # Field validation + green_kpi.corrections write
│   │   │   ├── folders.py           # Folder CRUD
│   │   │   ├── learning.py          # ML cluster agent + GAT retrain endpoints
│   │   │   └── green_kpi.py         # Green KPI endpoints
│   │   └── services/
│   │       ├── ocr_service.py       # Tesseract + PyMuPDF + TrOCR fallback
│   │       ├── preprocessing_service.py
│   │       ├── extraction_service.py
│   │       ├── clustering_service.py  # TF-IDF + KMeans
│   │       ├── learning_service.py    # Correction learning + retraining
│   │       ├── agent_manager.py       # Cluster routing + correction application
│   │       ├── llm_service.py         # Gemini 2.5 Flash + few-shot correction injection
│   │       ├── graph_builder.py       # Document graph + LLM_EMB→FEAT node typing
│   │       ├── gnn_service.py         # 2-layer GAT + NODE_PRED head + fine-tune
│   │       ├── validation_service.py  # GST · QBCC · sustainability tags
│   │       ├── green_kpi_service.py   # green_kpi.* DB writes + stats
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

# OCR
TESSERACT_PATH=C:/Program Files/Tesseract-OCR/tesseract.exe
OCR_ENGINE=tesseract

# Green KPI — Gemini API (free tier available)
GEMINI_API_KEY=your-gemini-key

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
uvicorn app.main:app --reload-dir app
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
# App at http://localhost:3000
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
4. **Review** — open the invoice to see extracted fields; edit any wrong value inline
5. **Green KPI** — Dashboard shows sustainability tags, GST compliance %, total spend after processing
6. **Organise** — create folders in the Invoices sidebar; the AI suggests the right folder per vendor
7. **Retrain agents** — after correcting a few invoices, click **Retrain** on the Dashboard

---

## Green KPI

The Green KPI layer runs automatically after every invoice is processed. It adds:

### Sustainability tagging
Tags extracted by Gemini from line item descriptions and vendor context:

`renewable_energy` · `solar` · `wind` · `carbon_offset` · `recycled_materials` ·
`low_emissions` · `green_building` · `water_conservation` · `waste_management` ·
`electric_vehicle` · `sustainable_packaging` · `energy_efficiency` · `other_green`

### Australian compliance checks
| Check | Logic |
|-------|-------|
| **GST** | Validates 10% tax against subtotal; infers `tax_amount` if missing |
| **QBCC** | Flags building/construction invoices (Queensland licencing context) |
| **Retention** | Detects progress-claim / retention clauses in line item descriptions |

### Dashboard Green KPI panel
- Total spend (AUD)
- Average extraction confidence %
- GST compliance %
- Total corrections learned
- Top sustainability tags with counts
- Status breakdown: completed / needs review / failed

### Green KPI API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/green-kpi/stats` | Aggregate stats for the dashboard |
| `GET` | `/api/green-kpi/invoices` | List with sustainability metadata |
| `GET` | `/api/green-kpi/invoices/{id}` | Full detail + processing stages |
| `POST` | `/api/green-kpi/corrections` | Submit correction (feeds learning loop) |
| `GET` | `/api/green-kpi/compliance/{id}` | GST / QBCC / retention report |

---

## ML Cluster Agents

Invoices are automatically grouped into clusters by OCR text similarity (TF-IDF + KMeans). Each cluster has a dedicated agent that learns from user corrections.

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

LLM field assignments (vendor name text, total value, date strings) directly populate the semantic type one-hot — bridging the LLM embedding signal into graph node features.

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

### GAT fine-tuning from corrections

When **Retrain** is clicked:
1. All validated corrections are fetched from the DB
2. Each corrected invoice's OCR is re-built into a document graph
3. A contrastive margin loss is computed — nodes matching wrong values are penalised, nodes matching the corrected values are reinforced
4. Gradient descent runs for 5 epochs; updated weights are saved to `ml_models/gat_model.pt`

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
4. Reports `ocr_engine: trocr` in the OCR result

Requires `HF_TOKEN` in `.env`. If not set, Tesseract output is used regardless of confidence.

---

## Supabase Realtime

`InvoiceDetail` subscribes to `postgres_changes` on the `invoices` table (filtered to the current invoice ID) via a Supabase WebSocket channel. Status changes (preprocessing → ocr_processing → extraction_complete) are pushed instantly to the UI without polling. If the channel errors, it falls back to 2.5s HTTP polling automatically.

---

## Full API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/invoices` | List invoices (filter by `status`, `folder_id`) |
| `GET` | `/api/invoices/{id}` | Invoice + OCR + fields + line items |
| `DELETE` | `/api/invoices/{id}` | Delete invoice and storage file |
| `PATCH` | `/api/invoices/{id}/folder` | Assign or unassign a folder |
| `POST` | `/api/processing/process` | Trigger full pipeline |
| `GET` | `/api/processing/status/{id}` | Poll processing status |
| `POST` | `/api/extraction/validate` | Save validated field values + write corrections |
| `GET` | `/api/folders` | List all folders |
| `POST` | `/api/folders` | Create a folder |
| `DELETE` | `/api/folders/{id}` | Delete a folder |
| `POST` | `/api/learning/retrain` | Retrain ML cluster agents + GAT fine-tune |
| `GET` | `/api/learning/stats` | Cluster agent statistics |
| `POST` | `/api/learning/assign/{id}` | Re-assign invoice to cluster |
| `GET` | `/api/green-kpi/stats` | Green KPI dashboard stats |
| `GET` | `/api/green-kpi/invoices` | Green KPI invoice list |
| `GET` | `/api/green-kpi/invoices/{id}` | Green KPI invoice detail |
| `POST` | `/api/green-kpi/corrections` | Submit field correction |
| `GET` | `/api/green-kpi/compliance/{id}` | Compliance report |

---

## Troubleshooting

**"Tesseract not found"**
Update `TESSERACT_PATH` in `backend/.env` to the full path of `tesseract.exe`.

**CORS error in browser**
Ensure backend is on port 8000 and `vite.config.js` proxies `/api/*` to it.

**Storage upload failing**
Run storage policies in `supabase_schema.sql` in the Supabase SQL Editor.

**Database RLS blocking queries**
Ensure `SUPABASE_SERVICE_KEY` is the service role key (not anon key) in `backend/.env`.

**Python 3.13 install errors**
`easyocr` and `spacy` have been removed. Run `pip install -r requirements.txt` — all remaining packages support Python 3.13.

**VS Code / Pylance out of memory**
Add to VS Code `settings.json`:
```json
{
  "python.analysis.exclude": ["**/node_modules", "**/venv", "**/.venv", "**/__pycache__"],
  "python.analysis.indexing": false
}
```

**ML Agents panel shows "No clusters yet"**
Process at least 2 invoices, then click **Retrain** on the Dashboard.

**Green KPI panel empty after processing**
1. Confirm `green_kpi_schema.sql` was run in Supabase SQL Editor
2. Confirm `green_kpi` is in Supabase → Settings → API → Extra Search Path
3. Check backend terminal for `[GreenKPI]` log lines

**LLM stage skipped**
Set `GEMINI_API_KEY` in `backend/.env`. Without it, the LLM stage is skipped silently and regex + GNN-lite extraction is used instead.

**LLM correction shots not appearing**
The corrections table is in the `green_kpi` schema. Ensure that schema is applied and the Extra Search Path includes `green_kpi`.

**GNN running in lite mode**
Install PyTorch and torch-geometric (see Step 5). Lite mode still improves confidence scores — full GAT mode adds neural network weights and NODE_PRED classification on top.

**Supabase Realtime not updating status**
Ensure Realtime is enabled for the `invoices` table in Supabase → Database → Replication. The UI falls back to polling automatically if Realtime is unavailable.

**TrOCR fallback not triggering**
Set `HF_TOKEN` in `backend/.env`. Without it the fallback is disabled and Tesseract output is always used.

---

## Changelog

### v0.7 — NODE_PRED + LLM Adaptation + Supabase Realtime
- **NODE_PRED**: GAT now has a `Linear(32 → 9)` classification head predicting the field role of every graph node (VENDOR_NAME, TOTAL, INVOICE_DATE, etc.); predictions extract missing fields and reinforce confidence on matching values
- **LLM_EMB → FEAT bridge**: LLM-extracted field values now guide node semantic type assignment in `graph_builder.py` — converting Gemini's span knowledge into graph node features
- **TRAIN_LLM**: `encode_invoice()` fetches recent corrections from `green_kpi.corrections` and injects them as few-shot examples into every Gemini prompt — prompt-based LLM adaptation without LoRA
- **Supabase Realtime**: `InvoiceDetail` replaced HTTP polling with `postgres_changes` WebSocket subscription; graceful polling fallback on channel error
- **GAT fine-tuning from corrections**: `Retrain` now also runs `retrain_from_corrections()` — rebuilds document graphs for corrected invoices and fine-tunes GAT with a contrastive margin loss
- **TrOCR fallback**: when Tesseract confidence < 60%, automatically calls `microsoft/trocr-large-printed` via HuggingFace Inference API
- **green_kpi.corrections write**: `/extraction/validate` now writes field corrections to `green_kpi.corrections` automatically, feeding all three retraining arcs (GNN · LLM · Cluster)
- **Bug fixes**: corrected `builder.build()` arg order in GAT retrain path

### v0.6 — Green KPI Architecture (GNN + LLM + Sustainability)
- **Multimodal LLM**: Gemini 2.5 Flash analyses invoice image + OCR text → structured JSON, sustainability tags, layout segments, compliance hints
- **Document graph**: OCR word boxes become graph nodes with 20-dim features; 4 edge types (spatial, semantic, hierarchical, logical)
- **GNN (GAT)**: 2-layer Graph Attention Network refines field confidence; auto-detects full (PyTorch + PyG) vs lite mode
- **Validation service**: GST reconciliation, date normalisation, QBCC/retention compliance, sustainability tag catalogue
- **Green KPI tables**: `green_kpi.invoices`, `invoice_data`, `corrections`, `processing_logs`
- **Green KPI Dashboard panel**: spend, confidence, GST compliance %, sustainability tag pills, status breakdown
- **5 new API endpoints** under `/api/green-kpi`
- **Feature flags**: `GREEN_KPI_ENABLED`, `LLM_ENABLED`, `GNN_ENABLED` — stages degrade gracefully when disabled

### v0.5 — ML Cluster Agents + Security
- TF-IDF + KMeans clustering; per-cluster learned correction patterns
- Self-improving extraction: corrections → `cluster_agents.learned_patterns` → auto-fix on next invoice
- Dashboard ML Agents panel with accuracy bars and Retrain button
- `.gitignore` added — protects `.env`, `ml_models/`, `node_modules/`

### v0.4 — UI/UX Animations Round 2
- Page transitions, count-up stats, InvoiceDetail step tracker, shimmer skeletons, edit glow, folder suggestion wiggle

### v0.3 — UI/UX Animations Round 1
- Shimmer loading, hover lift cards, toast notifications, staggered rows, frosted glass header, custom Tailwind keyframes

### v0.2 — Folder Classification
- User-created folders, AI folder suggestion from vendor name, folder sidebar + filter

### v0.1 — Core Fixes & Initial Build
- Tesseract path fix, Python 3.13 compatibility, storage RLS, full schema, Invoice Detail page
