/**
 * KpiChip
 *
 * Compact tag that communicates a Green KPI or compliance flag at a glance.
 * Each type has its own icon, colour, and descriptive label.
 *
 * Usage:
 *   <KpiChip type="gst_ok" />
 *   <KpiChip type="gst_issue" />
 *   <KpiChip type="qbcc_missing" />
 *   <KpiChip type="solar" />
 *   <KpiChip type="carbon_offset" />
 *
 * You can also pass arbitrary types — they get a neutral grey fallback.
 *
 * Accessibility: rendered as a <span> with role="img" and a full aria-label
 * so screen readers describe the KPI rather than just announcing "chip".
 */

// ── Icon components (inline SVG — zero extra deps) ────────────────────────────

function IconCheck() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
    </svg>
  )
}

function IconWarning() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path fillRule="evenodd" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575zM8 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5zm0 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
    </svg>
  )
}

function IconSun() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path d="M8 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 2zM8 11a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 11zM2 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 8zM11 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 11 8zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
    </svg>
  )
}

function IconLeaf() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path d="M14.5 1.5C14.5 1.5 10 1 7 4c-1.86 1.86-2.5 4.5-2 7 .07.39.37.7.76.76.29.05.59.07.89.07 2.38 0 4.68-1 6.35-2.68C15 6.5 14.5 1.5 14.5 1.5z" />
      <path d="M6.93 12.5c-.14-1.1.06-2.2.5-3.2L3 13.75a.75.75 0 1 0 1.06 1.06l3.5-3.5c-.24.4-.43.82-.63 1.19z" />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path fillRule="evenodd" d="M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5a.75.75 0 0 1-.75.75H11v-2.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V15H2.75a.75.75 0 0 1-.75-.75V1.75zm3 2.5a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 5 4.25zm3.75-.75a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1zM5 7.25a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 5 7.25zm3.75-.75a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1z" />
    </svg>
  )
}

// ── KPI type config ────────────────────────────────────────────────────────────

const KPI_CONFIG = {
  gst_ok: {
    label:     'GST OK',
    chip:      'bg-green-100 text-green-700 border border-green-200',
    Icon:      IconCheck,
    ariaLabel: 'GST compliance: passed — tax amount is 10% of subtotal',
  },
  gst_issue: {
    label:     'GST Issue',
    chip:      'bg-red-100 text-red-700 border border-red-200',
    Icon:      IconWarning,
    ariaLabel: 'GST compliance: failed — declared tax does not match 10% of subtotal',
  },
  qbcc_missing: {
    label:     'QBCC Check',
    chip:      'bg-orange-100 text-orange-700 border border-orange-200',
    Icon:      IconBuilding,
    ariaLabel: 'QBCC: potential licensing obligation detected — verify contractor registration',
  },
  solar: {
    label:     'Solar',
    chip:      'bg-yellow-100 text-yellow-700 border border-yellow-200',
    Icon:      IconSun,
    ariaLabel: 'Sustainability tag: solar energy usage detected',
  },
  carbon_offset: {
    label:     'Carbon Offset',
    chip:      'bg-emerald-100 text-emerald-700 border border-emerald-200',
    Icon:      IconLeaf,
    ariaLabel: 'Sustainability tag: carbon offset or reduction activity detected',
  },
  // ── Generic sustainability tags from the 13-item catalogue ────────────────
  renewable_energy: {
    label:     'Renewable Energy',
    chip:      'bg-yellow-100 text-yellow-700 border border-yellow-200',
    Icon:      IconSun,
    ariaLabel: 'Sustainability tag: renewable energy',
  },
  recycled_materials: {
    label:     'Recycled Materials',
    chip:      'bg-emerald-100 text-emerald-700 border border-emerald-200',
    Icon:      IconLeaf,
    ariaLabel: 'Sustainability tag: recycled materials',
  },
  energy_efficiency: {
    label:     'Energy Efficient',
    chip:      'bg-blue-100 text-blue-700 border border-blue-200',
    Icon:      IconCheck,
    ariaLabel: 'Sustainability tag: energy efficiency improvements',
  },
  retention_clause: {
    label:     'Retention',
    chip:      'bg-purple-100 text-purple-700 border border-purple-200',
    Icon:      IconWarning,
    ariaLabel: 'Compliance: retention clause detected in this invoice',
  },
}

const FALLBACK_CONFIG = {
  chip:      'bg-gray-100 text-gray-600 border border-gray-200',
  Icon:      null,
  ariaLabel: null,
}

function labelFromType(type) {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default function KpiChip({ type, className = '' }) {
  const config    = KPI_CONFIG[type] ?? FALLBACK_CONFIG
  const label     = config.label     ?? labelFromType(type ?? 'unknown')
  const ariaLabel = config.ariaLabel ?? `KPI tag: ${label}`
  const Icon      = config.Icon

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={[
        'inline-flex items-center gap-1',
        'px-2 py-0.5 rounded-full',
        'text-xs font-medium tracking-wide',
        'select-none whitespace-nowrap',
        config.chip,
        className,
      ].join(' ')}
    >
      {Icon && <Icon />}
      {label}
    </span>
  )
}
