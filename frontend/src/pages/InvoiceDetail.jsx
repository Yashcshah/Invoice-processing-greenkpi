import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  StatusPill,
  ConfidenceBar,
  KpiChip,
  FieldConfidenceMiniChart,
} from '../components/ui'
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
  Sparkles,
  Eye,
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

const TRAILING_LABEL_PATTERNS = [
  /\s+Tariff\s+Type\b.*$/i,
  /\s+Invoice\s+Date\b.*$/i,
  /\s+Due\s+Date\b.*$/i,
  /\s+Billing\s+Period\b.*$/i,
  /\s+(Restaurant|Residential|Commercial|Industrial|Retail|Office)\b.*$/i,
  /\s+General\s+Business\b.*$/i,
  /\s+(Peak|Off-?Peak|Total)\s+Usage\b.*$/i,
  /\s+Electricity\s+Usage\b.*$/i,
  /\s+Meter\s+ID\b.*$/i,
  /\s+Property\s+Type\b.*$/i,
  /\s+Supply\s+Address\b.*$/i,
]

const stripTrailingLabels = (value) => {
  let out = cleanText(value)
  for (const pattern of TRAILING_LABEL_PATTERNS) {
    out = out.replace(pattern, '').trim()
  }
  return out
}

const cleanDate = (value) => {
  const text = cleanText(value)
  if (!text) return ''

  const ddmmyyyy = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)
  if (ddmmyyyy) return ddmmyyyy[1]

  const isoDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoDate) return isoDate[1]

  return stripTrailingLabels(text)
}

const cleanBillingPeriod = (value) => {
  const text = cleanText(value)
  if (!text) return ''

  const range = text.match(
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|–|—|→)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i
  )
  if (range) return `${range[1]} to ${range[2]}`

  return stripTrailingLabels(text)
}

const extractBledTail = (value, labelRegex) => {
  const text = cleanText(value)
  const m = text.match(labelRegex)
  if (!m) return { head: text, tail: '' }
  const tail = text.slice(m.index + m[0].length).trim()
  const head = text.slice(0, m.index).trim()
  return { head, tail }
}

