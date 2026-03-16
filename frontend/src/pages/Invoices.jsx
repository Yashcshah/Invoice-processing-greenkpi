import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { supabase } from '../lib/supabase'
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
  ArrowRight,
} from 'lucide-react'

export default function Invoices() {
  const [invoices, setInvoices]               = useState([])
  const [loading, setLoading]                 = useState(true)
  const [searchQuery, setSearchQuery]         = useState('')
  const [statusFilter, setStatusFilter]       = useState('all')

  const [folders, setFolders]                 = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [newFolderName, setNewFolderName]     = useState('')
  const [showNewFolder, setShowNewFolder]     = useState(false)

  const [processingIds, setProcessingIds]     = useState(new Set())
  const [notification, setNotification]       = useState(null)

  useEffect(() => {
    axios.get('/api/folders').then(res => setFolders(res.data.folders)).catch(() => {})
  }, [])

  useEffect(() => { fetchInvoices() }, [statusFilter, selectedFolderId])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all')      query = query.eq('status', statusFilter)
      if (selectedFolderId === 'none') query = query.is('folder_id', null)
      else if (selectedFolderId)       query = query.eq('folder_id', selectedFolderId)

      const { data, error } = await query
      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteInvoice = async (id) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id)
      if (error) throw error
      setInvoices(prev => prev.filter(inv => inv.id !== id))
    } catch (error) {
      console.error('Error deleting invoice:', error)
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
    } catch (error) {
      const detail = error.response?.data?.detail || 'Failed to start processing'
      showNotification(detail, 'error')
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

  const getStatusStyle = (status) => {
    const map = {
      uploaded:              { dot: 'bg-gray-400',                    badge: 'bg-gray-100 text-gray-600' },
      preprocessing:         { dot: 'bg-amber-400 animate-pulse',     badge: 'bg-amber-100 text-amber-700' },
      preprocessed:          { dot: 'bg-blue-400',                    badge: 'bg-blue-100 text-blue-700' },
      ocr_processing:        { dot: 'bg-amber-400 animate-pulse',     badge: 'bg-amber-100 text-amber-700' },
      ocr_complete:          { dot: 'bg-blue-400',                    badge: 'bg-blue-100 text-blue-700' },
      extraction_processing: { dot: 'bg-amber-400 animate-pulse',     badge: 'bg-amber-100 text-amber-700' },
      extraction_complete:   { dot: 'bg-indigo-400',                  badge: 'bg-indigo-100 text-indigo-700' },
      validated:             { dot: 'bg-emerald-400',                 badge: 'bg-emerald-100 text-emerald-700' },
      exported:              { dot: 'bg-emerald-400',                 badge: 'bg-emerald-100 text-emerald-700' },
      failed:                { dot: 'bg-rose-400',                    badge: 'bg-rose-100 text-rose-700' },
    }
    return map[status] || { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600' }
  }

  const filteredInvoices = invoices.filter(inv =>
    inv.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const statusOptions = [
    { value: 'all',                 label: 'All Status' },
    { value: 'uploaded',            label: 'Uploaded' },
    { value: 'preprocessing',       label: 'Preprocessing' },
    { value: 'ocr_complete',        label: 'OCR Complete' },
    { value: 'extraction_complete', label: 'Extracted' },
    { value: 'validated',           label: 'Validated' },
    { value: 'failed',              label: 'Failed' },
  ]

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Toast notification ────────────────────── */}
      {notification && (
        <div className={`
          fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium shadow-lg animate-slide-in-right
          ${notification.type === 'error'
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }
        `}>
          {notification.type === 'error' ? '❌' : '✅'} {notification.msg}
        </div>
      )}

      <div className="flex gap-5 items-start">

        {/* ── Folder sidebar ────────────────────────── */}
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
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-all duration-150 ${selectedFolderId === null ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <FolderOpen className={`w-4 h-4 flex-shrink-0 ${selectedFolderId === null ? 'text-blue-500' : 'text-gray-400'}`} />
              All Invoices
            </button>

            {folders.map((folder, i) => (
              <div
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`animate-slide-in-left group flex items-center gap-2.5 px-4 py-2.5 text-sm cursor-pointer transition-all duration-150 ${selectedFolderId === folder.id ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <Folder className={`w-4 h-4 flex-shrink-0 ${selectedFolderId === folder.id ? 'text-blue-500' : 'text-gray-400'}`} />
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
              <p className="px-4 py-4 text-xs text-gray-400 italic text-center">
                No folders yet
              </p>
            )}
          </nav>
        </aside>

        {/* ── Main content ──────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Active folder breadcrumb */}
          {selectedFolderId && selectedFolderId !== 'none' && (
            <div className="flex items-center gap-2 text-sm text-gray-600 animate-slide-in-right">
              <Folder className="w-4 h-4 text-blue-500" />
              <span className="font-semibold text-gray-800">
                {folders.find(f => f.id === selectedFolderId)?.name}
              </span>
              <button onClick={() => setSelectedFolderId(null)} className="ml-1 p-0.5 text-gray-400 hover:text-gray-700 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search invoices…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-blue-300 outline-none transition-shadow"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-blue-300 outline-none text-gray-700"
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={fetchInvoices}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 bg-white rounded-xl hover:bg-gray-50 text-sm text-gray-600 font-medium transition-all duration-200 hover:shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            {loading ? (
              <div className="divide-y divide-gray-100">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-10 h-10 rounded-xl shimmer-bg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-48 shimmer-bg rounded" />
                      <div className="h-3 w-24 shimmer-bg rounded" />
                    </div>
                    <div className="h-6 w-20 shimmer-bg rounded-full" />
                  </div>
                ))}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-16 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-blue-300 animate-float" />
                </div>
                <p className="text-gray-600 font-medium mb-1">
                  {searchQuery ? 'No invoices match your search' : 'No invoices here yet'}
                </p>
                <p className="text-sm text-gray-400 mb-6">
                  {searchQuery ? 'Try a different search term' : 'Upload your first invoice to get started'}
                </p>
                {!searchQuery && (
                  <Link
                    to="/upload"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Invoice
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-200">
                      {['Filename', 'Vendor', 'Status', 'Size', 'Uploaded', ''].map((h, i) => (
                        <th
                          key={i}
                          className={`px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${i === 5 ? 'text-right' : 'text-left'}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInvoices.map((invoice, i) => {
                      const s = getStatusStyle(invoice.status)
                      return (
                        <tr
                          key={invoice.id}
                          style={{ animationDelay: `${i * 40}ms` }}
                          className="animate-slide-in-left hover:bg-blue-50/30 transition-colors duration-150 group"
                        >
                          {/* Filename */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-gray-100 rounded-xl group-hover:bg-blue-100 transition-colors duration-200 flex-shrink-0">
                                <FileText className="w-4 h-4 text-gray-500 group-hover:text-blue-600 transition-colors duration-200" />
                              </div>
                              <div>
                                <Link
                                  to={`/invoices/${invoice.id}`}
                                  className="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-sm flex items-center gap-1 group/link"
                                >
                                  {invoice.original_filename}
                                  <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover/link:opacity-100 -translate-x-1 group-hover/link:translate-x-0 transition-all duration-200" />
                                </Link>
                                <p className="text-xs text-gray-400 mt-0.5">{invoice.file_type?.toUpperCase()}</p>
                              </div>
                            </div>
                          </td>

                          {/* Vendor */}
                          <td className="px-5 py-3.5 text-sm">
                            {invoice.vendor_name
                              ? <span className="font-medium text-indigo-600">{invoice.vendor_name}</span>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>

                          {/* Status */}
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                              {invoice.status.replace(/_/g, ' ')}
                            </span>
                          </td>

                          {/* Size */}
                          <td className="px-5 py-3.5 text-sm text-gray-500">
                            {invoice.file_size_bytes
                              ? `${(invoice.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
                              : <span className="text-gray-300">—</span>
                            }
                          </td>

                          {/* Date */}
                          <td className="px-5 py-3.5 text-sm text-gray-500">
                            {new Date(invoice.created_at).toLocaleDateString()}
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity duration-200">
                              <Link
                                to={`/invoices/${invoice.id}`}
                                className="p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all duration-150"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </Link>
                              {['uploaded', 'failed'].includes(invoice.status) && (
                                <button
                                  onClick={() => processInvoice(invoice.id)}
                                  disabled={processingIds.has(invoice.id)}
                                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-150 disabled:opacity-40"
                                  title="Process Invoice"
                                >
                                  <RefreshCw className={`w-4 h-4 ${processingIds.has(invoice.id) ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                              <button
                                onClick={() => deleteInvoice(invoice.id)}
                                className="p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all duration-150"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
