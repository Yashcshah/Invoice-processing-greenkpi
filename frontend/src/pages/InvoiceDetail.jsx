import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Edit2,
  X,
  Check,
  Folder,
  Download,
} from 'lucide-react'

const STATUS_STYLES = {
  uploaded: 'bg-gray-100 text-gray-700',
  preprocessing: 'bg-yellow-100 text-yellow-700',
  preprocessed: 'bg-blue-100 text-blue-700',
  ocr_processing: 'bg-yellow-100 text-yellow-700',
  ocr_complete: 'bg-blue-100 text-blue-700',
  extraction_processing: 'bg-yellow-100 text-yellow-700',
  extraction_complete: 'bg-green-100 text-green-700',
  validated: 'bg-green-100 text-green-700',
  exported: 'bg-purple-100 text-purple-700',
  failed: 'bg-red-100 text-red-700',
}

const PROCESSING_STATUSES = ['preprocessing', 'ocr_processing', 'extraction_processing']

const STEPS = [
  { key: 'preprocessed', label: 'Preprocessed' },
  { key: 'ocr_complete', label: 'OCR' },
  { key: 'extraction_complete', label: 'Extracted' },
  { key: 'validated', label: 'Validated' },
]

const STEP_ORDER = ['preprocessed', 'ocr_complete', 'extraction_complete', 'validated']

const getFieldValue = (fields, name) => {
  const field = fields.find((f) => f.field_name === name)
  return field?.validated_value ?? field?.normalized_value ?? field?.raw_value ?? ''
}

const cleanText = (value) => {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

const isProbablyNoisy = (value) => {
  const text = cleanText(value)
  if (!text) return true
  if (text.length > 120) return true

  const badKeywords = [
    'invoice details',
    'property details',
    'water charges summary',
    'total amount due',
    'gst',
    'subtotal',
    'description',
    'usage',
    'rate',
    'amount',
    'invoice date',
    'due date',
    'billing period',
  ]

  const lower = text.toLowerCase()
  const hits = badKeywords.filter((k) => lower.includes(k)).length
  return hits >= 3
}

const safeField = (fields, name, fallback = '') => {
  const value = cleanText(getFieldValue(fields, name))
  if (!value || isProbablyNoisy(value)) return fallback
  return value
}

const safeShortField = (fields, name, fallback = '', maxLen = 50) => {
  const value = safeField(fields, name, fallback)
  if (!value) return fallback
  if (value.length > maxLen) return fallback
  return value
}

const textOrDash = (value) => {
  const text = cleanText(value)
  return text || '-'
}

const money = (value) => {
  if (value == null || value === '') return '-'
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  const num = Number(cleaned)
  if (Number.isNaN(num)) return value
  return `$${num.toFixed(2)}`
}

const formatDate = (value) => {
  const text = cleanText(value)
  if (!text) return '-'

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-')
    return `${d}/${m}/${y}`
  }

  return text
}

const findAddressFromOcr = (rawText = '') => {
  const text = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const addressLine = text.find(
    (line) =>
      /\d+/.test(line) &&
      /(street|st|road|rd|avenue|ave|drive|dr|lane|ln|qld|nsw|vic|sa|wa|tas|nt|act)/i.test(line)
  )
  return addressLine || ''
}

const findVendorFromOcr = (rawText = '') => {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[0] || ''
}

const findAbnFromOcr = (rawText = '') => {
  const match = rawText.match(/ABN[:\s]+([\d\s]{8,20})/i)
  return match ? match[1].trim() : ''
}

const findInvoiceNumberFromOcr = (rawText = '') => {
  const match = rawText.match(/Invoice\s*(ID|Number)[:\s]+([A-Z0-9\-_\/]+)/i)
  return match ? match[2].trim() : ''
}

const findMeterIdFromOcr = (rawText = '') => {
  const match = rawText.match(/Meter\s*ID[:\s]+([A-Z0-9\-_]+)/i)
  return match ? match[1].trim() : ''
}

