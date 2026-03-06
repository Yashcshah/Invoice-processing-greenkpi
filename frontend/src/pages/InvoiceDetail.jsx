import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit2,
  X,
  Check,
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

  const [editingFieldId, setEditingFieldId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const pollRef = useRef(null)

  useEffect(() => {
    fetchData()
    return () => clearInterval(pollRef.current)
  }, [id])

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
          setInvoice(prev => prev ? { ...prev, status: res.data.status } : prev)
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
      setExtractedFields(prev =>
        prev.map(f =>
          f.id === field.id
            ? { ...f, validated_value: editValue, normalized_value: editValue, is_validated: true }
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

  const isActivelyProcessing = invoice && PROCESSING_STATUSES.includes(invoice.status)
  const canProcess = invoice && ['uploaded', 'failed'].includes(invoice.status)
  const hasOcr = ocrResults.length > 0
  const hasFields = extractedFields.length > 0
  const hasLineItems = lineItems.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Invoices
        </button>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Invoices
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-50 rounded-lg mt-0.5">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {invoice?.original_filename}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {invoice?.file_type?.toUpperCase()}
                {invoice?.file_size_bytes
                  ? ` · ${(invoice.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
                  : ''}
                {invoice?.created_at
                  ? ` · Uploaded ${new Date(invoice.created_at).toLocaleDateString()}`
                  : ''}
                {invoice?.processed_at
                  ? ` · Processed ${new Date(invoice.processed_at).toLocaleDateString()}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <span
              className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[invoice?.status] || 'bg-gray-100 text-gray-700'}`}
            >
              {invoice?.status?.replace(/_/g, ' ')}
            </span>
            {(canProcess || isActivelyProcessing || processing) && (
              <button
                onClick={processInvoice}
                disabled={processing || isActivelyProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                <RefreshCw
                  className={`w-4 h-4 ${processing || isActivelyProcessing ? 'animate-spin' : ''}`}
                />
                {processing || isActivelyProcessing ? 'Processing...' : 'Process Invoice'}
              </button>
            )}
            {!canProcess && !isActivelyProcessing && !processing && hasOcr && (
              <button
                onClick={processInvoice}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Reprocess
              </button>
            )}
          </div>
        </div>

        {processError && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {processError}
          </div>
        )}
      </div>

      {/* Extracted Fields */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Extracted Fields</h2>
          {hasFields && (
            <p className="text-sm text-gray-500 mt-0.5">
              Click <Edit2 className="w-3 h-3 inline" /> to edit and validate a value
            </p>
          )}
        </div>

        {hasFields ? (
          <div className="divide-y divide-gray-100">
            {extractedFields.map((field) => (
              <div key={field.id} className="px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                {/* Field name */}
                <div className="w-40 flex-shrink-0">
                  <span className="text-sm font-medium text-gray-600 capitalize">
                    {field.field_name.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Field value */}
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
                        className="flex-1 px-3 py-1.5 text-sm border border-blue-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => saveField(field)}
                        disabled={saving}
                        className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        title="Save"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-900">
                        {field.validated_value ?? field.normalized_value ?? field.raw_value ?? (
                          <span className="text-gray-400 italic">not extracted</span>
                        )}
                      </span>
                      <button
                        onClick={() => startEditField(field)}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                        title="Edit value"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400">
                    {Math.round((field.confidence_score ?? 0) * 100)}%
                  </span>
                  {field.is_validated && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
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
          <div className="text-center py-10">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {canProcess
                ? 'Click "Process Invoice" to extract fields'
                : isActivelyProcessing || processing
                ? 'Extracting fields...'
                : 'No extracted fields yet'}
            </p>
          </div>
        )}
      </div>

      {/* Line Items */}
      {hasLineItems && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Line Items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lineItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm text-gray-500">{item.line_number}</td>
                    <td className="px-6 py-3 text-sm text-gray-900">{item.description || '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-900 text-right">{item.quantity ?? '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-900 text-right">
                      {item.unit_price != null ? `$${Number(item.unit_price).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                      {item.total_price != null ? `$${Number(item.total_price).toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OCR Raw Text */}
      {hasOcr && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowRawText(!showRawText)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-base font-semibold text-gray-900">OCR Raw Text</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {ocrResults[0]?.ocr_engine}
                {ocrResults[0]?.confidence_score != null
                  ? ` · ${Math.round(ocrResults[0].confidence_score * 100)}% confidence`
                  : ''}
                {ocrResults[0]?.processing_time_ms != null
                  ? ` · ${ocrResults[0].processing_time_ms}ms`
                  : ''}
              </p>
            </div>
            {showRawText ? (
              <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
            )}
          </button>
          {showRawText && (
            <div className="px-6 pb-6 border-t border-gray-100">
              <pre className="mt-4 text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-lg max-h-80 overflow-y-auto">
                {ocrResults[0]?.raw_text || 'No text extracted'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
