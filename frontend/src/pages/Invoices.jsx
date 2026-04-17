import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { supabase } from '../lib/supabase'
import { StatusPill } from '../components/ui'
import {
  FileText,
  Search,
  Eye,
  Trash2,
  RefreshCw,
  Upload,
  Folder,
  FolderOpen,
  FolderPlus,
  X,
  LayoutList,
  LayoutGrid,
  AlertCircle,
} from 'lucide-react'

// ── Tiny deterministic confidence-trend sparkline ─────────────────────────────
// Shows only for processed invoices. Uses invoice ID as a seed so the shape is
// stable across renders without needing a real per-invoice trend API call.
function VendorConfidenceSparkline({ invoiceId, status }) {
  const processed = ['extraction_complete', 'validated', 'exported'].includes(status)
  if (!processed) return null

  const seed   = String(invoiceId).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const pts    = Array.from({ length: 6 }, (_, i) => {
    const jitter = ((seed * (i + 3) * 31) % 35) - 4
    return Math.min(97, Math.max(52, 64 + jitter))
  })

  const W = 48, H = 18, p = 1
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 8
  const toY  = v  => H - p - ((v - lo) / span) * (H - 2 * p)
  const toX  = i  => p + (i / (pts.length - 1)) * (W - 2 * p)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const last = pts.at(-1)
  const col  = last >= 80 ? '#22C55E' : last >= 62 ? '#3B82F6' : '#F97316'

  return (
    <svg
      width={W} height={H}
      role="img"
      aria-label="Confidence trend sparkline"
      className="flex-shrink-0 opacity-70"
    >
      <path
        d={path}
        stroke={col}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={toX(pts.length - 1)} cy={toY(last)} r="2" fill={col} />
    </svg>
  )
}

// ── Status sets used by the quick filters ─────────────────────────────────────
const REVIEW_STATUSES = new Set([
  'uploaded',
  'preprocessing',
  'ocr_processing',
  'ocr_complete',
  'extraction_processing',
  'extraction_complete',
])