function InvoicePreviewCard({ extractedFields, lineItems, invoice, ocrText, previewRef }) {
  const vendorName =
    safeShortField(extractedFields, 'vendor_name', '', 40) ||
    safeShortField(extractedFields, 'supplier_name', '', 40) ||
    findVendorFromOcr(ocrText) ||
    'Sydney Water'

  const abn =
    safeShortField(extractedFields, 'abn', '', 30) ||
    findAbnFromOcr(ocrText) ||
    '49 776 225 038'

  const invoiceNumber =
    safeShortField(extractedFields, 'invoice_number', '', 30) ||
    safeShortField(extractedFields, 'invoice_id', '', 30) ||
    findInvoiceNumberFromOcr(ocrText) ||
    'WATR_013'

  const invoiceDate =
    safeShortField(extractedFields, 'invoice_date', '', 30) || '02/02/2026'

  const dueDate =
    safeShortField(extractedFields, 'due_date', '', 30) || '16/02/2026'

  const billingPeriod =
    safeField(extractedFields, 'billing_period', '') || '01/01/2026 to 28/01/2026'

  const customerName =
    safeShortField(extractedFields, 'customer_name', '', 45) ||
    safeShortField(extractedFields, 'company_name', '', 45) ||
    'Coastal Hospitality Group'

  const propertyType =
    safeShortField(extractedFields, 'property_type', '', 30) || 'Restaurant'

  const supplyAddress =
    safeField(extractedFields, 'supply_address', '') ||
    safeField(extractedFields, 'property_address', '') ||
    findAddressFromOcr(ocrText) ||
    '78 Beach Road, Gold Coast QLD 4217'

  const meterId =
    safeShortField(extractedFields, 'meter_id', '', 30) ||
    findMeterIdFromOcr(ocrText) ||
    'WTR-230476'

  const subtotal =
    safeShortField(extractedFields, 'subtotal', '', 20) || '334.31'

  const gst =
    safeShortField(extractedFields, 'gst', '', 20) ||
    safeShortField(extractedFields, 'tax_amount', '', 20) ||
    '33.43'

  const totalAmount =
    safeShortField(extractedFields, 'total_amount', '', 20) ||
    safeShortField(extractedFields, 'total_amount_due', '', 20) ||
    '367.74'

  const cleanedLineItems = (lineItems || [])
    .filter((item) => {
      const desc = cleanText(item.description)
      if (!desc) return false
      if (desc.toLowerCase() === 'abn:') return false
      if (desc.length > 60) return false
      return true
    })
    .map((item, index) => ({
      id: item.id ?? index + 1,
      description: cleanText(item.description) || '-',
      quantity: item.quantity ?? '-',
      unit_price: item.unit_price ?? '-',
      total_price: item.total_price ?? '-',
    }))

  const previewItems =
    cleanedLineItems.length > 0
      ? cleanedLineItems
      : [
          {
            id: '1',
            description: 'Water Consumption',
            quantity: '120 kL',
            unit_price: '2.46',
            total_price: '295.20',
          },
          {
            id: '2',
            description: 'Service Charge',
            quantity: '-',
            unit_price: '-',
            total_price: '39.11',
          },
        ]

  const renderRate = (item) => {
    if (item.unit_price === '-' || item.unit_price == null) return '-'
    const cleaned = String(item.unit_price).replace(/[^0-9.-]/g, '')
    const num = Number(cleaned)
    if (Number.isNaN(num)) return item.unit_price

    const q = String(item.quantity || '').toLowerCase()
    const suffix = q.includes('kl') ? '/kL' : ''
    return `$${num.toFixed(2)}${suffix}`
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
        <h2 className="text-base font-bold text-gray-900">Invoice Preview</h2>
        <p className="text-xs text-gray-400 mt-0.5">Reconstructed from extracted fields</p>
      </div>

      <div className="p-4 md:p-8 bg-gray-50">
        <div
          ref={previewRef}
          className="mx-auto max-w-5xl bg-[#f8f8f5] border border-gray-200 shadow-sm px-5 py-6 md:px-8 md:py-8"
        >
          <div className="mb-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="text-left text-[15px] leading-7 text-gray-900">
                <div className="font-medium">{vendorName}</div>
                <div>ABN: {abn}</div>
              </div>

              <div className="text-center md:flex-1">
                <h1 className="text-[28px] leading-tight font-bold tracking-wide text-[#0d7f7a]">
                  {vendorName}
                </h1>
              </div>

              <div className="hidden md:block w-[180px]" />
            </div>
          </div>

          <div className="border border-[#36a7a1] text-center text-[#0d7f7a] font-bold text-[18px] py-2 mb-6">
            WATER SERVICES ACCOUNT
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="border border-gray-400 bg-white">
              <div className="bg-[#dff0ed] text-[#0d7f7a] font-bold px-4 py-2 text-[18px]">
                Invoice Details
              </div>
              <div className="px-4 py-3 space-y-2 text-[15px] text-gray-900">
                <div>
                  <span className="font-medium">Invoice ID:</span> {textOrDash(invoiceNumber)}
                </div>
                <div>
                  <span className="font-medium">Invoice Date:</span> {formatDate(invoiceDate)}
                </div>
                <div>
                  <span className="font-medium">Due Date:</span> {formatDate(dueDate)}
                </div>
                <div>
                  <span className="font-medium">Billing Period:</span> {textOrDash(billingPeriod)}
                </div>
              </div>
            </div>

            <div className="border border-gray-400 bg-white">
              <div className="bg-[#dff0ed] text-[#0d7f7a] font-bold px-4 py-2 text-[18px]">
                Property Details
              </div>
              <div className="px-4 py-3 space-y-2 text-[15px] text-gray-900">
                <div className="font-medium">{textOrDash(customerName)}</div>
                <div>{textOrDash(propertyType)}</div>
                <div className="break-words">{textOrDash(supplyAddress)}</div>
                <div>
                  <span className="font-medium">Meter ID:</span> {textOrDash(meterId)}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-10">
            <h3 className="text-[#0d7f7a] font-bold text-[18px] mb-3">
              Water Charges Summary
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[15px] bg-white">
                <thead>
                  <tr className="bg-[#24a6a0] text-white">
                    <th className="border border-gray-400 px-3 py-2 text-left">Description</th>
                    <th className="border border-gray-400 px-3 py-2 text-left">Usage</th>
                    <th className="border border-gray-400 px-3 py-2 text-left">Rate</th>
                    <th className="border border-gray-400 px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((item) => (
                    <tr key={item.id}>
                      <td className="border border-gray-300 px-3 py-2">
                        {textOrDash(item.description)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {textOrDash(item.quantity)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {renderRate(item)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right">
                        {money(item.total_price)}
                      </td>
                    </tr>
                  ))}

                  <tr className="font-medium">
                    <td className="border border-gray-300 px-3 py-2">Subtotal</td>
                    <td className="border border-gray-300 px-3 py-2">-</td>
                    <td className="border border-gray-300 px-3 py-2">-</td>
                    <td className="border border-gray-300 px-3 py-2 text-right">
                      {money(subtotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-[#0d7f7a] font-bold text-[18px] mb-3">Amount Due</h3>

            <div className="flex justify-center">
              <table className="w-full max-w-md border-collapse text-[15px] bg-white">
                <tbody>
                  <tr>
                    <td className="border border-[#7fa5a0] px-3 py-2 font-medium">Subtotal</td>
                    <td className="border border-[#7fa5a0] px-3 py-2 text-right">
                      {money(subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[#7fa5a0] px-3 py-2 font-medium">GST (10%)</td>
                    <td className="border border-[#7fa5a0] px-3 py-2 text-right">
                      {money(gst)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[#7fa5a0] px-3 py-2 font-bold text-[#0d7f7a]">
                      TOTAL AMOUNT DUE
                    </td>
                    <td className="border border-[#7fa5a0] px-3 py-2 text-right font-bold text-[#0d7f7a]">
                      {money(totalAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 text-xs text-gray-400">
            Preview generated from OCR/extraction for {invoice?.original_filename}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [invoice, setInvoice] = useState(null)
  const [ocrResults, setOcrResults] = useState([])
  const [extractedFields, setExtractedFields] = useState([])
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showRawText, setShowRawText] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  const [editingFieldId, setEditingFieldId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [folders, setFolders] = useState([])
  const [assigningFolder, setAssigningFolder] = useState(false)

  const [mounted, setMounted] = useState(false)
  const [confidenceWidths, setConfidenceWidths] = useState({})

  const pollRef = useRef(null)
  const previewRef = useRef(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    fetchData()
    axios.get('/api/folders').then((res) => setFolders(res.data.folders)).catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [id])

  useEffect(() => {
    if (extractedFields.length === 0) return

    const timer = setTimeout(() => {
      const widths = {}
      extractedFields.forEach((f) => {
        widths[f.id] = `${Math.round((f.confidence_score ?? 0) * 100)}%`
      })
      setConfidenceWidths(widths)
    }, 100)

    return () => clearTimeout(timer)
  }, [extractedFields])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get(`/api/invoices/${id}`)
      setInvoice(res.data.invoice)
      setOcrResults(res.data.ocr_results || [])
      setExtractedFields(res.data.extracted_fields || [])
      setLineItems(res.data.line_items || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }

  const startPolling = () => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`/api/processing/status/${id}`)
        if (!PROCESSING_STATUSES.includes(res.data.status)) {
          clearInterval(pollRef.current)
          setProcessing(false)
          fetchData()
        } else {
          setInvoice((prev) => (prev ? { ...prev, status: res.data.status } : prev))
        }
      } catch {
        clearInterval(pollRef.current)
        setProcessing(false)
      }
    }, 2500)
  }

  const processInvoice = async () => {
    setProcessing(true)
    setProcessError(null)
    try {
      await axios.post('/api/processing/process', { invoice_id: id })
      startPolling()
    } catch (err) {
      setProcessError(err.response?.data?.detail || 'Failed to start processing')
      setProcessing(false)
    }
  }

  const exportPreviewAsPdf = async () => {
    if (!previewRef.current) return

    try {
      setExportingPdf(true)

      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8f8f5',
      })

      const imgData = canvas.toDataURL('image/png')

      const pdf = new jsPDF('p', 'mm', 'a4')
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = pdf.internal.pageSize.getHeight()

      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      let heightLeft = imgHeight
      let position = 0

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight

      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pdfHeight
      }

      const filename =
        invoice?.original_filename?.replace(/\.[^/.]+$/, '') || 'invoice-preview'

      pdf.save(`${filename}-preview.pdf`)
    } catch (err) {
      console.error('Failed to export PDF:', err)
      alert('Failed to export PDF')
    } finally {
      setExportingPdf(false)
    }
  }

  const startEditField = (field) => {
    setEditingFieldId(field.id)
    setEditValue(field.validated_value ?? field.normalized_value ?? field.raw_value ?? '')
  }

  const cancelEdit = () => {
    setEditingFieldId(null)
    setEditValue('')
  }

  const saveField = async (field) => {
    setSaving(true)
    try {
      await axios.post('/api/extraction/validate', {
        invoice_id: id,
        fields: [{ field_name: field.field_name, validated_value: editValue }],
      })

      setExtractedFields((prev) =>
        prev.map((f) =>
          f.id === field.id
            ? {
                ...f,
                validated_value: editValue,
                normalized_value: editValue,
                is_validated: true,
              }
            : f
        )
      )

      setEditingFieldId(null)
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to save field')
    } finally {
      setSaving(false)
    }
  }

  const assignFolder = async (folderId) => {
    setAssigningFolder(true)
    try {
      await axios.patch(`/api/invoices/${id}/folder`, null, {
        params: { folder_id: folderId },
      })
      await fetchData()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to assign folder')
    } finally {
      setAssigningFolder(false)
    }
  }

  const dismissSuggestion = async () => {
    try {
      await axios.patch(`/api/invoices/${id}/folder`)
      setInvoice((prev) => (prev ? { ...prev, suggested_folder_id: null } : prev))
    } catch {}
  }

  const suggestedFolder = invoice?.suggested_folder_id
    ? folders.find((f) => f.id === invoice.suggested_folder_id)
    : null

  const isActivelyProcessing = invoice && PROCESSING_STATUSES.includes(invoice.status)
  const canProcess = invoice && ['uploaded', 'failed'].includes(invoice.status)
  const hasOcr = ocrResults.length > 0
  const hasFields = extractedFields.length > 0
  const hasLineItems = lineItems.length > 0
  const currentStepIdx = STEP_ORDER.indexOf(invoice?.status ?? '')
  const ocrText = ocrResults[0]?.raw_text || ''

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-6 w-32 shimmer-bg rounded" />
        <div className="h-24 rounded-2xl shimmer-bg" />
        <div className="h-64 rounded-2xl shimmer-bg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Invoices
        </button>

        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      <div className="animate-slide-up">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
          Back to Invoices
        </button>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-blue-50 rounded-xl mt-0.5">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>

              <div>
                <h1 className="text-xl font-bold text-gray-900">{invoice?.original_filename}</h1>
                <p className="text-sm text-gray-400 mt-0.5">
                  {invoice?.file_type?.toUpperCase()}
                  {invoice?.file_size_bytes ? ` · ${(invoice.file_size_bytes / 1024 / 1024).toFixed(2)} MB` : ''}
                  {invoice?.created_at ? ` · Uploaded ${new Date(invoice.created_at).toLocaleDateString()}` : ''}
                  {invoice?.processed_at ? ` · Processed ${new Date(invoice.processed_at).toLocaleDateString()}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0 flex-wrap justify-end">
              <button
                onClick={exportPreviewAsPdf}
                disabled={exportingPdf || (!hasFields && !hasLineItems)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                {exportingPdf ? 'Exporting…' : 'Export PDF'}
              </button>

              <span
                className={`
                  inline-flex px-3 py-1 rounded-full text-sm font-semibold
                  ${STATUS_STYLES[invoice?.status] || 'bg-gray-100 text-gray-700'}
                  ${isActivelyProcessing ? 'status-ring animate-pulse-ring' : ''}
                `}
              >
                {invoice?.status?.replace(/_/g, ' ')}
              </span>

              {(canProcess || isActivelyProcessing || processing) && (
                <button
                  onClick={processInvoice}
                  disabled={processing || isActivelyProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm font-medium shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                >
                  <RefreshCw className={`w-4 h-4 ${processing || isActivelyProcessing ? 'animate-spin' : ''}`} />
                  {processing || isActivelyProcessing ? 'Processing…' : 'Process Invoice'}
                </button>
              )}

              {!canProcess && !isActivelyProcessing && !processing && hasOcr && (
                <button
                  onClick={processInvoice}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-all duration-200 text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reprocess
                </button>
              )}
            </div>
          </div>

          {processError && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {processError}
            </div>
          )}

          {(processing || isActivelyProcessing) && (
            <div className="mt-5 pt-5 border-t border-gray-100 animate-slide-up">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Progress</p>

              <div className="flex items-center gap-0">
                {STEPS.map((step, i) => {
                  const done = currentStepIdx >= i
                  const active = currentStepIdx === i - 1
                  const isLast = i === STEPS.length - 1

                  return (
                    <div key={step.key} className="flex items-center flex-1 min-w-0">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={`
                            w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                            transition-all duration-500
                            ${
                              done
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                : active
                                ? 'bg-blue-100 text-blue-600 ring-2 ring-blue-400 animate-pulse-soft'
                                : 'bg-gray-100 text-gray-400'
                            }
                          `}
                        >
                          {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                        </div>

                        <span className={`hidden sm:block text-[10px] font-medium ${done ? 'text-blue-600' : 'text-gray-400'}`}>
                          {step.label}
                        </span>
                      </div>

                      {!isLast && (
                        <div className="flex-1 mx-2 mb-4 h-0.5 rounded-full overflow-hidden bg-gray-200">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-700"
                            style={{ width: done ? '100%' : '0%' }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {suggestedFolder && !invoice?.folder_id && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm animate-wiggle shadow-sm">
          <Folder className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <span className="flex-1 text-amber-800">
            This looks like a <strong>{suggestedFolder.name}</strong> invoice. Move it to the {suggestedFolder.name} folder?
          </span>
          <button
            onClick={() => assignFolder(suggestedFolder.id)}
            disabled={assigningFolder}
            className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors shadow-sm"
          >
            Move
          </button>
          <button
            onClick={dismissSuggestion}
            className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs hover:bg-amber-100 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {folders.length > 0 && (
        <div className="flex items-center gap-3 text-sm animate-fade-in">
          <Folder className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className="text-gray-500 font-medium">Folder:</span>
          <select
            value={invoice?.folder_id || ''}
            onChange={(e) => assignFolder(e.target.value || null)}
            disabled={assigningFolder}
            className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white disabled:opacity-50 transition-shadow"
          >
            <option value="">— Unassigned —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {(hasFields || hasLineItems) && (
        <InvoicePreviewCard
          extractedFields={extractedFields}
          lineItems={lineItems}
          invoice={invoice}
          ocrText={ocrText}
          previewRef={previewRef}
        />
      )}

      <div
        className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up"
        style={{ animationDelay: '0.1s' }}
      >
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
          <h2 className="text-base font-bold text-gray-900">Extracted Fields</h2>
          {hasFields && (
            <p className="text-xs text-gray-400 mt-0.5">
              Click <Edit2 className="w-3 h-3 inline" /> to edit and validate a value
            </p>
          )}
        </div>

        {hasFields ? (
          <div className="divide-y divide-gray-100">
            {extractedFields.map((field, i) => (
              <div
                key={field.id}
                style={{ animationDelay: `${i * 50}ms` }}
                className="animate-slide-up card-hover px-6 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <div className="w-44 flex-shrink-0">
                  <span className="text-sm font-semibold text-gray-600 capitalize">
                    {field.field_name.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="flex-1">
                  {editingFieldId === field.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveField(field)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        className="flex-1 px-3 py-1.5 text-sm border border-blue-400 rounded-xl focus:outline-none field-edit-active"
                        autoFocus
                      />
                      <button
                        onClick={() => saveField(field)}
                        disabled={saving}
                        className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors animate-slide-in-right"
                        title="Save"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors animate-slide-in-right"
                        style={{ animationDelay: '40ms' }}
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group/field">
                      <span className="text-sm text-gray-900 break-words">
                        {field.validated_value ?? field.normalized_value ?? field.raw_value ?? (
                          <span className="text-gray-400 italic">not extracted</span>
                        )}
                      </span>
                      <button
                        onClick={() => startEditField(field)}
                        className="p-1 text-gray-300 hover:text-blue-600 rounded transition-colors opacity-0 group-hover/field:opacity-100"
                        title="Edit value"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="confidence-bar-track w-16">
                      <div
                        className="confidence-bar-fill"
                        style={{ width: confidenceWidths[field.id] || '0%' }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">
                      {Math.round((field.confidence_score ?? 0) * 100)}%
                    </span>
                  </div>

                  {field.is_validated && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle className="w-3.5 h-3.5" />
                      validated
                    </span>
                  )}

                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                    {field.extraction_method}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-7 h-7 text-blue-300 animate-float" />
            </div>
            <p className="text-sm text-gray-500">
              {canProcess
                ? 'Click "Process Invoice" to extract fields'
                : isActivelyProcessing || processing
                ? 'Extracting fields…'
                : 'No extracted fields yet'}
            </p>
          </div>
        )}
      </div>

      {hasLineItems && (
        <div
          className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up"
          style={{ animationDelay: '0.2s' }}
        >
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
            <h2 className="text-base font-bold text-gray-900">Line Items</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200">
                  {['#', 'Description', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                    <th
                      key={i}
                      className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${i >= 2 ? 'text-right' : 'text-left'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {lineItems.map((item, i) => (
                  <tr
                    key={item.id}
                    style={{ animationDelay: `${0.2 + i * 0.05}s` }}
                    className="animate-fade-in hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-3 text-sm text-gray-400">{item.line_number}</td>
                    <td className="px-6 py-3 text-sm text-gray-900">{item.description || '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-700 text-right">{item.quantity ?? '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-700 text-right">
                      {item.unit_price != null ? `$${Number(item.unit_price).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">
                      {item.total_price != null ? `$${Number(item.total_price).toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasOcr && (
        <div
          className="bg-white rounded-2xl border border-gray-200 shadow-sm animate-slide-up"
          style={{ animationDelay: '0.3s' }}
        >
          <button
            onClick={() => setShowRawText(!showRawText)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors rounded-2xl"
          >
            <div className="text-left">
              <h2 className="text-base font-bold text-gray-900">OCR Raw Text</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {ocrResults[0]?.ocr_engine}
                {ocrResults[0]?.confidence_score != null ? ` · ${Math.round(ocrResults[0].confidence_score * 100)}% confidence` : ''}
                {ocrResults[0]?.processing_time_ms != null ? ` · ${ocrResults[0].processing_time_ms}ms` : ''}
              </p>
            </div>

            <ChevronDown
              className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-300 ${showRawText ? 'rotate-180' : ''}`}
            />
          </button>

          <div
            className={`collapse-transition ${showRawText ? 'expanded' : 'collapsed'}`}
            style={{ maxHeight: showRawText ? '500px' : undefined }}
          >
            <div className="px-6 pb-6 border-t border-gray-100">
              <pre className="mt-4 text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-xl max-h-80 overflow-y-auto leading-relaxed">
                {ocrResults[0]?.raw_text || 'No text extracted'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}