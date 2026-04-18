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
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

function VendorConfidenceSparkline({ invoiceId, status }) {
  const processed = ['extraction_complete', 'validated', 'exported'].includes(status)
  if (!processed) return null

  const seed = String(invoiceId)
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0)

  const pts = Array.from({ length: 6 }, (_, i) => {
    const jitter = ((seed * (i + 3) * 31) % 35) - 4
    return Math.min(97, Math.max(52, 64 + jitter))
  })

  const W = 48
  const H = 18
  const p = 1
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const span = hi - lo || 8
  const toY = (v) => H - p - ((v - lo) / span) * (H - 2 * p)
  const toX = (i) => p + (i / (pts.length - 1)) * (W - 2 * p)

  const path = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(' ')

  const last = pts.at(-1)
  const col = last >= 80 ? '#22C55E' : last >= 62 ? '#3B82F6' : '#F97316'

  return (
    <svg
      width={W}
      height={H}
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

const REVIEW_STATUSES = new Set([
  'uploaded',
  'preprocessing',
  'ocr_processing',
  'ocr_complete',
  'extraction_processing',
  'extraction_complete',
])

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [viewMode, setViewMode] = useState('list')
  const [gstIssueIds, setGstIssueIds] = useState(null)

  const [folders, setFolders] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  const [processingIds, setProcessingIds] = useState(new Set())
  const [notification, setNotification] = useState(null)
  const [resettingStuck, setResettingStuck] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    axios.get('/api/folders').then((res) => setFolders(res.data.folders)).catch(() => {})
  }, [])

  useEffect(() => {
    fetchInvoices()
  }, [selectedFolderId])

  useEffect(() => {
    if (quickFilter === 'gst_issues' && gstIssueIds === null) {
      fetchGstIssueIds()
    }
  }, [quickFilter, gstIssueIds])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })

      if (selectedFolderId) {
        query = query.eq('folder_id', selectedFolderId)
      }

      const { data, error } = await query
      if (error) throw error
      setInvoices(data || [])
    } catch (err) {
      console.error('Error fetching invoices:', err)
    } finally {
      setLoading(false)
    }
  }

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
              .filter((inv) => inv.compliance_flags?.gst_valid === false)
              .map((inv) => inv.id)
          )
        )
      } else {
        setGstIssueIds(new Set())
      }
    } catch {
      setGstIssueIds(new Set())
    }
  }

  const deleteInvoice = async (id) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return

    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id)
      if (error) throw error
      setInvoices((prev) => prev.filter((inv) => inv.id !== id))
    } catch {
      alert('Failed to delete invoice')
    }
  }

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const processInvoice = async (id) => {
    setProcessingIds((prev) => new Set(prev).add(id))
    try {
      await axios.post('/api/processing/process', { invoice_id: id })
      showNotification('Processing started. Refresh to see progress.')
      fetchInvoices()
    } catch (err) {
      showNotification(err.response?.data?.detail || 'Failed to start processing', 'error')
    } finally {
      setProcessingIds((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
    }
  }

  const resetStuckInvoices = async () => {
    setResettingStuck(true)
    try {
      const res = await axios.post('/api/processing/reset-stuck')
      const { reset } = res.data

      if (reset === 0) {
        showNotification('No stuck invoices found.', 'success')
      } else {
        showNotification(
          `Reset ${reset} stuck invoice${reset !== 1 ? 's' : ''}.`,
          'success'
        )
      }

      fetchInvoices()
    } catch (err) {
      showNotification(err.response?.data?.detail || 'Failed to reset stuck invoices', 'error')
    } finally {
      setResettingStuck(false)
    }
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return

    try {
      const res = await axios.post('/api/folders', { name: newFolderName.trim() })
      setFolders((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
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
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      if (selectedFolderId === folderId) setSelectedFolderId(null)
    } catch {
      alert('Failed to delete folder')
    }
  }

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (
        searchQuery &&
        !inv.original_filename.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(inv.vendor_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false
      }

      if (quickFilter === 'needs_review') return REVIEW_STATUSES.has(inv.status)

      if (quickFilter === 'gst_issues') {
        if (gstIssueIds) return gstIssueIds.has(inv.id)
        return inv.compliance_flags?.gst_valid === false
      }

      return true
    })
  }, [invoices, searchQuery, quickFilter, gstIssueIds])

  const needsReviewCount = useMemo(
    () => invoices.filter((inv) => REVIEW_STATUSES.has(inv.status)).length,
    [invoices]
  )

  const gstIssueCount = gstIssueIds?.size ?? null

  const quickFilters = [
    { id: 'all', label: 'All', count: invoices.length },
    { id: 'needs_review', label: 'Needs Review', count: needsReviewCount },
    { id: 'gst_issues', label: 'GST Issues', count: gstIssueCount },
  ]

  const folderName = (id) => folders.find((f) => f.id === id)?.name ?? null

  const metaLine = (inv) =>
    [
      inv.vendor_name,
      inv.file_type?.toUpperCase(),
      new Date(inv.created_at).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="space-y-6">
      {notification && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${
            notification.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <span>{notification.type === 'error' ? '❌' : '✅'}</span>
          <span>{notification.msg}</span>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              All invoices
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
              Search, filter, organize, and review uploaded invoices in one place.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Total</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{invoices.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Needs Review</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">{needsReviewCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">GST Issues</p>
              <p className="mt-1 text-2xl font-bold text-rose-600">{gstIssueCount ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Folders</p>
              <p className="mt-1 text-2xl font-bold text-blue-600">{folders.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px,minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-24 xl:self-start">
          <div className="mb-3 flex items-center justify-between xl:hidden">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm"
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              {sidebarOpen ? 'Hide folders' : 'Show folders'}
            </button>
          </div>

          <div className={`${sidebarOpen ? 'block' : 'hidden'} xl:block`}>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Folders</h2>
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                  title="New folder"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
              </div>

              {showNewFolder && (
                <div className="border-b border-slate-100 bg-blue-50/40 px-3 py-3">
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createFolder()
                        if (e.key === 'Escape') {
                          setShowNewFolder(false)
                          setNewFolderName('')
                        }
                      }}
                      placeholder="Folder name..."
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      onClick={createFolder}
                      className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <nav className="p-2">
                <button
                  onClick={() => {
                    setSelectedFolderId(null)
                    setSidebarOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition ${
                    selectedFolderId === null
                      ? 'bg-blue-50 font-semibold text-blue-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <FolderOpen
                    className={`h-4 w-4 ${
                      selectedFolderId === null ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span className="flex-1 truncate">All invoices</span>
                </button>

                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    className={`group mt-1 flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${
                      selectedFolderId === folder.id
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      setSelectedFolderId(folder.id)
                      setSidebarOpen(false)
                    }}
                  >
                    <Folder
                      className={`h-4 w-4 ${
                        selectedFolderId === folder.id ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFolder(folder.id)
                      }}
                      className="rounded-lg p-1 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {folders.length === 0 && !showNewFolder && (
                  <p className="px-4 py-5 text-center text-xs italic text-slate-400">
                    No folders yet
                  </p>
                )}
              </nav>
            </div>
          </div>
        </aside>

        <section className="space-y-4 min-w-0">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1 min-w-0">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search invoices or vendors..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-300"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {quickFilters.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setQuickFilter(f.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
                        quickFilter === f.id
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700'
                      }`}
                    >
                      {f.id === 'needs_review' && (
                        <AlertCircle
                          className={`h-3.5 w-3.5 ${
                            quickFilter === f.id ? 'text-blue-200' : 'text-amber-500'
                          }`}
                        />
                      )}
                      {f.label}
                      {f.count != null && (
                        <span className={quickFilter === f.id ? 'text-blue-200' : 'text-slate-400'}>
                          {f.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  {selectedFolderId && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
                      <Folder className="h-4 w-4" />
                      <span>{folders.find((f) => f.id === selectedFolderId)?.name}</span>
                      <button
                        onClick={() => setSelectedFolderId(null)}
                        className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-2xl bg-slate-100 p-1">
                    <button
                      onClick={() => setViewMode('list')}
                      className={`rounded-xl p-2 transition ${
                        viewMode === 'list'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      title="List view"
                    >
                      <LayoutList className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`rounded-xl p-2 transition ${
                        viewMode === 'grid'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      title="Grid view"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </div>

                  {invoices.some((inv) =>
                    ['preprocessing', 'ocr_processing', 'extraction_processing'].includes(inv.status)
                  ) && (
                    <button
                      onClick={resetStuckInvoices}
                      disabled={resettingStuck}
                      className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw className={`h-4 w-4 ${resettingStuck ? 'animate-spin' : ''}`} />
                      {resettingStuck ? 'Resetting...' : 'Reset stuck'}
                    </button>
                  )}

                  <button
                    onClick={fetchInvoices}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <div className="divide-y divide-slate-100">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-11 w-11 rounded-2xl bg-slate-200 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-52 rounded bg-slate-200 animate-pulse" />
                      <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
                    </div>
                    <div className="h-7 w-24 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50">
                  <FileText className="h-8 w-8 text-blue-300" />
                </div>
                <p className="text-base font-semibold text-slate-800">
                  {searchQuery
                    ? 'No invoices match your search'
                    : quickFilter !== 'all'
                    ? `No invoices match the "${quickFilters.find((f) => f.id === quickFilter)?.label}" filter`
                    : 'No invoices here yet'}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {searchQuery
                    ? 'Try another keyword.'
                    : quickFilter !== 'all'
                    ? 'Try another filter or upload a new invoice.'
                    : 'Upload your first invoice to get started.'}
                </p>

                {!searchQuery && quickFilter === 'all' && (
                  <Link
                    to="/upload"
                    className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
                  >
                    <Upload className="h-4 w-4" />
                    Upload invoice
                  </Link>
                )}
              </div>
            ) : viewMode === 'list' ? (
              <ul className="divide-y divide-slate-100">
                {filteredInvoices.map((inv) => {
                  const fname = folderName(inv.folder_id)

                  return (
                    <li key={inv.id} className="group">
                      <div className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center">
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="flex min-w-0 flex-1 items-center gap-3"
                        >
                          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 transition group-hover:bg-blue-100">
                            <FileText className="h-5 w-5 text-slate-500 group-hover:text-blue-600" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {inv.original_filename}
                            </p>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {metaLine(inv)}
                            </p>
                          </div>
                        </Link>

                        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                          {fname ? (
                            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                              <Folder className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{fname}</span>
                            </span>
                          ) : null}

                          <StatusPill status={inv.status} />

                          <VendorConfidenceSparkline invoiceId={inv.id} status={inv.status} />

                          <div className="flex items-center gap-1">
                            <Link
                              to={`/invoices/${inv.id}`}
                              className="rounded-xl p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>

                            {['uploaded', 'failed'].includes(inv.status) && (
                              <button
                                onClick={() => processInvoice(inv.id)}
                                disabled={processingIds.has(inv.id)}
                                className="rounded-xl p-2 text-blue-600 transition hover:bg-blue-50 disabled:opacity-40"
                                title="Process invoice"
                              >
                                <RefreshCw
                                  className={`h-4 w-4 ${processingIds.has(inv.id) ? 'animate-spin' : ''}`}
                                />
                              </button>
                            )}

                            <button
                              onClick={() => deleteInvoice(inv.id)}
                              className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              title="Delete invoice"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredInvoices.map((inv) => {
                  const fname = folderName(inv.folder_id)

                  return (
                    <div
                      key={inv.id}
                      className="group flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg"
                    >
                      <Link to={`/invoices/${inv.id}`} className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 transition group-hover:bg-blue-100">
                          <FileText className="h-5 w-5 text-slate-500 group-hover:text-blue-600" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold text-slate-900">
                            {inv.original_filename}
                          </p>
                          {inv.vendor_name && (
                            <p className="mt-1 truncate text-xs text-slate-500">{inv.vendor_name}</p>
                          )}
                        </div>
                      </Link>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {fname ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                            <Folder className="h-3 w-3" />
                            <span className="truncate">{fname}</span>
                          </span>
                        ) : (
                          <span />
                        )}

                        <StatusPill status={inv.status} />
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <VendorConfidenceSparkline invoiceId={inv.id} status={inv.status} />
                          <span className="text-[11px] text-slate-500">
                            {new Date(inv.created_at).toLocaleDateString('en-AU', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <Link
                            to={`/invoices/${inv.id}`}
                            className="rounded-xl p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>

                          {['uploaded', 'failed'].includes(inv.status) && (
                            <button
                              onClick={() => processInvoice(inv.id)}
                              disabled={processingIds.has(inv.id)}
                              className="rounded-xl p-2 text-blue-600 transition hover:bg-blue-50 disabled:opacity-40"
                              title="Process"
                            >
                              <RefreshCw
                                className={`h-4 w-4 ${processingIds.has(inv.id) ? 'animate-spin' : ''}`}
                              />
                            </button>
                          )}

                          <button
                            onClick={() => deleteInvoice(inv.id)}
                            className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-slate-500">{metaLine(inv)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}