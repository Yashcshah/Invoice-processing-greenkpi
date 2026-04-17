import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { StatusPill, ConfidenceBar, KpiChip, FieldConfidenceMiniChart } from '../components/ui'
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
import { supabase } from '../lib/supabase'

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
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up hover:shadow-lg transition-shadow duration-200">
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

// ─────────────────────────────────────────────────────────────────────────────
// FIELD SECTION CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_SECTIONS = [
  {
    id:     'amounts',
    title:  'Amounts',
    fields: ['total_amount', 'subtotal', 'tax_amount'],
    align:  'right',
  },
  {
    id:     'details',
    title:  'Invoice Details',
    fields: ['invoice_number', 'invoice_date', 'due_date', 'billing_period', 'vendor_name'],
    align:  'left',
  },
  {
    id:     'customer',
    title:  'Customer & Site',
    fields: ['customer_name', 'site_name', 'supply_address', 'meter_id', 'abn'],
    align:  'left',
  },
]

const KNOWN_FIELDS = new Set(FIELD_SECTIONS.flatMap(s => s.fields))

// ── Method pill helpers ───────────────────────────────────────────────────────

const METHOD_STYLE = {
  cluster_rule:   { label: 'agent learned', cls: 'bg-violet-100 text-violet-700' },
  agent_learned:  { label: 'agent learned', cls: 'bg-violet-100 text-violet-700' },
  llm_extraction: { label: 'llm',           cls: 'bg-blue-100   text-blue-700'   },
  llm:            { label: 'llm',           cls: 'bg-blue-100   text-blue-700'   },
  'llm+gnn':      { label: 'llm + gnn',     cls: 'bg-indigo-100 text-indigo-700' },
  gnn:            { label: 'gnn',           cls: 'bg-indigo-100 text-indigo-700' },
  row_label:      { label: 'layout',        cls: 'bg-cyan-100   text-cyan-700'   },
  summary_label:  { label: 'layout',        cls: 'bg-cyan-100   text-cyan-700'   },
  vendor_top:     { label: 'layout',        cls: 'bg-cyan-100   text-cyan-700'   },
  regex:          { label: 'regex',         cls: 'bg-gray-100   text-gray-500'   },
  position_based: { label: 'position',      cls: 'bg-gray-100   text-gray-500'   },
}

function MethodPill({ method }) {
  const cfg = METHOD_STYLE[method] ?? { label: method ?? '—', cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold leading-tight ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ── Inline edit controls ──────────────────────────────────────────────────────

function InlineEdit({ field, editValue, setEditValue, saving, onSave, onCancel }) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <input
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  onSave(field)
          if (e.key === 'Escape') onCancel()
        }}
        aria-label={`Edit ${field.field_name.replace(/_/g, ' ')}`}
        className="flex-1 px-2.5 py-1 text-sm border border-blue-400 rounded-lg focus:outline-none field-edit-active min-w-0"
        autoFocus
      />
      <button
        onClick={() => onSave(field)}
        disabled={saving}
        title="Save"
        aria-label="Save edit"
        className="p-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel edit"
        className="p-1 border border-gray-200 text-gray-500 rounded-md hover:bg-gray-50 transition-colors flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Single field row ──────────────────────────────────────────────────────────

