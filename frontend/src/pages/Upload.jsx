import { useState, useCallback, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { supabase } from '../lib/supabase'
import {
  Upload as UploadIcon,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Image as ImageIcon,
  FileUp,
} from 'lucide-react'

export default function Upload() {
  const navigate = useNavigate()

  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [uploadProgress, setUploadProgress] = useState({})

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  useEffect(() => {
    return () => {
      files.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview)
      })
    }
  }, [files])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.tif'],
    },
    maxSize: 10 * 1024 * 1024,
    disabled: uploading,
  })

  const removeFile = (id) => {
    const item = files.find((f) => f.id === id)
    if (item?.preview) URL.revokeObjectURL(item.preview)

    setFiles((prev) => prev.filter((f) => f.id !== id))
    setUploadStatus((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setUploadErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setUploadProgress((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const clearCompleted = () => {
    const remaining = files.filter((f) => uploadStatus[f.id] !== 'success')
    files.forEach((f) => {
      if (uploadStatus[f.id] === 'success' && f.preview) {
        URL.revokeObjectURL(f.preview)
      }
    })
    setFiles(remaining)

    setUploadStatus((prev) => {
      const next = {}
      remaining.forEach((f) => {
        if (prev[f.id]) next[f.id] = prev[f.id]
      })
      return next
    })

    setUploadErrors((prev) => {
      const next = {}
      remaining.forEach((f) => {
        if (prev[f.id]) next[f.id] = prev[f.id]
      })
      return next
    })

    setUploadProgress((prev) => {
      const next = {}
      remaining.forEach((f) => {
        if (prev[f.id] != null) next[f.id] = prev[f.id]
      })
      return next
    })
  }

  const uploadFiles = async () => {
    if (files.length === 0) return

    setUploading(true)
    setUploadErrors({})

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      alert('Please log in to upload files')
      setUploading(false)
      return
    }

    const { data: orgMembers } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)

    const organizationId = orgMembers?.[0]?.organization_id
    let successCount = 0

    for (const fileItem of files) {
      if (uploadStatus[fileItem.id] === 'success') {
        successCount++
        continue
      }

      setUploadStatus((prev) => ({ ...prev, [fileItem.id]: 'uploading' }))
      setUploadProgress((prev) => ({ ...prev, [fileItem.id]: 10 }))

      try {
        const fileExt = fileItem.file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
        const filePath = organizationId ? `${organizationId}/${fileName}` : `${user.id}/${fileName}`

        setUploadProgress((prev) => ({ ...prev, [fileItem.id]: 35 }))

        const { error: uploadError } = await supabase.storage
          .from('invoices-raw')
          .upload(filePath, fileItem.file)

        if (uploadError) throw uploadError

        setUploadProgress((prev) => ({ ...prev, [fileItem.id]: 75 }))

        const { error: dbError } = await supabase.from('invoices').insert({
          organization_id: organizationId || null,
          uploaded_by: user.id,
          original_filename: fileItem.file.name,
          file_path: filePath,
          file_size_bytes: fileItem.file.size,
          file_type: fileExt,
          status: 'uploaded',
          upload_source: 'web',
        })

        if (dbError) throw dbError

        setUploadProgress((prev) => ({ ...prev, [fileItem.id]: 100 }))
        setUploadStatus((prev) => ({ ...prev, [fileItem.id]: 'success' }))
        successCount++
      } catch (error) {
        console.error('Upload error:', error)
        setUploadStatus((prev) => ({ ...prev, [fileItem.id]: 'error' }))
        setUploadErrors((prev) => ({
          ...prev,
          [fileItem.id]: error.message || 'Upload failed. Check console for details.',
        }))
        setUploadProgress((prev) => ({ ...prev, [fileItem.id]: 0 }))
      }
    }

    setUploading(false)

    if (successCount === files.length && files.length > 0) {
      setTimeout(() => navigate('/invoices'), 1400)
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      case 'error':
        return <AlertCircle className="h-5 w-5 text-rose-500" />
      default:
        return <FileText className="h-5 w-5 text-slate-400" />
    }
  }

  const steps = [
    { icon: '🔍', label: 'Preprocess', desc: 'Clean and prepare the file' },
    { icon: '📝', label: 'OCR', desc: 'Read text from invoice' },
    { icon: '🤖', label: 'AI Extract', desc: 'Detect fields and values' },
    { icon: '✅', label: 'Review', desc: 'Validate and organise results' },
  ]

  const stats = useMemo(() => {
    const total = files.length
    const success = files.filter((f) => uploadStatus[f.id] === 'success').length
    const failed = files.filter((f) => uploadStatus[f.id] === 'error').length
    const pending = files.filter((f) => !uploadStatus[f.id]).length
    return { total, success, failed, pending }
  }, [files, uploadStatus])

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-5 sm:p-6 lg:p-8 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              AI-powered upload
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Upload invoices
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
              Drag files in, upload them securely, and let OCR and AI extract the
              key invoice data automatically.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Selected</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Pending</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">{stats.pending}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Uploaded</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.success}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Failed</p>
              <p className="mt-1 text-2xl font-bold text-rose-600">{stats.failed}</p>
            </div>
          </div>
        </div>
      </section>

      <section
        {...getRootProps()}
        className={[
          'group relative overflow-hidden rounded-3xl border-2 border-dashed p-6 sm:p-10 lg:p-14',
          'transition-all duration-300',
          uploading ? 'cursor-not-allowed opacity-80' : 'cursor-pointer',
          isDragActive
            ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100'
            : 'border-slate-300 bg-white hover:border-blue-300 hover:bg-blue-50/40',
        ].join(' ')}
      >
        <input {...getInputProps()} />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_30%)]" />

        <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
          <div
            className={[
              'mb-5 flex h-20 w-20 items-center justify-center rounded-3xl transition-all duration-300',
              isDragActive
                ? 'bg-blue-100 text-blue-600 scale-110'
                : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600',
            ].join(' ')}
          >
            <FileUp className="h-10 w-10" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {isDragActive ? 'Drop files to upload' : 'Drag and drop invoices here'}
          </h2>

          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            or click to browse from your computer
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              PDF
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              PNG
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              JPG
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              TIFF
            </span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700">
              Max 10 MB
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Selected files</h3>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                {files.length}
              </span>
            </div>

            {stats.success > 0 && (
              <button
                onClick={clearCompleted}
                type="button"
                className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
              >
                Clear completed
              </button>
            )}
          </div>

          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <FileText className="h-7 w-7 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-700">No files selected yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Add one or more invoices to begin upload.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {files.map((fileItem) => {
                const status = uploadStatus[fileItem.id]
                const progress = uploadProgress[fileItem.id] || 0

                return (
                  <div
                    key={fileItem.id}
                    className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {fileItem.preview ? (
                        <img
                          src={fileItem.preview}
                          alt=""
                          className="h-14 w-14 rounded-2xl object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                          {fileItem.file.type.startsWith('image/') ? (
                            <ImageIcon className="h-6 w-6 text-slate-400" />
                          ) : (
                            <FileText className="h-6 w-6 text-slate-400" />
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {fileItem.file.name}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{formatSize(fileItem.file.size)}</span>
                          {status && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="capitalize">{status}</span>
                            </>
                          )}
                        </div>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={[
                              'h-full rounded-full transition-all duration-500',
                              status === 'success'
                                ? 'bg-emerald-500'
                                : status === 'error'
                                ? 'bg-rose-500'
                                : 'bg-gradient-to-r from-blue-500 to-indigo-500',
                            ].join(' ')}
                            style={{
                              width:
                                status === 'success'
                                  ? '100%'
                                  : status === 'error'
                                  ? '100%'
                                  : `${progress}%`,
                            }}
                          />
                        </div>

                        {uploadErrors[fileItem.id] && (
                          <p className="mt-2 text-xs text-rose-600">
                            {uploadErrors[fileItem.id]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(status)}
                      </div>

                      {!uploading && status !== 'success' && (
                        <button
                          onClick={() => removeFile(fileItem.id)}
                          type="button"
                          className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <button
              onClick={uploadFiles}
              disabled={uploading || files.length === 0}
              className={[
                'inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold',
                'transition-all duration-200',
                uploading || files.length === 0
                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg',
              ].join(' ')}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Uploading {files.length} {files.length === 1 ? 'file' : 'files'}...
                </>
              ) : (
                <>
                  <UploadIcon className="h-5 w-5" />
                  Upload {files.length} {files.length === 1 ? 'file' : 'files'}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-blue-100 bg-gradient-to-br from-slate-50 to-blue-50 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h4 className="text-sm font-semibold text-slate-900">
                What happens after upload?
              </h4>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {steps.map((step) => (
                <div
                  key={step.label}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-2 text-2xl">{step.icon}</div>
                  <p className="text-sm font-semibold text-slate-800">{step.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-semibold text-slate-900">Tips</h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Use clean scans or sharp photos for better OCR results.</li>
              <li>PDF invoices usually extract more accurately than images.</li>
              <li>After upload, you can review and correct extracted fields.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}