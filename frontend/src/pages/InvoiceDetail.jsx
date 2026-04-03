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
  if (text.length > 160) return true

  const badKeywords = [
    'invoice details',
    'property details',
    'water charges summary',
    'gas consumption charges',
    'electricity usage summary',
    'electricity usage charges',
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

const safeShortField = (fields, name, fallback = '', maxLen = 80) => {
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
  if (value == null || value === '' || value === '-') return '-'
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  const num = Number(cleaned)
  if (Number.isNaN(num)) return String(value)
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

const formatRate = (rate, quantity) => {
  const rateText = cleanText(rate)
  if (!rateText || rateText === '-') return '-'

  if (/[A-Za-z]+\//.test(rateText) || /\/[A-Za-z]+/i.test(rateText)) {
    return rateText.startsWith('$') ? rateText : `$${rateText}`
  }

  const cleaned = rateText.replace(/[^0-9.-]/g, '')
  const num = Number(cleaned)
  if (Number.isNaN(num)) return rateText

  const q = String(quantity || '').toLowerCase()
  let suffix = ''
  if (q.includes('kl')) suffix = '/kL'
  else if (q.includes('mj')) suffix = '/MJ'
  else if (q.includes('kwh')) suffix = '/kWh'

  return `$${num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}${suffix}`
}



const getPreviewStyle = () => {
  return {
    subtitle: 'Billing Statement',
    infoTitle: 'Customer & Site Information',
    chargesTitle: 'Charges Summary',
    customerLabel: 'Customer',
    siteLabel: 'Site',
    addressLabel: 'Address',
    meterLabel: 'Meter ID',
    accent: '#0d7f7a',
    sectionBg: '#e9f2f2',
    tableHeaderBg: '#2f9e9e',
    summaryBg: '#f4f4f4',
    accountTitle: 'ACCOUNT',
    totalLabel: 'TOTAL',
  }
}

function InvoicePreviewCard({
  extractedFields,
  lineItems,
  invoice,
  previewRef,
  onEditField,
}) {
  const ui = getPreviewStyle()

  const getFieldObj = (...names) =>
    extractedFields.find((f) => names.includes(f.field_name))

  const vendorName =
    safeShortField(extractedFields, 'vendor_name') ||
    safeShortField(extractedFields, 'supplier_name') ||
    '-'

  const abn = safeShortField(extractedFields, 'abn', '-', 30) || '-'

  const invoiceNumber =
    safeShortField(extractedFields, 'invoice_number', '', 40) ||
    safeShortField(extractedFields, 'invoice_id', '', 40) ||
    '-'

  const invoiceDate = safeShortField(extractedFields, 'invoice_date', '-', 30) || '-'
  const dueDate = safeShortField(extractedFields, 'due_date', '-', 30) || '-'
  const billingPeriod = safeField(extractedFields, 'billing_period', '-') || '-'

  const customerName =
    safeShortField(extractedFields, 'customer_name') ||
    safeShortField(extractedFields, 'company_name') ||
    '-'

  const siteName =
    safeShortField(extractedFields, 'site_name', '', 60) ||
    safeShortField(extractedFields, 'property_type', '', 60) ||
    '-'

  const supplyAddress =
    safeField(extractedFields, 'supply_address', '') ||
    safeField(extractedFields, 'property_address', '') ||
    '-'

  const tariffType =
    safeShortField(extractedFields, 'tariff_type', '', 60) ||
    safeShortField(extractedFields, 'plan_name', '', 60) ||
    safeShortField(extractedFields, 'service_type', '', 60) ||
    '-'

  const meterId = safeShortField(extractedFields, 'meter_id', '-', 40) || '-'

  const subtotal = safeShortField(extractedFields, 'subtotal', '-', 20) || '-'
  const gst =
    safeShortField(extractedFields, 'gst', '', 20) ||
    safeShortField(extractedFields, 'tax_amount', '', 20) ||
    '-'
  const totalAmount =
    safeShortField(extractedFields, 'total_amount', '', 20) ||
    safeShortField(extractedFields, 'total_amount_due', '', 20) ||
    '-'

const cleanedLineItems = (lineItems || [])
  .filter((item) => {
    const desc = cleanText(item.description)
    const qty = cleanText(item.quantity)
    const rate = cleanText(item.unit_price)
    const total = cleanText(item.total_price)

    return desc || qty || rate || total
  })
  .map((item, index) => ({
    id: item.id ?? index + 1,
    description: cleanText(item.description) || '-',
    quantity: cleanText(item.quantity) || '-',
    unit_price: cleanText(item.unit_price) || '-',
    total_price: cleanText(item.total_price) || '-',
  }))

  const EditableValue = ({ fieldNames, displayValue, className = '' }) => {
    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames]
    const field = getFieldObj(...names)

    if (!field) {
      return <span className={className}>{displayValue}</span>
    }

    return (
      <button
        type="button"
        onClick={() => onEditField(field)}
        className={`text-left hover:bg-yellow-50 rounded px-1 -mx-1 transition ${className}`}
        title="Click to edit"
      >
        {displayValue}
      </button>
    )
  }

  
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
        <h2 className="text-base font-bold text-gray-900">Invoice Preview</h2>
        <p className="text-xs text-gray-400 mt-0.5">Click a value to edit it</p>
      </div>

      <div className="p-4 md:p-8 bg-gray-50">
        <div
          ref={previewRef}
          className="mx-auto max-w-5xl bg-[#f8f8f5] border border-gray-200 shadow-sm px-5 py-6 md:px-8 md:py-8"
        >
          <div className="mb-6">
            <div className="text-center">
              <h1
                className="text-[28px] leading-tight font-bold tracking-wide"
                style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
              >
                <EditableValue
                  fieldNames={['vendor_name', 'supplier_name']}
                  displayValue={textOrDash(vendorName)}
                />
              </h1>
            </div>

            <div className="mt-3 text-left text-[15px] leading-7 text-gray-900">
              <div>{ui.subtitle}</div>
              <div>
                ABN: <EditableValue fieldNames="abn" displayValue={textOrDash(abn)} />
              </div>
            </div>
          </div>

          <div
            className="border text-center font-bold text-[18px] py-2 mb-6"
            style={{ color: ui.accent, borderColor: ui.accent }}
          >
            {ui.accountTitle}
          </div>

          <div className="border border-gray-400 bg-white mb-8 overflow-hidden">
            <table className="w-full border-collapse text-[15px]">
              <tbody>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 font-medium w-[20%]">
                    Invoice ID
                  </td>
                  <td className="border border-gray-300 px-3 py-2 w-[30%]">
                    <EditableValue
                      fieldNames={['invoice_number', 'invoice_id']}
                      displayValue={textOrDash(invoiceNumber)}
                    />
                  </td>
                  <td className="border border-gray-300 px-3 py-2 font-medium w-[20%]">
                    Invoice Date
                  </td>
                  <td className="border border-gray-300 px-3 py-2 w-[30%]">
                    <EditableValue
                      fieldNames="invoice_date"
                      displayValue={formatDate(invoiceDate)}
                    />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 font-medium">
                    Billing Period
                  </td>
                  <td className="border border-gray-300 px-3 py-2">
                    <EditableValue
                      fieldNames="billing_period"
                      displayValue={textOrDash(billingPeriod)}
                    />
                  </td>
                  <td className="border border-gray-300 px-3 py-2 font-medium">Due Date</td>
                  <td className="border border-gray-300 px-3 py-2">
                    <EditableValue
                      fieldNames="due_date"
                      displayValue={formatDate(dueDate)}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-10">
            <h3
              className="font-bold text-[18px] mb-3"
              style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
            >
              {ui.infoTitle}
            </h3>

            <table className="w-full border-collapse text-[15px] bg-white">
              <tbody>
                <tr>
                  <td
                    className="border border-gray-300 px-3 py-2 font-medium w-[25%]"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.customerLabel}
                  </td>
                  <td className="border border-gray-300 px-3 py-2">
                    <EditableValue
                      fieldNames={['customer_name', 'company_name']}
                      displayValue={textOrDash(customerName)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-gray-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.siteLabel}
                  </td>
                  <td className="border border-gray-300 px-3 py-2">
                    <EditableValue
                      fieldNames={['site_name', 'property_type']}
                      displayValue={textOrDash(siteName)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-gray-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.addressLabel}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 break-words">
                    <EditableValue
                      fieldNames={['supply_address', 'property_address']}
                      displayValue={textOrDash(supplyAddress)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-gray-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.meterLabel}
                  </td>
                  <td className="border border-gray-300 px-3 py-2">
                    <EditableValue fieldNames="meter_id" displayValue={textOrDash(meterId)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <h3
              className="font-bold text-[18px] mb-3"
              style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
            >
             {ui.chargesTitle}
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[15px] bg-white">
                <thead>
                  <tr style={{ backgroundColor: ui.tableHeaderBg }} className="text-white">
                    <th className="border border-gray-400 px-3 py-2 text-left">Description</th>
                    <th className="border border-gray-400 px-3 py-2 text-left">Usage</th>
                    <th className="border border-gray-400 px-3 py-2 text-left">Rate</th>
                    <th className="border border-gray-400 px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cleanedLineItems.length > 0 ? (
                    cleanedLineItems.map((item) => (
                      <tr key={item.id}>
                        <td className="border border-gray-300 px-3 py-2">
                          {textOrDash(item.description)}
                        </td>
                        <td className="border border-gray-300 px-3 py-2">
                          {textOrDash(item.quantity)}
                        </td>
                        <td className="border border-gray-300 px-3 py-2">
                          {formatRate(item.unit_price, item.quantity)}
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-right">
                          {money(item.total_price)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="border border-gray-300 px-3 py-3 text-gray-400 italic"
                        colSpan={4}
                      >
                        No line items extracted
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-center">
            <table
              className="w-full max-w-xl border-collapse text-[15px]"
              style={{ backgroundColor: ui.summaryBg }}
            >
              <tbody>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 font-medium">Subtotal</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">
                    <EditableValue fieldNames="subtotal" displayValue={money(subtotal)} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 font-medium">GST (10%)</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">
                    <EditableValue
                      fieldNames={['tax_amount', 'gst']}
                      displayValue={money(gst)}
                    />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 font-bold">
                    {ui.totalLabel}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-bold">
                    <EditableValue
                      fieldNames={['total_amount', 'total_amount_due']}
                      displayValue={money(totalAmount)}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-8 text-xs text-gray-400">
            Preview generated from backend extracted fields for {invoice?.original_filename}
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
        scale: 1.2,
        useCORS: true,
        backgroundColor: '#f8f8f5',
        logging: false,
      })

      const imgData = canvas.toDataURL('image/jpeg', 0.72)

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      })

      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = pdf.internal.pageSize.getHeight()

      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      let heightLeft = imgHeight
      let position = 0

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight

      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
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
  previewRef={previewRef}
  onEditField={startEditField}
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
                    <div className="flex items-center justify-between gap-3 group/field">
                      <span className="text-sm text-gray-900 break-words flex-1">
                        {field.validated_value ?? field.normalized_value ?? field.raw_value ?? (
                          <span className="text-gray-400 italic">not extracted</span>
                        )}
                      </span>

                      <button
                        type="button"
                        onClick={() => startEditField(field)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors text-xs font-medium"
                        title="Edit value"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
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
                      {formatRate(item.unit_price, item.quantity)}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">
                      {money(item.total_price)}
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