function FieldRow({ field, align, editingFieldId, editValue, setEditValue, saving, onEdit, onSave, onCancel }) {
  const isEditing = editingFieldId === field.id
  const displayValue = field.validated_value ?? field.normalized_value ?? field.raw_value

  return (
    <div className="group py-2.5 first:pt-0 last:pb-0">
      {/* Label + validated badge */}
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide leading-none">
          {field.field_name.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-1">
          {field.is_validated && (
            <span
              aria-label="Field has been validated"
              className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-semibold"
            >
              <CheckCircle className="w-3 h-3" aria-hidden="true" />
              validated
            </span>
          )}
          <MethodPill method={field.extraction_method} />
        </div>
      </div>

      {/* Value */}
      {isEditing ? (
        <InlineEdit
          field={field}
          editValue={editValue}
          setEditValue={setEditValue}
          saving={saving}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : (
        <button
          type="button"
          onClick={() => onEdit(field)}
          aria-label={`Edit ${field.field_name.replace(/_/g, ' ')}: ${displayValue ?? 'empty'}`}
          className={[
            'w-full text-left rounded-lg px-2.5 py-1.5 transition-all duration-150',
            'hover:ring-2 hover:ring-blue-200 hover:bg-white cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-blue-400 outline-none',
            align === 'right' ? 'text-right' : '',
          ].join(' ')}
        >
          {displayValue ? (
            <span className={`text-sm font-semibold text-gray-900 ${align === 'right' ? 'font-mono tabular-nums' : ''}`}>
              {displayValue}
            </span>
          ) : (
            <span className="text-xs text-gray-300 italic">not extracted</span>
          )}
        </button>
      )}

      {/* Confidence bar */}
      {field.confidence_score != null && (
        <ConfidenceBar
          value={field.confidence_score}
          showLabel
          className="mt-1.5"
        />
      )}
    </div>
  )
}

// ── Inline GST check ──────────────────────────────────────────────────────────

function computeGstStatus(fields) {
  const find = name => {
    const f = fields.find(f => f.field_name === name)
    return parseFloat((f?.validated_value ?? f?.normalized_value ?? f?.raw_value ?? '').replace(/[^0-9.]/g, '')) || null
  }
  const subtotal = find('subtotal')
  const tax      = find('tax_amount')
  const total    = find('total_amount')
  if (!subtotal || !tax) return null
  const expected = subtotal * 0.1
  const ok = Math.abs(tax - expected) / expected < 0.05   // within 5 %
  const hasRetention = fields.some(f =>
    (f.validated_value ?? f.normalized_value ?? f.raw_value ?? '').toLowerCase().includes('retention')
  )
  return { ok, hasRetention }
}

// ── ExtractedFieldsPanel ──────────────────────────────────────────────────────

function ExtractedFieldsPanel({
  fields,
  editingFieldId,
  editValue,
  setEditValue,
  saving,
  onEdit,
  onSave,
  onCancel,
  canProcess,
  isActivelyProcessing,
  processing,
  avgConfidence,
  greenKpiData,
  greenKpiLoading,
}) {
  if (!fields.length) {
    return (
      <div
        className="bg-white rounded-xl shadow-sm p-6 flex flex-col items-center justify-center text-center"
        style={{ minHeight: '220px' }}
        aria-label="Extracted fields — empty"
      >
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-blue-300 animate-float" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-gray-500">
          {canProcess
            ? 'Click "Process Invoice" to extract fields'
            : isActivelyProcessing || processing
            ? 'Extracting fields…'
            : 'No extracted fields yet'}
        </p>
      </div>
    )
  }

  // Build section → field lookup
  const byName = Object.fromEntries(fields.map(f => [f.field_name, f]))
  const otherFields = fields.filter(f => !KNOWN_FIELDS.has(f.field_name))

  const gst = computeGstStatus(fields)

  const sharedRowProps = { editingFieldId, editValue, setEditValue, saving, onEdit, onSave, onCancel }

  return (
    <aside
      className="bg-white rounded-xl shadow-sm overflow-hidden animate-slide-up hover:shadow-lg transition-shadow duration-200"
      style={{ animationDelay: '0.05s' }}
      aria-label="Extracted fields panel"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Extracted Fields</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Tap any value to edit &amp; validate
          </p>
        </div>
        {avgConfidence !== null && (
          <div className="text-right flex-shrink-0 ml-3">
            <p className="text-base font-bold text-blue-600 leading-none tabular-nums">
              {avgConfidence}%
            </p>
            <p className="text-[10px] text-gray-400">avg conf.</p>
          </div>
        )}
      </div>

      {/* Mini overall confidence bar */}
      {avgConfidence !== null && (
        <div className="px-4 pt-3 pb-1">
          <ConfidenceBar value={avgConfidence / 100} showLabel={false} className="w-full" />
        </div>
      )}

      {/* Field sections */}
      <div className="px-4 pb-3 divide-y divide-gray-100">
        {FIELD_SECTIONS.map(section => {
          const sectionFields = section.fields
            .map(name => byName[name])
            .filter(Boolean)
          if (!sectionFields.length) return null

          return (
            <div key={section.id} className="py-3 first:pt-2">
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">
                {section.title}
              </p>
              <div className="divide-y divide-gray-50">
                {sectionFields.map(field => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    align={section.align}
                    {...sharedRowProps}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {/* Other / uncategorised fields */}
        {otherFields.length > 0 && (
          <div className="py-3">
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">
              Other
            </p>
            <div className="divide-y divide-gray-50">
              {otherFields.map(field => (
                <FieldRow
                  key={field.id}
                  field={field}
                  align="left"
                  {...sharedRowProps}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-field confidence mini chart */}
      {fields.some(f => f.confidence_score != null) && (
        <div className="px-4 pt-2 pb-3 border-t border-gray-100">
          <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">
            Field Confidence
          </p>
          <FieldConfidenceMiniChart fields={fields} height={Math.max(28 * 4, 120)} />
        </div>
      )}

      {/* KPI strip */}
      {gst !== null && (
        <div
          className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-wrap gap-1.5"
          aria-label="Compliance flags"
        >
          <KpiChip type={gst.ok ? 'gst_ok' : 'gst_issue'} />
          {gst.hasRetention && <KpiChip type="retention_clause" />}
        </div>
      )}
    </aside>
  )
}

// ── OCR collapsible ───────────────────────────────────────────────────────────

function OcrCollapsible({ ocrResults }) {
  const [open, setOpen] = useState(false)

  if (!ocrResults?.length) return null

  const result   = ocrResults[0]
  const engine   = result.ocr_engine ?? 'OCR'
  const confPct  = result.confidence_score != null
    ? `${Math.round(result.confidence_score * 100)}% confidence`
    : null
  const timing   = result.processing_time_ms != null
    ? `${result.processing_time_ms}ms`
    : null

  const meta = [engine, confPct, timing].filter(Boolean).join(' · ')

  return (
    <div
      className="bg-white rounded-2xl border border-gray-200 shadow-sm animate-slide-up hover:shadow-lg transition-shadow duration-200"
      style={{ animationDelay: '0.3s' }}
    >
      {/* ── Header / toggle button ── */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="ocr-body"
        className="w-full px-6 py-4 flex items-center justify-between
                   hover:bg-gray-50 transition-colors duration-150 rounded-2xl
                   focus-visible:ring-2 focus-visible:ring-blue-400 outline-none"
      >
        <div className="text-left">
          <h2 className="text-base font-bold text-gray-900">OCR Raw Text</h2>
          <p className="text-xs text-gray-400 mt-0.5">{meta}</p>
        </div>

        <ChevronDown
          aria-hidden="true"
          className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Collapsible body — grid-rows trick gives smooth height animation ── */}
      <div
        id="ocr-body"
        className={`grid transition-all duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6 pt-1 border-t border-gray-100">
            <pre
              className="mt-3 text-sm text-gray-700 whitespace-pre-wrap font-mono
                         bg-gray-50 rounded-lg p-3 max-h-[300px] overflow-auto
                         leading-relaxed"
            >
              {result.raw_text || 'No text extracted'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Green KPI strip ───────────────────────────────────────────────────────────

// Sustainability tag types that map directly to KpiChip types
const SUSTAIN_TAG_TYPES = new Set([
  'solar', 'carbon_offset', 'renewable_energy', 'recycled_materials', 'energy_efficiency',
])

function GreenKpiStrip({ data, loading }) {
  if (loading) {
    return (
      <div className="h-14 rounded-xl shimmer-bg" aria-hidden="true" />
    )
  }

  if (!data) return null

  const flags    = data.compliance_flags   ?? {}
  const tags     = data.sustainability_tags ?? []

  // Build ordered chip list
  const chips = []

  // GST compliance chip
  if (flags.gst_valid != null) {
    chips.push(<KpiChip key="gst" type={flags.gst_valid ? 'gst_ok' : 'gst_issue'} />)
  }

  // QBCC chip (only when QBCC keywords detected)
  if (flags.qbcc_detected) {
    chips.push(<KpiChip key="qbcc" type="qbcc_missing" />)
  }

  // Retention clause chip
  if (flags.retention_detected) {
    chips.push(<KpiChip key="retention" type="retention_clause" />)
  }

  // Sustainability tags — map known ones to KpiChip types, unknown ones as plain pills
  tags.forEach((tag, i) => {
    const type = SUSTAIN_TAG_TYPES.has(tag) ? tag : null
    if (type) {
      chips.push(<KpiChip key={`tag-${i}`} type={type} />)
    } else {
      chips.push(
        <span
          key={`tag-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold border border-teal-100"
        >
          {tag.replace(/_/g, ' ')}
        </span>
      )
    }
  })

  if (!chips.length) return null

  // Summary text
  const tagCount   = tags.length
  const gstLabel   = flags.gst_valid == null ? '' : flags.gst_valid ? 'GST OK' : 'GST Issue'
  const summaryParts = []
  if (tagCount > 0) summaryParts.push(`${tagCount} green tag${tagCount !== 1 ? 's' : ''}`)
  if (gstLabel)     summaryParts.push(gstLabel)
  const summary = summaryParts.join(' · ')

  return (
    <div
      className="bg-white rounded-xl shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 animate-slide-up hover:shadow-md transition-shadow duration-200"
      role="region"
      aria-label="Green KPI snapshot"
    >
      {/* Left: title */}
      <div className="flex-shrink-0">
        <p className="text-xs font-bold text-gray-700 leading-none">Green KPI</p>
        <p className="text-[10px] text-gray-400 mt-0.5">Compliance &amp; sustainability</p>
      </div>

      {/* Centre: chips */}
      <div className="flex flex-wrap gap-1.5 flex-1">
        {chips}
      </div>

      {/* Right: summary text */}
      {summary && (
        <p className="text-[11px] text-gray-400 font-medium flex-shrink-0 whitespace-nowrap">
          {summary}
        </p>
      )}
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
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  const [editingFieldId, setEditingFieldId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [greenKpiData, setGreenKpiData] = useState(null)
  const [greenKpiLoading, setGreenKpiLoading] = useState(false)

  const [folders, setFolders] = useState([])
  const [assigningFolder, setAssigningFolder] = useState(false)

  const [mounted, setMounted] = useState(false)
  const [confidenceWidths, setConfidenceWidths] = useState({})

  const channelRef = useRef(null)
  const previewRef = useRef(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const fetchGreenKpi = async () => {
    setGreenKpiLoading(true)
    try {
      const res = await axios.get(`/api/green-kpi/invoices/${id}`)
      setGreenKpiData(res.data?.data ?? res.data ?? null)
    } catch {
      // Silently skip — green KPI is non-critical
    } finally {
      setGreenKpiLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    fetchGreenKpi()
    axios.get('/api/folders').then(res => setFolders(res.data.folders)).catch(() => {})
    return () => {
      const ref = channelRef.current
      if (!ref) return
      if (ref._isFallback) {
        clearInterval(ref._intervalId)
      } else {
        supabase.removeChannel(ref)
      }
      channelRef.current = null
    }
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

  const startRealtime = () => {
    // Remove any existing channel before creating a new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    const channel = supabase
      .channel(`invoice-status-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'invoices', filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new
          setInvoice(prev => prev ? { ...prev, ...updated } : updated)

          if (!PROCESSING_STATUSES.includes(updated.status)) {
            // Processing finished — fetch full data (fields, OCR, line items)
            setProcessing(false)
            fetchData()
            supabase.removeChannel(channel)
            channelRef.current = null
          }
        }
      )
      .subscribe((status) => {
        // If Realtime subscription fails, fall back to polling
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Realtime] subscription failed, falling back to polling')
          supabase.removeChannel(channel)
          channelRef.current = null
          _startPollingFallback()
        }
      })

    channelRef.current = channel
  }

  const _startPollingFallback = () => {
    const intervalId = setInterval(async () => {
      try {
        const res = await axios.get(`/api/processing/status/${id}`)
        if (!PROCESSING_STATUSES.includes(res.data.status)) {
          clearInterval(intervalId)
          setProcessing(false)
          fetchData()
        } else {
          setInvoice((prev) => (prev ? { ...prev, status: res.data.status } : prev))
        }
      } catch {
        clearInterval(intervalId)
        setProcessing(false)
      }
    }, 2500)
    channelRef.current = { _isFallback: true, _intervalId: intervalId }
  }

  const processInvoice = async () => {
    setProcessing(true)
    setProcessError(null)
    try {
      await axios.post('/api/processing/process', { invoice_id: id })
      startRealtime()
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

  // Average confidence across all extracted fields (0–100 %)
  const avgConfidence = (() => {
    const scores = extractedFields
      .map(f => f.confidence_score)
      .filter(s => s != null && !Number.isNaN(Number(s)))
    if (!scores.length) return null
    return Math.round(scores.reduce((a, b) => a + Number(b), 0) / scores.length * 100)
  })()

  // Human-readable file metadata string
  const fileMeta = [
    invoice?.file_type?.toUpperCase() || 'FILE',
    invoice?.file_size_bytes
      ? `${(invoice.file_size_bytes / 1024).toFixed(0)} KB`
      : null,
    invoice?.created_at
      ? `Uploaded ${new Date(invoice.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : null,
    invoice?.processed_at
      ? `Processed ${new Date(invoice.processed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
      : null,
  ].filter(Boolean).join(' · ')

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

        {/* ── Summary bar ───────────────────────────────────────────────── */}
        <div
          className="bg-white shadow-sm rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:shadow-md transition-shadow duration-200"
          role="region"
          aria-label="Invoice summary"
        >

          {/* ── LEFT: file identity ───────────────────────────────── */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              aria-hidden="true"
              className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"
            >
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h1
                className="text-base font-bold text-gray-900 truncate"
                title={invoice?.original_filename}
              >
                {invoice?.original_filename}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5 truncate" title={fileMeta}>
                {fileMeta}
              </p>
            </div>
          </div>

          {/* ── CENTER: status ────────────────────────────────────── */}
          <div className="flex items-center justify-start sm:justify-center flex-shrink-0">
            <StatusPill status={invoice?.status} />
          </div>

          {/* ── RIGHT: confidence chip + action buttons ───────────── */}
          <div className="flex items-center gap-2 flex-wrap justify-start sm:justify-end flex-shrink-0">

            {/* Avg confidence chip */}
            {avgConfidence !== null && (
              <span
                aria-label={`Average extraction confidence: ${avgConfidence}%`}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border select-none',
                  avgConfidence >= 80
                    ? 'bg-green-50  text-green-700  border-green-200'
                    : avgConfidence >= 55
                    ? 'bg-blue-50   text-blue-700   border-blue-200'
                    : 'bg-orange-50 text-orange-700 border-orange-200',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'w-1.5 h-1.5 rounded-full',
                    avgConfidence >= 80 ? 'bg-green-500'
                    : avgConfidence >= 55 ? 'bg-blue-500'
                    : 'bg-orange-500',
                  ].join(' ')}
                />
                Avg confidence {avgConfidence}%
              </span>
            )}

            {/* Export PDF */}
            <button
              onClick={exportPreviewAsPdf}
              disabled={exportingPdf || (!hasFields && !hasLineItems)}
              aria-label={exportingPdf ? 'Exporting PDF…' : 'Export invoice as PDF'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                         border border-gray-200 text-gray-700 rounded-xl bg-white
                         hover:bg-gray-50 hover:scale-[1.02] active:scale-[0.98]
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                         transition-all duration-150 focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {exportingPdf ? 'Exporting…' : 'Export PDF'}
            </button>

            {/* Process / Reprocess */}
            {(canProcess || isActivelyProcessing || processing) ? (
              <button
                onClick={processInvoice}
                disabled={processing || isActivelyProcessing}
                aria-label={processing || isActivelyProcessing ? 'Processing invoice…' : 'Run AI processing pipeline'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                           bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl
                           hover:from-blue-700 hover:to-indigo-700
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-150 shadow-sm hover:shadow-md
                           hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                           focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${processing || isActivelyProcessing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {processing || isActivelyProcessing ? 'Processing…' : 'Process Invoice'}
              </button>
            ) : hasOcr ? (
              <button
                onClick={processInvoice}
                aria-label="Reprocess invoice through the AI pipeline"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                           border border-gray-200 text-gray-600 rounded-xl bg-white
                           hover:bg-gray-50 hover:scale-[1.02] active:scale-[0.98]
                           transition-all duration-150
                           focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Reprocess
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Process error banner ──────────────────────────────────────── */}
        {processError && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-up"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {processError}
          </div>
        )}

        {/* ── Progress stepper (visible while pipeline is running) ─────── */}
        {(processing || isActivelyProcessing) && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 animate-slide-up">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Pipeline progress</p>

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

      {/* ═══════════════════════════════════════════════════════════
          TWO-COLUMN GRID
          col-span-2 → Invoice Preview   col-span-1 → Extracted Fields
          ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">

        {/* ── LEFT col (2/3): Invoice Preview ───────────────────── */}
        <div className="md:col-span-2 flex flex-col gap-2">

          {/* Helper hint */}
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Edit2 className="w-3 h-3 text-blue-400" aria-hidden="true" />
            Click any highlighted value to edit
          </p>

          {/* Preview card */}
          <div
            className="bg-blue-50 rounded-xl shadow-sm p-4 overflow-auto"
            style={{ maxHeight: '72vh' }}
            aria-label="Invoice preview"
          >
            {(hasFields || hasLineItems) ? (
              <InvoicePreviewCard
                extractedFields={extractedFields}
                lineItems={lineItems}
                invoice={invoice}
                previewRef={previewRef}
                onEditField={startEditField}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7 text-blue-300 animate-float" aria-hidden="true" />
                </div>
                <p className="text-sm text-gray-500 font-medium">No preview yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  {canProcess ? 'Click "Process Invoice" to extract data' : 'Process the invoice to generate a preview'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT col (1/3): Extracted Fields ─────────────────── */}
        <div className="md:col-span-1">
          <ExtractedFieldsPanel
            fields={extractedFields}
            editingFieldId={editingFieldId}
            editValue={editValue}
            setEditValue={setEditValue}
            saving={saving}
            onEdit={startEditField}
            onSave={saveField}
            onCancel={cancelEdit}
            canProcess={canProcess}
            isActivelyProcessing={isActivelyProcessing}
            processing={processing}
            avgConfidence={avgConfidence}
            greenKpiData={greenKpiData}
            greenKpiLoading={greenKpiLoading}
          />
        </div>
      </div>

      {/* ── Green KPI Strip (full width, below the preview + fields grid) ──── */}
      {(greenKpiLoading || greenKpiData) && (
        <GreenKpiStrip data={greenKpiData} loading={greenKpiLoading} />
      )}

      {hasLineItems && (
        <div
          className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up hover:shadow-lg transition-shadow duration-200"
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

      {hasOcr && <OcrCollapsible ocrResults={ocrResults} />}
    </div>
  )
}