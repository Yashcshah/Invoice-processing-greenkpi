/**
 * InvoiceAI – Design Tokens
 *
 * Single source of truth for the colour palette.
 * Consumed by:
 *   • tailwind.config.js  → generates utility classes (bg-brand-blue, text-brand-muted, …)
 *   • Components          → inline styles / dynamic class strings where Tailwind JIT
 *                           cannot statically detect the class
 */

export const colors = {
  // ── Brand blues ──────────────────────────────────────────
  primaryBlue:      '#2563EB',
  primaryBlueLight: '#3B82F6',
  blueBg:           '#EFF6FF',

  // ── Semantic states ───────────────────────────────────────
  greenSuccess:  '#22C55E',
  orangeWarning: '#F97316',
  redError:      '#EF4444',

  // ── Surfaces & text ───────────────────────────────────────
  greyBg:   '#F9FAFB',
  cardBg:   '#FFFFFF',
  textMain: '#111827',
  textMuted: '#6B7280',
}

/**
 * Tailwind-ready colour map.
 * Imported in tailwind.config.js under theme.extend.colors.brand
 * giving classes like: bg-brand-blue, text-brand-muted, border-brand-success …
 */
export const brandColors = {
  blue:        colors.primaryBlue,
  'blue-light': colors.primaryBlueLight,
  'blue-bg':   colors.blueBg,
  success:     colors.greenSuccess,
  warning:     colors.orangeWarning,
  error:       colors.redError,
  'grey-bg':   colors.greyBg,
  card:        colors.cardBg,
  main:        colors.textMain,
  muted:       colors.textMuted,
}

export default colors
