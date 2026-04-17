/**
 * FieldConfidenceMiniChart
 * ─────────────────────────
 * Compact horizontal bar chart showing per-field extraction confidence
 * for the key fields of an invoice (invoice number, amounts, vendor…).
 *
 * Props:
 *   fields  – extracted field objects [{field_name, confidence_score, ...}]
 *   height  – chart area height in px (default 160)
 *   loading – show shimmer skeleton when true
 *
 * Accessibility: role="img" + aria-label on the figure.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

// ── Which fields to visualise (order matters → top-to-bottom in chart) ────────
const KEY_FIELDS = [
  'invoice_number',
  'vendor_name',
  'total_amount',
  'tax_amount',
  'subtotal',
  'invoice_date',
]

// Pretty labels
const FIELD_LABELS = {
  invoice_number: 'Invoice #',
  vendor_name:    'Vendor',
  total_amount:   'Total',
  tax_amount:     'Tax',
  subtotal:       'Subtotal',
  invoice_date:   'Date',
}

// Bar colour by confidence tier
function barColor(pct) {
  if (pct >= 80) return '#22C55E'   // green
  if (pct >= 55) return '#3B82F6'   // blue
  return '#F97316'                   // orange
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { field, confidence } = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700">{field}</p>
      <p style={{ color: barColor(confidence) }} className="mt-0.5 font-bold">
        {confidence}% confidence
      </p>
    </div>
  )
}

function Skeleton({ height }) {
  return <div style={{ height }} className="rounded-xl shimmer-bg" aria-hidden="true" />
}

function Empty({ height }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50"
    >
      <p className="text-xs text-gray-400">Process invoice to see per-field confidence</p>
    </div>
  )
}

export default function FieldConfidenceMiniChart({ fields = [], height = 160, loading = false }) {
  if (loading) return <Skeleton height={height} />

  // Build chart data — only key fields that were extracted with a confidence score
  const data = KEY_FIELDS
    .map(name => {
      const f = fields.find(f => f.field_name === name)
      if (!f || f.confidence_score == null) return null
      return {
        name:       FIELD_LABELS[name] ?? name,
        field:      FIELD_LABELS[name] ?? name,
        confidence: Math.round(Number(f.confidence_score) * 100),
      }
    })
    .filter(Boolean)

  if (!data.length) return <Empty height={height} />

  // Dynamic height: 28px per row minimum so labels aren't squeezed
  const chartHeight = Math.max(height, data.length * 28)

  return (
    <figure
      aria-label={`Per-field confidence chart: ${data.map(d => `${d.field} ${d.confidence}%`).join(', ')}`}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 2, right: 28, bottom: 2, left: 4 }}
          role="img"
          aria-label="Horizontal bar chart showing extraction confidence per field"
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
            tick={{ fontSize: 9, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={52}
            tick={{ fontSize: 10, fill: '#6B7280', fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
          />

          {/* Target line at 80% */}
          <ReferenceLine
            x={80}
            stroke="#22C55E"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            label={{ value: '80%', position: 'top', fontSize: 8, fill: '#22C55E' }}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F3F4F6' }} />

          <Bar
            dataKey="confidence"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
            isAnimationActive
            animationDuration={600}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={barColor(entry.confidence)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}
