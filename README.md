# InvoiceAI — Automated Invoice Processing System

AI-powered invoice processing with OCR, field extraction, vendor classification, and folder organisation.

---

## Tech Stack

**Frontend:** React 18 + Vite · Tailwind CSS · React Router · Supabase JS Client · Lucide React icons

**Backend:** Python 3.11–3.13 · FastAPI · Tesseract OCR · PyMuPDF · OpenCV

**Database / Auth / Storage:** Supabase (PostgreSQL + RLS + Storage)

---

## Features

- **Upload invoices** — drag & drop PDF, PNG, JPG, TIFF (up to 10 MB)
- **AI extraction** — automatically extracts vendor name, invoice number, date, total, and line items via OCR
- **Folder organisation** — create folders (e.g. "AGL", "Utilities") and the AI suggests which folder each invoice belongs to based on the vendor name
- **Inline field editing** — correct any extracted value directly in the UI; saved as "validated"
- **Confidence scores** — animated bar showing extraction confidence per field
- **Processing step tracker** — live progress bar: Preprocessed → OCR → Extracted → Validated
- **Dashboard** — animated stats and recent invoice feed

---

## Project Structure

```
invoice-processing/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx      # Stats + recent invoices
│   │   │   ├── Upload.jsx         # Drag-and-drop upload
│   │   │   ├── Invoices.jsx       # Invoice list + folder sidebar
│   │   │   └── InvoiceDetail.jsx  # OCR results + field editing
│   │   ├── components/
│   │   │   └── Layout.jsx         # Sidebar navigation + top bar
│   │   └── lib/
│   │       └── supabase.js        # Supabase client
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI entry point
│   │   ├── config.py              # Settings from .env
│   │   ├── routers/
│   │   │   ├── invoices.py        # Invoice CRUD + folder assign
│   │   │   ├── processing.py      # OCR pipeline trigger
│   │   │   ├── extraction.py      # Field validation endpoint
│   │   │   └── folders.py         # Folder CRUD
│   │   └── services/
│   │       ├── ocr_service.py     # Tesseract + PyMuPDF
│   │       ├── extraction_service.py
│   │       └── supabase_client.py
│   ├── supabase_schema.sql        # Full DB schema — run once in Supabase SQL Editor
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

In your Supabase project → **SQL Editor** → paste and run the full contents of:
```
backend/supabase_schema.sql
```
This creates all tables, RLS policies, storage bucket, and the `create_organization_with_owner` RPC function.

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

# Create your .env file
cp .env.example .env
```

Edit `backend/.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=True
TESSERACT_PATH=C:/Program Files/Tesseract-OCR/tesseract.exe
OCR_ENGINE=tesseract
```

Start the server:
```bash
uvicorn app.main:app --reload
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

## Using the App

1. **Sign up** at `/signup` — creates your account and organisation
2. **Upload** — go to Upload, drag & drop invoice files
3. **Process** — click the ↻ button on any invoice to run OCR + extraction
4. **Review** — open the invoice to see extracted fields, edit any value inline, view raw OCR text
5. **Organise** — create folders in the Invoices sidebar; the AI will suggest matching folders after processing

---

## Folder Classification

Users create folders (e.g. "AGL", "Telstra") from the **Invoices** sidebar.

After an invoice is processed:
1. The extracted `vendor_name` is matched against folder names (case-insensitive)
2. If matched, the invoice gets a `suggested_folder_id`
3. Invoice Detail shows: *"This looks like an AGL invoice. Move it to the AGL folder?"*
4. User clicks **Move** to confirm or **Dismiss** to ignore

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/invoices` | List invoices (filter by `status`, `folder_id`) |
| `GET` | `/api/invoices/{id}` | Invoice + OCR results + fields + line items |
| `DELETE` | `/api/invoices/{id}` | Delete invoice and storage file |
| `PATCH` | `/api/invoices/{id}/folder` | Assign or unassign a folder |
| `POST` | `/api/processing/process` | Trigger OCR + extraction pipeline |
| `GET` | `/api/processing/status/{id}` | Poll current processing status |
| `POST` | `/api/extraction/validate` | Save validated field values |
| `GET` | `/api/folders` | List all folders |
| `POST` | `/api/folders` | Create a folder |
| `DELETE` | `/api/folders/{id}` | Delete a folder (invoices become unassigned) |

---

## Changelog

### v0.4 — UI/UX Animations Round 2
- Smooth **page transitions** on every route change (fade-in)
- Dashboard stat numbers **count up** from 0 to actual value on load
- **InvoiceDetail** full animation overhaul:
  - Processing step tracker (Preprocessed → OCR → Extracted → Validated)
  - Pulsing ring on status badge during processing
  - Staggered field card slide-in with animated confidence bars (0% → actual)
  - Edit mode: blue glow ring + slide-in Save/Cancel buttons
  - Folder suggestion banner: wiggle attention animation on first render
  - OCR panel: smooth `max-height` expand/collapse transition with chevron rotation
  - Shimmer skeleton loading state

### v0.3 — UI/UX Animations Round 1
- Shimmer skeleton loading throughout (Dashboard, Invoices, Upload)
- Staggered table row animations, hover lift on cards (`card-hover`)
- Upload drag zone: scale + pulse effects, per-file progress bars
- Toast notifications slide in from top-right
- Status badges with animated pulsing dot for active states
- Gradient buttons, frosted glass header, AI badge in sidebar
- Custom Tailwind keyframes: `fadeIn`, `slideUp`, `slideInLeft`, `slideInRight`, `bounceIn`, `shimmer`, `float`, `pulseSoft`, `wiggle`

### v0.2 — Folder Classification Feature
- New `invoice_folders` table; `vendor_name`, `folder_id`, `suggested_folder_id` columns on `invoices`
- `GET/POST/DELETE /api/folders` endpoints
- Post-extraction: vendor name matched against folders → `suggested_folder_id` set automatically
- Invoices page: folder sidebar with create/delete + folder filter
- InvoiceDetail: amber suggestion banner + manual folder dropdown

### v0.1 — Core Fixes & Initial Build
- Fixed Windows Tesseract path (`config.py`)
- Fixed Python 3.13 `packaging.version.Version.split` crash (`main.py` monkey-patch)
- Fixed upload stale-closure navigation bug (`Upload.jsx`)
- Fixed `invoices-raw` bucket having no RLS policies
- Removed `easyocr` + `spacy` (Python 3.13 incompatible); bumped Pillow, numpy, opencv, PyMuPDF
- Created full `supabase_schema.sql` with all tables, RLS, and RPC function
- Built Invoice Detail page with OCR text, extracted fields (inline edit), and line items

---

## Troubleshooting

**"Tesseract not found"**
Update `TESSERACT_PATH` in `backend/.env` to the full path of `tesseract.exe`.

**CORS error in browser**
Make sure the backend is running on port 8000 and `vite.config.js` has the proxy configured.

**Storage upload failing**
Run the storage policies in `supabase_schema.sql` in the Supabase SQL Editor.

**Database RLS blocking queries**
Make sure `SUPABASE_SERVICE_KEY` is set in `backend/.env` (service role key, not anon key).

**Python 3.13 install errors**
Run `pip install -r requirements.txt` — `easyocr` and `spacy` have been removed; remaining packages support Python 3.13.
