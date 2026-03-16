# Invoice Processing — Change Log

A running log of every feature, fix, and improvement made to this project.

---

## v0.4 — UI/UX Animation Upgrade Round 2
**Files changed:** `tailwind.config.js`, `src/index.css`, `Layout.jsx`, `Dashboard.jsx`, `InvoiceDetail.jsx`

### New Animations & Interactions

#### 🔄 Page Transitions (`Layout.jsx`)
- Every route change now triggers a smooth **fade-in** on the page content
- Implemented by wrapping `<Outlet />` in a keyed `<div key={location.pathname}>` so React remounts it on navigation

#### 📊 Count-Up Numbers (`Dashboard.jsx`)
- The 4 stat cards (Total, Processing, Completed, Failed) animate from **0 → actual value** on page load
- Uses `requestAnimationFrame` with a cubic ease-out curve over 650ms
- The banner strip numbers (total, in-progress, completed) also count up

#### 📄 InvoiceDetail Page — Full Animation Overhaul (`InvoiceDetail.jsx`)
Previously had zero animations. Now includes:

| Feature | Description |
|---------|-------------|
| **Page fade-in** | Entire page fades in on mount via `opacity` transition |
| **Processing step tracker** | Horizontal bar showing Preprocessed → OCR → Extracted → Validated, with filled connectors and checkmarks for completed steps — visible only during active processing |
| **Status badge pulsing ring** | A glowing ring pulses around the status badge when the invoice is actively processing |
| **Staggered field cards** | Each extracted field card slides up with a 50ms stagger delay |
| **Animated confidence bars** | Each field shows a blue→indigo bar that animates from 0% to its actual confidence score on mount (0.7s transition) |
| **Edit mode glow** | Blue glow ring appears on the input when editing a field |
| **Slide-in buttons** | Save and Cancel buttons slide in from the right when edit mode opens |
| **Folder suggestion wiggle** | The amber "Move to folder?" banner shakes once as an attention animation |
| **OCR panel smooth collapse** | Raw text panel expands/collapses with a smooth `max-height` + `opacity` transition instead of appearing/disappearing instantly |
| **Chevron rotation** | Single arrow icon rotates 180° on open/close instead of swapping icons |
| **Back button hover** | Arrow slides left when hovering the "Back to Invoices" link |
| **Header card** | Filename/status wrapped in a white card with shadow for better visual hierarchy |
| **Shimmer skeleton** | Loading state shows shimmer placeholder shapes instead of a plain spinner |

#### 🎨 New CSS Utilities (`index.css`)
- `.collapse-transition` — smooth `max-height` + `opacity` accordion for collapsible sections
- `.confidence-bar-track` / `.confidence-bar-fill` — animated gradient confidence bar
- `.status-ring` — pulsing ring around processing status badges
- `.field-edit-active` — blue glow ring on active edit inputs

#### ⚙️ New Tailwind Keyframes (`tailwind.config.js`)
- `wiggle` — one-shot left/right attention shake
- `animate-wiggle` alias — fires once (1 iteration)
- `animate-pulse-ring` alias — faster pulsing (1.4s) for status rings

---

## v0.3 — UI/UX Animation Upgrade Round 1
**Files changed:** `tailwind.config.js`, `src/index.css`, `Layout.jsx`, `Dashboard.jsx`, `Upload.jsx`, `Invoices.jsx`

### Additions

#### Layout (`Layout.jsx`)
- Active nav item: left blue bar indicator + blue background
- Sidebar logo: gradient background with shadow
- User avatar: gradient blue→indigo
- Nav icons scale on hover
- Frosted glass top bar (`backdrop-blur`)
- "System online" pulsing green dot in top bar
- AI-Powered badge in sidebar

#### Dashboard (`Dashboard.jsx`)
- Shimmer loading skeleton (cards + table)
- Stat cards: gradient icon backgrounds with coloured shadows + hover lift (`card-hover`)
- Welcome banner: decorative blur blobs, animated floating icon, inline stats strip
- Recent invoices: each row animates in, arrow slides right on hover, vendor name in indigo
- Status dot indicator on recent invoice rows (pulses for active states)

#### Upload (`Upload.jsx`)
- Drop zone: scales up on drag, pulsing background ring
- Animated upload icon
- Per-file progress bar (10% → 40% → 75% → 100%)
- File items slide in when added
- Processing steps info cards with hover lift
- Gradient upload button with shadow lift

#### Invoices (`Invoices.jsx`)
- Toast notification slides in from top-right (replaces inline banner)
- Folder sidebar slides in from left
- Table rows: staggered slide-in from left
- Status badges: coloured dot indicator (pulsing for processing states)
- Action buttons: fade from 50% → 100% opacity on row hover
- Filename: arrow icon slides in on hover
- Shimmer skeleton loading rows
- Vendor names highlighted in indigo

