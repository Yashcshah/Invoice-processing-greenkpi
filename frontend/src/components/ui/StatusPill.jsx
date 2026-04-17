/**
 * StatusPill
 *
 * Displays an invoice processing status as a coloured pill with a leading
 * dot indicator. The "processing" state adds a pulsing animation so users
 * can tell something is actively happening without any manual refresh.
 *
 * Usage:
 *   <StatusPill status="processing" />
 *   <StatusPill status="completed" />          // or extraction_complete / validated / exported
 *   <StatusPill status="needs_review" />
 *   <StatusPill status="failed" />
 *
 * Accessibility: rendered as a <span role="status"> with a descriptive
 * aria-label so screen readers announce the state correctly.
 */

const STATUS_CONFIG = {
  processing: {
    label:     'Processing',
    pill:      'bg-orange-100 text-orange-700 border border-orange-200',
    dot:       'bg-orange-500 animate-pulse',
    ariaLabel: 'Status: Processing — invoice is being analysed',
  },
  completed: {
    label:     'Completed',
    pill:      'bg-green-100 text-green-700 border border-green-200',
    dot:       'bg-green-500',
    ariaLabel: 'Status: Completed — extraction finished successfully',
  },
  needs_review: {
    label:     'Needs Review',
    pill:      'bg-blue-100 text-blue-700 border border-blue-200',
    dot:       'bg-blue-500',
    ariaLabel: 'Status: Needs Review — some fields require manual verification',
  },
  failed: {
    label:     'Failed',
    pill:      'bg-red-100 text-red-700 border border-red-200',
    dot:       'bg-red-500',
    ariaLabel: 'Status: Failed — processing encountered an error',
  },
}

// Fallback for unknown / raw DB statuses like "ocr_running", "preprocessing" …
function resolveStatus(raw) {
  if (!raw) return 'processing'
  const s = raw.toLowerCase()
  if (s === 'completed' || s === 'complete' || s === 'extraction_complete' || s === 'validated' || s === 'exported') return 'completed'
  if (s === 'failed' || s === 'error')       return 'failed'
  if (s === 'needs_review')                  return 'needs_review'
  // Any in-progress state maps to processing
  return 'processing'
}

export default function StatusPill({ status, className = '' }) {
  const key    = resolveStatus(status)
  const config = STATUS_CONFIG[key]

  return (
    <span
      role="status"
      aria-label={config.ariaLabel}
      className={[
        'inline-flex items-center gap-1.5',
        'px-2.5 py-0.5 rounded-full',
        'text-xs font-semibold tracking-wide',
        'select-none whitespace-nowrap',
        config.pill,
        className,
      ].join(' ')}
    >
      {/* Dot indicator */}
      <span
        aria-hidden="true"
        className={['w-1.5 h-1.5 rounded-full shrink-0', config.dot].join(' ')}
      />
      {config.label}
    </span>
  )
}