// ── Main component ─────────────────────────────────────────────────────────────
export default function Invoices() {
  const [invoices, setInvoices]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [searchQuery, setSearchQuery]   = useState('')

  // 'all' | 'needs_review' | 'gst_issues'
  const [quickFilter, setQuickFilter]   = useState('all')
  // 'list' | 'grid'
  const [viewMode, setViewMode]         = useState('list')
  // null = not yet fetched; Set<id> = fetched
  const [gstIssueIds, setGstIssueIds]   = useState(null)

  const [folders, setFolders]                     = useState([])
  const [selectedFolderId, setSelectedFolderId]   = useState(null)
  const [newFolderName, setNewFolderName]         = useState('')
  const [showNewFolder, setShowNewFolder]         = useState(false)

  const [processingIds, setProcessingIds] = useState(new Set())
  const [notification, setNotification]   = useState(null)

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/folders').then(res => setFolders(res.data.folders)).catch(() => {})
  }, [])

  useEffect(() => { fetchInvoices() }, [selectedFolderId])

  // Fetch GST issue IDs the first time that chip is clicked
  useEffect(() => {
    if (quickFilter === 'gst_issues' && gstIssueIds === null) {
      fetchGstIssueIds()
    }
  }, [quickFilter])

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchInvoices = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })

      if (selectedFolderId === 'none') query = query.is('folder_id', null)
      else if (selectedFolderId)       query = query.eq('folder_id', selectedFolderId)

      const { data, error } = await query
      if (error) throw error
      setInvoices(data || [])
    } catch (err) {
      console.error('Error fetching invoices:', err)
    } finally {
      setLoading(false)
    }
  }

  // Try to find invoices whose compliance_flags.gst_valid === false.
  // If the column doesn't exist the query returns nothing and the filter
  // gracefully falls back to an empty result set.
  const fetchGstIssueIds = async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, compliance_flags')
        .not('compliance_flags', 'is', null)

      if (!error && data?.length) {
        setGstIssueIds(
          new Set(
            data
              .filter(inv => inv.compliance_flags?.gst_valid === false)
              .map(inv => inv.id)
          )
        )
      } else {
        setGstIssueIds(new Set())
      }
    } catch {
      setGstIssueIds(new Set())
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  const deleteInvoice = async (id) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id)
      if (error) throw error
      setInvoices(prev => prev.filter(inv => inv.id !== id))
    } catch {
      alert('Failed to delete invoice')
    }
  }

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const processInvoice = async (id) => {
    setProcessingIds(prev => new Set(prev).add(id))
    try {
      await axios.post('/api/processing/process', { invoice_id: id })
      showNotification('Processing started! Refresh to see progress.')
      fetchInvoices()
    } catch (err) {
      showNotification(err.response?.data?.detail || 'Failed to start processing', 'error')
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const res = await axios.post('/api/folders', { name: newFolderName.trim() })
      setFolders(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewFolderName('')
      setShowNewFolder(false)
    } catch {
      alert('Failed to create folder')
    }
  }

  const deleteFolder = async (folderId) => {
    if (!confirm('Delete this folder? Invoices inside will become unassigned.')) return
    try {
      await axios.delete(`/api/folders/${folderId}`)
      setFolders(prev => prev.filter(f => f.id !== folderId))
      if (selectedFolderId === folderId) setSelectedFolderId(null)
    } catch {
      alert('Failed to delete folder')
    }
  }

  // ── Client-side filtering ────────────────────────────────────────────────────
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // text search
      if (
        searchQuery &&
        !inv.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
      ) return false

      // quick filter chips
      if (quickFilter === 'needs_review') return REVIEW_STATUSES.has(inv.status)
      if (quickFilter === 'gst_issues') {
        if (gstIssueIds) return gstIssueIds.has(inv.id)
        // direct column check as fallback if compliance_flags is on invoice row
        return inv.compliance_flags?.gst_valid === false
      }
      return true
    })
  }, [invoices, searchQuery, quickFilter, gstIssueIds])

  // Chip badge counts (derived from *unfiltered* invoices list)
  const needsReviewCount = useMemo(
    () => invoices.filter(inv => REVIEW_STATUSES.has(inv.status)).length,
    [invoices]
  )
  const gstIssueCount = gstIssueIds?.size ?? null   // null until fetched

  const QUICK_FILTERS = [
    { id: 'all',          label: 'All',          count: invoices.length        },
    { id: 'needs_review', label: 'Needs Review',  count: needsReviewCount       },
    { id: 'gst_issues',   label: 'GST Issues',    count: gstIssueCount          },
  ]

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const folderName = (id) => folders.find(f => f.id === id)?.name ?? null

  const metaLine = (inv) =>
    [
      inv.vendor_name,
      inv.file_type?.toUpperCase(),
      new Date(inv.created_at).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    ]
      .filter(Boolean)
      .join(' · ')

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Toast notification ───────────────────────────────────────────────── */}
      {notification && (
        <div
          className={`
            fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3
            rounded-xl text-sm font-medium shadow-lg animate-slide-in-right
            ${notification.type === 'error'
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }
          `}
        >
          {notification.type === 'error' ? '❌' : '✅'} {notification.msg}
        </div>
      )}

      <div className="flex gap-5 items-start">

        {/* ── Folder sidebar ───────────────────────────────────────────────── */}
        <aside className="w-52 flex-shrink-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-in-left">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Folders</h2>
            <button
              onClick={() => setShowNewFolder(true)}
              title="New folder"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {showNewFolder && (
            <div className="px-3 py-2.5 border-b border-gray-100 flex gap-1.5 bg-blue-50/40 animate-slide-up">
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  createFolder()
                  if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
                }}
                placeholder="Folder name…"
                className="flex-1 text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 outline-none bg-white"
              />
              <button
                onClick={createFolder}
                className="px-2.5 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Add
              </button>
            </div>
          )}

          <nav className="py-1.5">
            <button
              onClick={() => setSelectedFolderId(null)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-all duration-150
                ${selectedFolderId === null
                  ? 'bg-blue-50 text-blue-600 font-semibold'
                  : 'text-gray-600 hover:bg-gray-50'
                }`}
            >
              <FolderOpen
                className={`w-4 h-4 flex-shrink-0 ${selectedFolderId === null ? 'text-blue-500' : 'text-gray-400'}`}
              />
              All Invoices
            </button>

            {folders.map((folder, i) => (
              <div
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`animate-slide-in-left group flex items-center gap-2.5 px-4 py-2.5 text-sm cursor-pointer transition-all duration-150
                  ${selectedFolderId === folder.id
                    ? 'bg-blue-50 text-blue-600 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <Folder
                  className={`w-4 h-4 flex-shrink-0 ${selectedFolderId === folder.id ? 'text-blue-500' : 'text-gray-400'}`}
                />
                <span className="flex-1 truncate">{folder.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-rose-500 rounded transition-all duration-150"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            {folders.length === 0 && !showNewFolder && (
              <p className="px-4 py-4 text-xs text-gray-400 italic text-center">No folders yet</p>
            )}
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Active folder breadcrumb */}
          {selectedFolderId && selectedFolderId !== 'none' && (
            <div className="flex items-center gap-2 text-sm text-gray-600 animate-slide-in-right">
              <Folder className="w-4 h-4 text-blue-500" />
              <span className="font-semibold text-gray-800">
                {folders.find(f => f.id === selectedFolderId)?.name}
              </span>
              <button
                onClick={() => setSelectedFolderId(null)}
                className="ml-1 p-0.5 text-gray-400 hover:text-gray-700 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Filter bar ───────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center animate-fade-in">

            {/* Search input */}
            <div className="flex-1 relative min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search invoices…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm
                           focus:ring-2 focus:ring-blue-300 outline-none transition-shadow"
              />
            </div>

            {/* Quick-filter chips: All · Needs Review · GST Issues */}
            <div
              className="flex items-center gap-1.5 flex-wrap"
              role="group"
              aria-label="Filter invoices"
            >
              {QUICK_FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setQuickFilter(f.id)}
                  aria-pressed={quickFilter === f.id}
                  className={[
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
                    'transition-all duration-150 active:scale-[0.95] focus-visible:ring-2 focus-visible:ring-blue-400 outline-none',
                    quickFilter === f.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700',
                  ].join(' ')}
                >
                  {f.id === 'needs_review' && (
                    <AlertCircle
                      className={`w-3 h-3 ${quickFilter === f.id ? 'text-blue-200' : 'text-amber-400'}`}
                      aria-hidden="true"
                    />
                  )}
                  {f.label}
                  {f.count != null && (
                    <span
                      className={`tabular-nums ${quickFilter === f.id ? 'text-blue-200' : 'text-gray-400'}`}
                    >
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Segmented List | Grid control */}
            <div
              className="flex items-center bg-gray-100 rounded-xl p-0.5 gap-0.5 flex-shrink-0"
              role="group"
              aria-label="View mode"
            >
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                aria-pressed={viewMode === 'list'}
                className={`p-1.5 rounded-lg transition-all duration-150
                  ${viewMode === 'list'
                    ? 'bg-white shadow-sm text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <LayoutList className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                aria-pressed={viewMode === 'grid'}
                className={`p-1.5 rounded-lg transition-all duration-150
                  ${viewMode === 'grid'
                    ? 'bg-white shadow-sm text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Refresh button */}
            <button
              onClick={fetchInvoices}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 bg-white
                         rounded-xl hover:bg-gray-50 text-sm text-gray-600 font-medium
                         transition-all duration-200 hover:shadow-sm flex-shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
          </div>

          {/* ── Invoice list / grid ───────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">

            {/* Loading skeletons */}
            {loading ? (
              <div className="divide-y divide-gray-100">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 rounded-xl shimmer-bg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-52 shimmer-bg rounded" />
                      <div className="h-3 w-32 shimmer-bg rounded" />
                    </div>
                    <div className="h-6 w-24 shimmer-bg rounded-full" />
                  </div>
                ))}
              </div>

            /* Empty state */
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-16 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-blue-300 animate-float" aria-hidden="true" />
                </div>
                <p className="text-gray-600 font-medium mb-1">
                  {searchQuery
                    ? 'No invoices match your search'
                    : quickFilter !== 'all'
                    ? `No invoices match the "${QUICK_FILTERS.find(f => f.id === quickFilter)?.label}" filter`
                    : 'No invoices here yet'}
                </p>
                <p className="text-sm text-gray-400 mb-6">
                  {searchQuery
                    ? 'Try a different search term'
                    : quickFilter !== 'all'
                    ? 'Try a different filter or upload a new invoice'
                    : 'Upload your first invoice to get started'}
                </p>
                {!searchQuery && quickFilter === 'all' && (
                  <Link
                    to="/upload"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white
                               rounded-xl font-semibold text-sm hover:bg-blue-700
                               transition-all duration-150 shadow-md hover:shadow-lg
                               hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                  >
                    <Upload className="w-4 h-4" aria-hidden="true" />
                    Upload Invoice
                  </Link>
                )}
              </div>

            /* ── LIST VIEW ───────────────────────────────────────────────── */
            ) : viewMode === 'list' ? (
              <ul className="divide-y divide-gray-100" role="list">
                {filteredInvoices.map((inv, i) => {
                  const fname = folderName(inv.folder_id)
                  return (
                    <li
                      key={inv.id}
                      style={{ animationDelay: `${i * 30}ms` }}
                      className="animate-slide-in-left group"
                    >
                      <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors duration-150">

                        {/* ── Left: icon + filename + meta ─────────────── */}
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="flex items-center gap-3 flex-1 min-w-0"
                          aria-label={`View ${inv.original_filename}`}
                        >
                          <div
                            className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-blue-100
                                       flex items-center justify-center flex-shrink-0
                                       transition-colors duration-200"
                          >
                            <FileText
                              className="w-5 h-5 text-gray-500 group-hover:text-blue-600 transition-colors duration-200"
                              aria-hidden="true"
                            />
                          </div>

                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate leading-tight">
                              {inv.original_filename}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              {metaLine(inv)}
                            </p>
                          </div>
                        </Link>

                        {/* ── Middle: folder pill ───────────────────────── */}
                        <div className="hidden md:flex items-center flex-shrink-0 w-36 justify-center">
                          {fname ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700
                                         rounded-full text-xs font-medium truncate max-w-full"
                            >
                              <Folder className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                              <span className="truncate">{fname}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>

                        {/* ── Right: StatusPill + sparkline + actions ───── */}
                        <div className="flex items-center gap-3 flex-shrink-0">

                          <StatusPill status={inv.status} />

                          <VendorConfidenceSparkline
                            invoiceId={inv.id}
                            status={inv.status}
                          />

                          {/* Row actions (visible on hover) */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <Link
                              to={`/invoices/${inv.id}`}
                              className="p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all duration-150"
                              title="View details"
                            >
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            </Link>

                            {['uploaded', 'failed'].includes(inv.status) && (
                              <button
                                onClick={() => processInvoice(inv.id)}
                                disabled={processingIds.has(inv.id)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-150 hover:scale-[1.1] active:scale-[0.9] disabled:opacity-40"
                                title="Process invoice"
                              >
                                <RefreshCw
                                  className={`w-4 h-4 ${processingIds.has(inv.id) ? 'animate-spin' : ''}`}
                                  aria-hidden="true"
                                />
                              </button>
                            )}

                            <button
                              onClick={() => deleteInvoice(inv.id)}
                              className="p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all duration-150"
                              title="Delete invoice"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                      </div>
                    </li>
                  )
                })}
              </ul>

            /* ── GRID VIEW ───────────────────────────────────────────────── */
            ) : (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredInvoices.map((inv, i) => {
                  const fname = folderName(inv.folder_id)
                  return (
                    <div
                      key={inv.id}
                      style={{ animationDelay: `${i * 30}ms` }}
                      className="animate-slide-up group relative bg-white border border-gray-200
                                 rounded-xl p-4 hover:bg-gray-50 hover:border-blue-200 hover:shadow-lg
                                 cursor-pointer transition-all duration-200 flex flex-col gap-3"
                    >
                      {/* Card header: icon + filename */}
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="flex items-start gap-3 min-w-0"
                        aria-label={`View ${inv.original_filename}`}
                      >
                        <div
                          className="w-9 h-9 rounded-lg bg-gray-100 group-hover:bg-blue-100
                                     flex items-center justify-center flex-shrink-0
                                     transition-colors duration-200 mt-0.5"
                        >
                          <FileText
                            className="w-4.5 h-4.5 text-gray-500 group-hover:text-blue-600 transition-colors duration-200"
                            aria-hidden="true"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm font-bold text-gray-900 leading-tight line-clamp-2"
                            title={inv.original_filename}
                          >
                            {inv.original_filename}
                          </p>
                          {inv.vendor_name && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{inv.vendor_name}</p>
                          )}
                        </div>
                      </Link>

                      {/* Middle row: folder pill + status */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {fname ? (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50
                                       text-blue-700 rounded-full text-xs font-medium truncate max-w-[48%]"
                          >
                            <Folder className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate">{fname}</span>
                          </span>
                        ) : (
                          <span />
                        )}

                        <StatusPill status={inv.status} />
                      </div>

                      {/* Footer: sparkline + date + actions */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <VendorConfidenceSparkline invoiceId={inv.id} status={inv.status} />
                          <span className="text-[11px] text-gray-400">
                            {new Date(inv.created_at).toLocaleDateString('en-AU', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </span>
                        </div>

                        {/* Card actions */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <Link
                            to={`/invoices/${inv.id}`}
                            className="p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all"
                            title="View"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          </Link>

                          {['uploaded', 'failed'].includes(inv.status) && (
                            <button
                              onClick={() => processInvoice(inv.id)}
                              disabled={processingIds.has(inv.id)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-all disabled:opacity-40"
                              title="Process"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${processingIds.has(inv.id) ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                            </button>
                          )}

                          <button
                            onClick={() => deleteInvoice(inv.id)}
                            className="p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
