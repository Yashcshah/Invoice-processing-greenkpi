/**
 * ConfidenceTrendChart
 * ─────────────────────
 * Recharts LineChart: x = date, y = average extraction confidence (%).
 *
 * Props:
 *   data     – [{date: "YYYY-MM-DD", avg_confidence: number, count: number}]
 *   height   – chart height in px (default 220)
 *   loading  – shows skeleton shimmer when true
 *
 * Accessibility: the <figure> carries aria-label; the chart area has
 * role="img" so screen readers skip the SVG internals and read the label.
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const { avg_confidence, count } = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      <p className="text-blue-600 font-bold">{avg_confidence}% confidence</p>
      <p className="text-gray-400">{count} invoice{count !== 1 ? 's' : ''}</p>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ height }) {
  return (
    <div style={{ height }} className="rounded-xl shimmer-bg" aria-hidden="true" />
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function Empty({ height }) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50"
    >
      <p className="text-xs font-medium text-gray-400">No confidence data yet</p>
      <p className="text-xs text-gray-300 mt-0.5">Process invoices to see the trend</p>
    </div>
  )
}

// ── Tick formatter ────────────────────────────────────────────────────────────
function shortDate(dateStr) {
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-')
  return `${parseInt(month)}/${parseInt(day)}`
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ConfidenceTrendChart({ data = [], height = 220, loading = false }) {
  if (loading) return <Skeleton height={height} />
  if (!data.length) return <Empty height={height} />

  const minY = Math.max(0,  Math.floor(Math.min(...data.map(d => d.avg_confidence)) / 10) * 10 - 10)
  const maxY = Math.min(100, Math.ceil( Math.max(...data.map(d => d.avg_confidence)) / 10) * 10 + 5)

  return (
    <figure
      aria-label={`Confidence trend chart — ${data.length} data points from ${data[0]?.date} to ${data[data.length - 1]?.date}`}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: -20, bottom: 0 }}
          role="img"
          aria-label="Line chart showing average extraction confidence over time"
        >
          <defs>
            <linearGradient id="confGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3B82F6" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#f0f0f0"
            vertical={false}
          />

          {/* 80% reference — "good confidence" threshold */}
          <ReferenceLine
            y={80}
            stroke="#22C55E"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{ value: '80%', position: 'right', fontSize: 10, fill: '#22C55E' }}
          />

          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minY, maxY]}
            tickFormatter={v => `${v}%`}
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={38}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }} />

          <Line
            type="monotone"
            dataKey="avg_confidence"
            stroke="#3B82F6"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#3B82F6', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#2563EB', strokeWidth: 2, stroke: '#fff' }}
            isAnimationActive
            animationDuration={800}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  )
}