const isProbablyNoisy = (value) => {
  const text = cleanText(value)
  if (!text) return true
  if (text.length > 180) return true

  const badKeywords = [
    'invoice details',
    'property details',
    'water charges summary',
    'gas consumption charges',
    'electricity usage summary',
    'electricity usage charges',
    'total amount due',
    'subtotal',
    'description',
    'usage',
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

const parseMoney = (value) => {
  if (value == null || value === '' || value === '-') return null
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

const money = (value) => {
  if (value == null || value === '' || value === '-') return '-'
  const num = parseMoney(value)
  if (num == null) return String(value)
  return `$${num.toFixed(2)}`
}

const formatDate = (value) => {
  const text = cleanDate(value)
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

const getPreviewStyle = () => ({
  subtitle: 'Billing Statement',
  infoTitle: 'Customer & Site Information',
  chargesTitle: 'Charges Summary',
  customerLabel: 'Customer',
  siteLabel: 'Site',
  addressLabel: 'Address',
  meterLabel: 'Meter ID',
  accent: '#0f766e',
  sectionBg: '#ecfeff',
  tableHeaderBg: '#0f766e',
  summaryBg: '#f8fafc',
  accountTitle: 'ACCOUNT',
  totalLabel: 'TOTAL',
})

const synthesiseLineItems = (fields) => {
  const rows = []

  const tryRow = (descKey, qtyKey, rateKey, totalKey, label) => {
    const qty = safeShortField(fields, qtyKey, '', 30)
    const rate = safeShortField(fields, rateKey, '', 30)
    const total = safeShortField(fields, totalKey, '', 30)
    if (!qty && !rate && !total) return
    rows.push({
      id: `derived-${descKey}`,
      description: safeShortField(fields, descKey, label, 80) || label,
      quantity: qty || '-',
      unit_price: rate || '-',
      total_price: total || '-',
    })
  }

  tryRow('peak_description', 'peak_usage', 'peak_rate', 'peak_amount', 'Peak Usage')
  tryRow('off_peak_description', 'off_peak_usage', 'off_peak_rate', 'off_peak_amount', 'Off-Peak Usage')
  tryRow('total_usage_description', 'total_usage', 'total_usage_rate', 'total_usage_amount', 'Total Usage')

  return rows
}

const reconcileTotal = (subtotalRaw, gstRaw, totalRaw) => {
  const subtotal = parseMoney(subtotalRaw)
  const gst = parseMoney(gstRaw)
  const total = parseMoney(totalRaw)

  if (subtotal != null && gst != null) {
    const expected = subtotal + gst
    if (total == null) return { value: expected.toFixed(2), corrected: true }
    if (Math.abs(total - subtotal) < 0.01 && gst > 0.01) {
      return { value: expected.toFixed(2), corrected: true }
    }
    if (Math.abs(total - expected) > 0.05) {
      return { value: expected.toFixed(2), corrected: true }
    }
  }

  if (total != null) return { value: total.toFixed(2), corrected: false }
  return { value: '-', corrected: false }
}

function InvoicePreviewCard({
  extractedFields,
  lineItems,
  invoice,
  previewRef,
  onEditField,
}) {
  const ui = getPreviewStyle()

  const getFieldObj = (...names) => extractedFields.find((f) => names.includes(f.field_name))

  const vendorName =
    safeShortField(extractedFields, 'vendor_name') ||
    safeShortField(extractedFields, 'supplier_name') ||
    '-'

  const abn = safeShortField(extractedFields, 'abn', '-', 30) || '-'

  const invoiceNumber =
    safeShortField(extractedFields, 'invoice_number', '', 40) ||
    safeShortField(extractedFields, 'invoice_id', '', 40) ||
    '-'

  const invoiceDateRaw = getFieldValue(extractedFields, 'invoice_date')
  const dueDateRaw = getFieldValue(extractedFields, 'due_date')
  const invoiceDate = cleanDate(invoiceDateRaw) || '-'
  const dueDate = cleanDate(dueDateRaw) || '-'

  const billingPeriodRaw = safeField(extractedFields, 'billing_period', '')
  const { head: billingPeriodClean, tail: billingPeriodTail } = extractBledTail(
    billingPeriodRaw,
    /\s+Tariff\s+Type\b/i
  )
  const billingPeriod = cleanBillingPeriod(billingPeriodClean) || '-'

  const invoiceDateTail = cleanText(invoiceDateRaw).replace(cleanDate(invoiceDateRaw), '').trim()

  const customerName =
    safeShortField(extractedFields, 'customer_name') ||
    safeShortField(extractedFields, 'company_name') ||
    '-'

  const siteNameRaw =
    safeShortField(extractedFields, 'site_name', '', 60) ||
    safeShortField(extractedFields, 'property_type', '', 60) ||
    invoiceDateTail ||
    '-'
  const siteName = siteNameRaw === '' ? '-' : siteNameRaw

  const supplyAddress =
    safeField(extractedFields, 'supply_address', '') ||
    safeField(extractedFields, 'property_address', '') ||
    '-'

  const tariffType =
    safeShortField(extractedFields, 'tariff_type', '', 60) ||
    safeShortField(extractedFields, 'plan_name', '', 60) ||
    safeShortField(extractedFields, 'service_type', '', 60) ||
    billingPeriodTail ||
    '-'

  const meterId = safeShortField(extractedFields, 'meter_id', '-', 40) || '-'

  const subtotalRaw = safeShortField(extractedFields, 'subtotal', '', 20)
  const gstRaw =
    safeShortField(extractedFields, 'gst', '', 20) ||
    safeShortField(extractedFields, 'tax_amount', '', 20)
  const totalRaw =
    safeShortField(extractedFields, 'total_amount', '', 20) ||
    safeShortField(extractedFields, 'total_amount_due', '', 20)

  const { value: reconciledTotal, corrected: totalWasCorrected } = reconcileTotal(
    subtotalRaw,
    gstRaw,
    totalRaw
  )

  const subtotal = subtotalRaw || '-'
  const gst = gstRaw || '-'

  let cleanedLineItems = (lineItems || [])
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

  let lineItemsAreSynthesised = false
  if (cleanedLineItems.length === 0) {
    const synthesised = synthesiseLineItems(extractedFields)
    if (synthesised.length > 0) {
      cleanedLineItems = synthesised
      lineItemsAreSynthesised = true
    }
  }

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
        className={`rounded px-1 text-left transition hover:bg-amber-50 ${className}`}
        title="Click to edit"
      >
        {displayValue}
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Invoice preview</h2>
          <p className="text-xs text-slate-500">Click a value to edit it</p>
        </div>

        {totalWasCorrected && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            <AlertCircle className="h-3.5 w-3.5" />
            total auto-reconciled
          </span>
        )}
      </div>

      <div className="bg-slate-50 p-3 sm:p-5 lg:p-6">
        <div
          ref={previewRef}
          className="mx-auto max-w-5xl border border-slate-200 bg-[#fafaf7] px-4 py-5 shadow-sm sm:px-8 sm:py-8"
        >
          <div className="mb-6">
            <div className="text-center">
              <h1
                className="text-[28px] font-bold leading-tight tracking-wide"
                style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
              >
                <EditableValue
                  fieldNames={['vendor_name', 'supplier_name']}
                  displayValue={textOrDash(vendorName)}
                />
              </h1>
            </div>

            <div className="mt-3 text-left text-[15px] leading-7 text-slate-900">
              <div>{ui.subtitle}</div>
              <div>
                ABN: <EditableValue fieldNames="abn" displayValue={textOrDash(abn)} />
              </div>
            </div>
          </div>

          <div
            className="mb-6 border py-2 text-center text-[18px] font-bold"
            style={{ color: ui.accent, borderColor: ui.accent }}
          >
            {ui.accountTitle}
          </div>

          <div className="mb-8 overflow-hidden border border-slate-400 bg-white">
            <table className="w-full border-collapse text-[15px]">
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-medium w-[20%]">Invoice ID</td>
                  <td className="border border-slate-300 px-3 py-2 w-[30%]">
                    <EditableValue
                      fieldNames={['invoice_number', 'invoice_id']}
                      displayValue={textOrDash(invoiceNumber)}
                    />
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-medium w-[20%]">Invoice Date</td>
                  <td className="border border-slate-300 px-3 py-2 w-[30%]">
                    <EditableValue fieldNames="invoice_date" displayValue={formatDate(invoiceDate)} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-medium">Billing Period</td>
                  <td className="border border-slate-300 px-3 py-2">
                    <EditableValue fieldNames="billing_period" displayValue={textOrDash(billingPeriod)} />
                  </td>
                  <td className="border border-slate-300 px-3 py-2 font-medium">Due Date</td>
                  <td className="border border-slate-300 px-3 py-2">
                    <EditableValue fieldNames="due_date" displayValue={formatDate(dueDate)} />
                  </td>
                </tr>
                {tariffType !== '-' && (
                  <tr>
                    <td className="border border-slate-300 px-3 py-2 font-medium">Tariff Type</td>
                    <td className="border border-slate-300 px-3 py-2" colSpan={3}>
                      <EditableValue
                        fieldNames={['tariff_type', 'plan_name', 'service_type']}
                        displayValue={textOrDash(tariffType)}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mb-10">
            <h3
              className="mb-3 text-[18px] font-bold"
              style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
            >
              {ui.infoTitle}
            </h3>

            <table className="w-full border-collapse bg-white text-[15px]">
              <tbody>
                <tr>
                  <td
                    className="w-[25%] border border-slate-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.customerLabel}
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    <EditableValue
                      fieldNames={['customer_name', 'company_name']}
                      displayValue={textOrDash(customerName)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-slate-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.siteLabel}
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    <EditableValue
                      fieldNames={['site_name', 'property_type']}
                      displayValue={textOrDash(siteName)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-slate-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.addressLabel}
                  </td>
                  <td className="border border-slate-300 px-3 py-2 break-words">
                    <EditableValue
                      fieldNames={['supply_address', 'property_address']}
                      displayValue={textOrDash(supplyAddress)}
                    />
                  </td>
                </tr>
                <tr>
                  <td
                    className="border border-slate-300 px-3 py-2 font-medium"
                    style={{ backgroundColor: ui.sectionBg }}
                  >
                    {ui.meterLabel}
                  </td>
                  <td className="border border-slate-300 px-3 py-2">
                    <EditableValue fieldNames="meter_id" displayValue={textOrDash(meterId)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <h3
              className="mb-3 text-[18px] font-bold"
              style={{ color: ui.accent, fontFamily: 'Georgia, serif' }}
            >
              {ui.chargesTitle}
            </h3>

            {lineItemsAreSynthesised && (
              <p className="mb-2 text-[11px] text-amber-600">
                Line items reconstructed from field-level extractions.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse bg-white text-[15px]">
                <thead>
                  <tr style={{ backgroundColor: ui.tableHeaderBg }} className="text-white">
                    <th className="border border-slate-400 px-3 py-2 text-left">Description</th>
                    <th className="border border-slate-400 px-3 py-2 text-left">Usage</th>
                    <th className="border border-slate-400 px-3 py-2 text-left">Rate</th>
                    <th className="border border-slate-400 px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cleanedLineItems.length > 0 ? (
                    cleanedLineItems.map((item) => (
                      <tr key={item.id}>
                        <td className="border border-slate-300 px-3 py-2">{textOrDash(item.description)}</td>
                        <td className="border border-slate-300 px-3 py-2">{textOrDash(item.quantity)}</td>
                        <td className="border border-slate-300 px-3 py-2">{formatRate(item.unit_price, item.quantity)}</td>
                        <td className="border border-slate-300 px-3 py-2 text-right">{money(item.total_price)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="border border-slate-300 px-3 py-3 italic text-slate-400" colSpan={4}>
                        No line items extracted
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-center">
            <table className="w-full max-w-xl border-collapse text-[15px]" style={{ backgroundColor: ui.summaryBg }}>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-medium">Subtotal</td>
                  <td className="border border-slate-300 px-3 py-2 text-right">
                    <EditableValue fieldNames="subtotal" displayValue={money(subtotal)} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-medium">GST (10%)</td>
                  <td className="border border-slate-300 px-3 py-2 text-right">
                    <EditableValue fieldNames={['tax_amount', 'gst']} displayValue={money(gst)} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-3 py-2 font-bold">{ui.totalLabel}</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-bold">
                    <EditableValue
                      fieldNames={['total_amount', 'total_amount_due']}
                      displayValue={money(reconciledTotal)}
                    />
                    {totalWasCorrected && (
                      <span className="ml-2 align-middle text-[10px] font-semibold text-amber-600">
                        ✓ reconciled
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-8 text-xs text-slate-400">
            Preview generated from backend extracted fields for {invoice?.original_filename}
          </div>
        </div>
      </div>
    </div>
  )
}

const FIELD_SECTIONS = [
  {
    id: 'amounts',
    title: 'Amounts',
    fields: ['total_amount', 'subtotal', 'tax_amount'],
    align: 'right',
  },
  {
    id: 'details',
    title: 'Invoice Details',
    fields: ['invoice_number', 'invoice_date', 'due_date', 'billing_period', 'vendor_name'],
    align: 'left',
  },
  {
    id: 'customer',
    title: 'Customer & Site',
    fields: ['customer_name', 'site_name', 'supply_address', 'meter_id', 'abn'],
    align: 'left',
  },
]

const KNOWN_FIELDS = new Set(FIELD_SECTIONS.flatMap((s) => s.fields))

const METHOD_STYLE = {
  cluster_rule: { label: 'agent learned', cls: 'bg-violet-100 text-violet-700' },
  agent_learned: { label: 'agent learned', cls: 'bg-violet-100 text-violet-700' },
  llm_extraction: { label: 'llm', cls: 'bg-blue-100 text-blue-700' },
  llm: { label: 'llm', cls: 'bg-blue-100 text-blue-700' },
  'llm+gnn': { label: 'llm + gnn', cls: 'bg-indigo-100 text-indigo-700' },
  gnn: { label: 'gnn', cls: 'bg-indigo-100 text-indigo-700' },
  row_label: { label: 'layout', cls: 'bg-cyan-100 text-cyan-700' },
  summary_label: { label: 'layout', cls: 'bg-cyan-100 text-cyan-700' },
  vendor_top: { label: 'layout', cls: 'bg-cyan-100 text-cyan-700' },
  regex: { label: 'regex', cls: 'bg-gray-100 text-gray-500' },
  position_based: { label: 'position', cls: 'bg-gray-100 text-gray-500' },
}

function MethodPill({ method }) {
  const cfg = METHOD_STYLE[method] ?? { label: method ?? '—', cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function InlineEdit({ field, editValue, setEditValue, saving, onSave, onCancel }) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(field)
          if (e.key === 'Escape') onCancel()
        }}
        aria-label={`Edit ${field.field_name.replace(/_/g, ' ')}`}
        className="field-edit-active min-w-0 flex-1 rounded-xl border border-blue-400 px-3 py-2 text-sm outline-none"
        autoFocus
      />
      <button
        onClick={() => onSave(field)}
        disabled={saving}
        title="Save"
        aria-label="Save edit"
        className="flex-shrink-0 rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel edit"
        className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function FieldRow({
  field,
  align,
  editingFieldId,
  editValue,
  setEditValue,
  saving,
  onEdit,
  onSave,
  onCancel,
}) {
  const isEditing = editingFieldId === field.id
  const displayValue = field.validated_value ?? field.normalized_value ?? field.raw_value

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {field.field_name.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-1">
          {field.is_validated && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600">
              <CheckCircle className="h-3 w-3" />
              validated
            </span>
          )}
          <MethodPill method={field.extraction_method} />
        </div>
      </div>

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
          className={[
            'w-full rounded-xl px-3 py-2 text-left transition hover:bg-white hover:ring-2 hover:ring-blue-200',
            align === 'right' ? 'text-right' : '',
          ].join(' ')}
        >
          {displayValue ? (
            <span
              className={`text-sm font-semibold text-slate-900 ${
                align === 'right' ? 'font-mono tabular-nums' : ''
              }`}
            >
              {displayValue}
            </span>
          ) : (
            <span className="text-xs italic text-slate-300">not extracted</span>
          )}
        </button>
      )}

      {field.confidence_score != null && (
        <ConfidenceBar value={field.confidence_score} showLabel className="mt-1.5" />
      )}
    </div>
  )
}

function computeGstStatus(fields) {
  const find = (name) => {
    const f = fields.find((f) => f.field_name === name)
    return parseFloat((f?.validated_value ?? f?.normalized_value ?? f?.raw_value ?? '').replace(/[^0-9.]/g, '')) || null
  }

  const subtotal = find('subtotal')
  const tax = find('tax_amount')
  const total = find('total_amount')
  if (!subtotal || !tax) return null

  const expectedTax = subtotal * 0.1
  const gstOk = Math.abs(tax - expectedTax) / expectedTax < 0.05

  const expectedTotal = subtotal + tax
  const totalOk = total == null ? true : Math.abs(total - expectedTotal) / expectedTotal < 0.01

  const hasRetention = fields.some((f) =>
    (f.validated_value ?? f.normalized_value ?? f.raw_value ?? '').toLowerCase().includes('retention')
  )

  return { ok: gstOk, totalOk, hasRetention }
}

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
}) {
  if (!fields.length) {
    return (
      <div
        className="flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm"
        aria-label="Extracted fields — empty"
      >
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-blue-50">
          <FileText className="h-7 w-7 text-blue-300" />
        </div>
        <p className="text-sm font-medium text-slate-600">
          {canProcess
            ? 'Click "Process Invoice" to extract fields'
            : isActivelyProcessing || processing
            ? 'Extracting fields…'
            : 'No extracted fields yet'}
        </p>
      </div>
    )
  }

  const byName = Object.fromEntries(fields.map((f) => [f.field_name, f]))
  const otherFields = fields.filter((f) => !KNOWN_FIELDS.has(f.field_name))
  const gst = computeGstStatus(fields)

  const sharedRowProps = {
    editingFieldId,
    editValue,
    setEditValue,
    saving,
    onEdit,
    onSave,
    onCancel,
  }

  return (
    <aside className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Extracted fields</h2>
          <p className="text-xs text-slate-500">Tap any value to edit and validate</p>
        </div>
        {avgConfidence !== null && (
          <div className="ml-3 text-right">
            <p className="text-lg font-bold leading-none text-blue-600">{avgConfidence}%</p>
            <p className="text-[10px] text-slate-500">avg conf.</p>
          </div>
        )}
      </div>

      {avgConfidence !== null && (
        <div className="px-5 pb-1 pt-3">
          <ConfidenceBar value={avgConfidence / 100} showLabel={false} className="w-full" />
        </div>
      )}

      <div className="px-5 pb-4">
        {FIELD_SECTIONS.map((section) => {
          const sectionFields = section.fields.map((name) => byName[name]).filter(Boolean)
          if (!sectionFields.length) return null

          return (
            <div key={section.id} className="border-b border-slate-100 py-4 last:border-b-0">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                {section.title}
              </p>
              <div className="divide-y divide-slate-50">
                {sectionFields.map((field) => (
                  <FieldRow key={field.id} field={field} align={section.align} {...sharedRowProps} />
                ))}
              </div>
            </div>
          )
        })}

        {otherFields.length > 0 && (
          <div className="py-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Other
            </p>
            <div className="divide-y divide-slate-50">
              {otherFields.map((field) => (
                <FieldRow key={field.id} field={field} align="left" {...sharedRowProps} />
              ))}
            </div>
          </div>
        )}
      </div>

      {fields.some((f) => f.confidence_score != null) && (
        <div className="border-t border-slate-100 px-5 py-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Field confidence
          </p>
          <FieldConfidenceMiniChart fields={fields} height={Math.max(28 * 4, 120)} />
        </div>
      )}

      {gst !== null && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
          <KpiChip type={gst.ok ? 'gst_ok' : 'gst_issue'} />
          {!gst.totalOk && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              <AlertCircle className="h-3 w-3" />
              total mismatch
            </span>
          )}
          {gst.hasRetention && <KpiChip type="retention_clause" />}
        </div>
      )}
    </aside>
  )
}

function OcrCollapsible({ ocrResults }) {
  const [open, setOpen] = useState(false)

  if (!ocrResults?.length) return null

  const result = ocrResults[0]
  const engine = result.ocr_engine ?? 'OCR'
  const confPct = result.confidence_score != null ? `${Math.round(result.confidence_score * 100)}% confidence` : null
  const timing = result.processing_time_ms != null ? `${result.processing_time_ms}ms` : null

  const meta = [engine, confPct, timing].filter(Boolean).join(' · ')

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ocr-body"
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">OCR raw text</h2>
          <p className="text-xs text-slate-500">{meta}</p>
        </div>

        <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <div id="ocr-body" className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 px-5 pb-5 pt-3">
            <pre className="max-h-[320px] overflow-auto rounded-2xl bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
              {result.raw_text || 'No text extracted'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

const SUSTAIN_TAG_TYPES = new Set([
  'solar',
  'carbon_offset',
  'renewable_energy',
  'recycled_materials',
  'energy_efficiency',
])

function GreenKpiStrip({ data, loading }) {
  if (loading) {
    return <div className="h-16 rounded-3xl shimmer-bg" aria-hidden="true" />
  }

  if (!data) return null

  const flags = data.compliance_flags ?? {}
  const tags = data.sustainability_tags ?? []
  const chips = []

  if (flags.gst_valid != null) {
    chips.push(<KpiChip key="gst" type={flags.gst_valid ? 'gst_ok' : 'gst_issue'} />)
  }

  if (flags.qbcc_detected) {
    chips.push(<KpiChip key="qbcc" type="qbcc_missing" />)
  }

  if (flags.retention_detected) {
    chips.push(<KpiChip key="retention" type="retention_clause" />)
  }

  tags.forEach((tag, i) => {
    const type = SUSTAIN_TAG_TYPES.has(tag) ? tag : null
    if (type) {
      chips.push(<KpiChip key={`tag-${i}`} type={type} />)
    } else {
      chips.push(
        <span
          key={`tag-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700"
        >
          {tag.replace(/_/g, ' ')}
        </span>
      )
    }
  })

  if (!chips.length) return null

  const tagCount = tags.length
  const gstLabel = flags.gst_valid == null ? '' : flags.gst_valid ? 'GST OK' : 'GST Issue'
  const summaryParts = []
  if (tagCount > 0) summaryParts.push(`${tagCount} green tag${tagCount !== 1 ? 's' : ''}`)
  if (gstLabel) summaryParts.push(gstLabel)
  const summary = summaryParts.join(' · ')

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center">
      <div className="flex-shrink-0">
        <p className="text-sm font-semibold text-slate-900">Green KPI</p>
        <p className="text-xs text-slate-500">Compliance and sustainability</p>
      </div>

      <div className="flex flex-1 flex-wrap gap-1.5">{chips}</div>

      {summary && <p className="text-xs font-medium text-slate-500">{summary}</p>}
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
    } finally {
      setGreenKpiLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    fetchGreenKpi()
    axios.get('/api/folders').then((res) => setFolders(res.data.folders)).catch(() => {})

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
          setInvoice((prev) => (prev ? { ...prev, ...updated } : updated))

          if (!PROCESSING_STATUSES.includes(updated.status)) {
            setProcessing(false)
            fetchData()
            supabase.removeChannel(channel)
            channelRef.current = null
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          supabase.removeChannel(channel)
          channelRef.current = null
          startPollingFallback()
        }
      })

    channelRef.current = channel
  }

  const startPollingFallback = () => {
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
        backgroundColor: '#fafaf7',
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

      const filename = invoice?.original_filename?.replace(/\.[^/.]+$/, '') || 'invoice-preview'
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
    const raw = field.validated_value ?? field.normalized_value ?? field.raw_value ?? ''
    let seed = raw
    if (field.field_name === 'invoice_date' || field.field_name === 'due_date') {
      seed = cleanDate(raw) || raw
    } else if (field.field_name === 'billing_period') {
      seed = cleanBillingPeriod(raw) || raw
    } else if (isProbablyNoisy(raw)) {
      seed = stripTrailingLabels(raw)
    }
    setEditValue(seed)
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

  const avgConfidence = (() => {
    const scores = extractedFields
      .map((f) => f.confidence_score)
      .filter((s) => s != null && !Number.isNaN(Number(s)))
    if (!scores.length) return null
    return Math.round((scores.reduce((a, b) => a + Number(b), 0) / scores.length) * 100)
  })()

  const fileMeta = [
    invoice?.file_type?.toUpperCase() || 'FILE',
    invoice?.file_size_bytes ? `${(invoice.file_size_bytes / 1024).toFixed(0)} KB` : null,
    invoice?.created_at
      ? `Uploaded ${new Date(invoice.created_at).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}`
      : null,
    invoice?.processed_at
      ? `Processed ${new Date(invoice.processed_at).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
        })}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 rounded shimmer-bg" />
        <div className="h-28 rounded-3xl shimmer-bg" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr),420px]">
          <div className="h-[680px] rounded-3xl shimmer-bg" />
          <div className="h-[680px] rounded-3xl shimmer-bg" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/invoices')}
          className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      <div className="space-y-4">
        <button
          onClick={() => navigate('/invoices')}
          className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </button>

        <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Invoice workspace
                </div>

                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-100">
                    <FileText className="h-6 w-6 text-blue-600" />
                  </div>

                  <div className="min-w-0">
                    <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                      {invoice?.original_filename}
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">{fileMeta}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={invoice?.status} />

                {avgConfidence !== null && (
                  <span
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
                      avgConfidence >= 80
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : avgConfidence >= 55
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-orange-200 bg-orange-50 text-orange-700',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        avgConfidence >= 80
                          ? 'bg-green-500'
                          : avgConfidence >= 55
                          ? 'bg-blue-500'
                          : 'bg-orange-500',
                      ].join(' ')}
                    />
                    Avg confidence {avgConfidence}%
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={exportPreviewAsPdf}
                disabled={exportingPdf || (!hasFields && !hasLineItems)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                {exportingPdf ? 'Exporting…' : 'Export PDF'}
              </button>

              {canProcess || isActivelyProcessing || processing ? (
                <button
                  onClick={processInvoice}
                  disabled={processing || isActivelyProcessing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${processing || isActivelyProcessing ? 'animate-spin' : ''}`} />
                  {processing || isActivelyProcessing ? 'Processing…' : 'Process invoice'}
                </button>
              ) : hasOcr ? (
                <button
                  onClick={processInvoice}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reprocess
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {processError && (
          <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {processError}
          </div>
        )}

        {(processing || isActivelyProcessing) && (
          <section className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Pipeline progress
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STEPS.map((step, i) => {
                const done = currentStepIdx >= i
                const active = currentStepIdx === i - 1

                return (
                  <div
                    key={step.key}
                    className={`rounded-2xl border px-4 py-4 text-center ${
                      done
                        ? 'border-blue-200 bg-blue-50'
                        : active
                        ? 'border-blue-200 bg-white'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div
                      className={`mx-auto flex h-9 w-9 items-center justify-center rounded-2xl text-sm font-bold ${
                        done
                          ? 'bg-blue-600 text-white'
                          : active
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" /> : i + 1}
                    </div>
                    <p className={`mt-3 text-sm font-semibold ${done || active ? 'text-slate-900' : 'text-slate-500'}`}>
                      {step.label}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {suggestedFolder && !invoice?.folder_id && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm sm:flex-row sm:items-center">
          <Folder className="h-5 w-5 flex-shrink-0 text-amber-500" />
          <span className="flex-1">
            This looks like a <strong>{suggestedFolder.name}</strong> invoice. Move it to that folder?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => assignFolder(suggestedFolder.id)}
              disabled={assigningFolder}
              className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              Move
            </button>
            <button
              onClick={dismissSuggestion}
              className="rounded-xl border border-amber-300 px-3 py-2 text-xs text-amber-700 transition hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {folders.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Folder className="h-4 w-4 text-blue-500" />
            <span className="font-medium">Folder</span>
          </div>
          <select
            value={invoice?.folder_id || ''}
            onChange={(e) => assignFolder(e.target.value || null)}
            disabled={assigningFolder}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
          >
            <option value="">— Unassigned —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr),420px]">
        <div className="min-w-0 space-y-3">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Edit2 className="h-3.5 w-3.5 text-blue-400" />
            Click any highlighted value to edit
          </p>

          <div className="overflow-auto rounded-3xl border border-slate-200 bg-blue-50/50 p-3 shadow-sm sm:p-4 lg:p-5">
            {hasFields || hasLineItems ? (
              <InvoicePreviewCard
                extractedFields={extractedFields}
                lineItems={lineItems}
                invoice={invoice}
                previewRef={previewRef}
                onEditField={startEditField}
              />
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50">
                  <Eye className="h-8 w-8 text-blue-300" />
                </div>
                <p className="text-base font-semibold text-slate-800">No preview yet</p>
                <p className="mt-2 text-sm text-slate-500">
                  {canProcess ? 'Click "Process Invoice" to extract data' : 'Process the invoice to generate a preview'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
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
          />
        </div>
      </div>

      {(greenKpiLoading || greenKpiData) && (
        <GreenKpiStrip data={greenKpiData} loading={greenKpiLoading} />
      )}

      {hasLineItems && (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  {['#', 'Description', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                    <th
                      key={i}
                      className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                        i >= 2 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {lineItems.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm text-slate-400">{item.line_number}</td>
                    <td className="px-5 py-3 text-sm text-slate-900">{item.description || '-'}</td>
                    <td className="px-5 py-3 text-right text-sm text-slate-700">{item.quantity ?? '-'}</td>
                    <td className="px-5 py-3 text-right text-sm text-slate-700">
                      {formatRate(item.unit_price, item.quantity)}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
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