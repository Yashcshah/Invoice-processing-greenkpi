# Invoice Processing System

AI-powered invoice processing with OCR and field extraction.

## Project Structure

```
invoice-processing/
├── frontend/          # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/     # Login, Signup, Dashboard, Upload, Invoices
│   │   ├── components/
│   │   └── lib/       # Supabase client
│   └── package.json
│
├── backend/           # Python + FastAPI
│   ├── app/
│   │   ├── routers/   # API endpoints
│   │   ├── services/  # OCR, ML, extraction
│   │   └── models/    # Pydantic models
│   └── requirements.txt
│
└── README.md
```

## Prerequisites

- Node.js 18+
- Python 3.10+
- Tesseract OCR
- Supabase account (already set up)

---

## Quick Start Guide

### Step 1: Install Tesseract OCR

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-eng poppler-utils
```

**macOS:**
```bash
brew install tesseract poppler
```

**Windows:**
1. Download installer from: https://github.com/UB-Mannheim/tesseract/wiki
2. Install and note the installation path
3. Add to PATH or update `.env` with the path

### Step 2: Backend Setup

```bash
# Navigate to backend folder
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/macOS:
source venv/bin/activate
# On Windows:
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download spaCy model (for NER - Sprint 4)
python -m spacy download en_core_web_sm

# Create environment file
cp .env.example .env

# IMPORTANT: Edit .env and add your Supabase SERVICE ROLE key
# Get it from: Supabase Dashboard → Settings → API → service_role key
```

**Start the backend server:**
```bash
uvicorn app.main:app --reload --port 8000
```

Backend will run at: http://localhost:8000
API docs at: http://localhost:8000/docs

### Step 3: Frontend Setup

Open a **new terminal** and run:

```bash
# Navigate to frontend folder
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will run at: http://localhost:3000

---

## Using the Application

1. **Sign Up**: Create a new account at http://localhost:3000/signup
2. **Login**: Sign in with your credentials
3. **Upload**: Go to Upload page and drag & drop invoice images/PDFs
4. **Process**: Click "Process Invoice" to run OCR and extraction
5. **Review**: View and validate extracted fields

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/process-invoice` | POST | Process an invoice (OCR + extraction) |
| `/api/invoices` | GET | List all invoices |
| `/api/invoices/{id}` | GET | Get invoice details |
| `/api/ocr/extract` | POST | Test OCR on uploaded file |
| `/api/extraction/extract-fields` | POST | Test field extraction |

---

## Troubleshooting

### "Tesseract not found" error
- Make sure Tesseract is installed
- On Windows, update `TESSERACT_CMD` in `.env` to full path like:
  ```
  TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
  ```

### "CORS error" in browser
- Make sure backend is running on port 8000
- Check that frontend proxy is configured in `vite.config.js`

### "Permission denied" on storage
- Go to Supabase Dashboard → Storage → invoices-raw
- Click on "Policies" tab
- Add policies for authenticated users

### Database RLS blocking queries
- For development, you can use the service_role key in backend
- Make sure `.env` has `SUPABASE_SERVICE_KEY` set

---

## Tech Stack

**Frontend:**
- React 18 + Vite
- Tailwind CSS
- React Router
- Supabase JS Client

**Backend:**
- Python 3.10+
- FastAPI
- Tesseract OCR
- OpenCV
- spaCy (for NER)

**Database:**
- Supabase (PostgreSQL)
- Row Level Security (RLS)

---