#### New Tailwind Keyframes
`fadeIn`, `slideUp`, `slideInLeft`, `slideInRight`, `bounceIn`, `shimmer`, `float`, `pulseSoft`, `spin-slow`

#### New CSS Utilities
`.shimmer-bg`, `.glass`, `.gradient-text`, `.card-hover`, `.stagger-1` through `.stagger-6`

---

## v0.2 — Folder Classification Feature
**Files changed:** `supabase_schema.sql`, `backend/app/routers/folders.py` *(new)*, `backend/app/main.py`, `backend/app/routers/processing.py`, `backend/app/routers/invoices.py`, `InvoiceDetail.jsx`, `Invoices.jsx`

### Feature: User-Created Folders + AI Folder Suggestion

**How it works:**
1. User creates folders from the Invoices page sidebar (e.g. "AGL", "Utilities", "Telco")
2. After an invoice is processed, the backend reads the extracted `vendor_name`
3. The vendor name is matched against existing folder names (case-insensitive substring match)
4. If matched, `invoices.suggested_folder_id` is set on the invoice
5. InvoiceDetail shows an amber banner: *"This looks like an AGL invoice. Move it to the AGL folder?"*
6. User clicks **Move** → invoice is assigned to that folder
7. On the Invoices page, clicking a folder filters to only those invoices

### Database Changes (`supabase_schema.sql`)
```sql
CREATE TABLE invoice_folders (id, name, organization_id, created_by, created_at);
ALTER TABLE invoices ADD COLUMN vendor_name TEXT;
ALTER TABLE invoices ADD COLUMN folder_id UUID REFERENCES invoice_folders;
ALTER TABLE invoices ADD COLUMN suggested_folder_id UUID REFERENCES invoice_folders;
```
> Run this migration in the Supabase SQL Editor before using the folders feature.

### Backend Changes
- **`routers/folders.py`** *(new)* — `GET /api/folders`, `POST /api/folders`, `DELETE /api/folders/{id}`
- **`main.py`** — registered folders router at `/api/folders`
- **`routers/processing.py`** — after extraction, writes `vendor_name` to invoice row and queries folders for a match; sets `suggested_folder_id` if found
- **`routers/invoices.py`** — added `vendor_name`, `folder_id`, `suggested_folder_id` to `InvoiceResponse`; added `folder_id` filter to list endpoint; added `PATCH /{id}/folder` endpoint

### Frontend Changes
- **`Invoices.jsx`** — folder sidebar with create/delete, folder filter, vendor column in table
- **`InvoiceDetail.jsx`** — amber suggestion banner (Move / Dismiss), manual folder dropdown

---

## v0.1 — Initial System Fixes & Core Features
**Sprint 0–3 bug fixes to make the system run end-to-end**

### Critical Fixes
| Issue | Fix |
|-------|-----|
| Windows Tesseract path wrong (`/usr/bin/tesseract`) | Updated `config.py` default to `C:/Program Files/Tesseract-OCR/tesseract.exe` |
| No `.env` files | Created `backend/.env` and `frontend/.env` from examples |
| `pydantic-settings` missing from `requirements.txt` | Added `pydantic-settings>=2.0.0` |
| `invoices-raw` storage bucket had 0 policies | Added RLS policies in `supabase_schema.sql` |
| Upload navigation never triggered (stale closure bug) | Fixed with local `successCount` variable instead of reading state |
| Python 3.13: `packaging.version.Version` has no `.split()` | Added monkey-patch at top of `main.py` |
| `easyocr` and `spacy` incompatible with Python 3.13 | Removed from `requirements.txt`; bumped Pillow, numpy, opencv, PyMuPDF |

### Features Built
- Full Supabase schema (`supabase_schema.sql`) covering all tables, RLS policies, and the `create_organization_with_owner` RPC function
- Invoice Detail page (`InvoiceDetail.jsx`) with OCR text, extracted fields (inline edit), line items, and folder assignment
- Process/Reprocess button wired to `/api/processing/process` with status polling
- Error messages surfaced to users on upload failure and signup org creation failure

---

## Running the Project

### Prerequisites
- Python 3.11–3.13
- Node.js 18+
- Tesseract OCR installed at `C:/Program Files/Tesseract-OCR/tesseract.exe`
- Supabase project with schema applied

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
# Runs at http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs at http://localhost:5173
```

### First-time setup
1. Run `backend/supabase_schema.sql` in the Supabase SQL Editor
2. Create `backend/.env` with your Supabase URL and keys
3. Create `frontend/.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
