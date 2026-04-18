import { Outlet, Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  FileText,
  LayoutDashboard,
  Upload,
  FileStack,
  LogOut,
  Menu,
  X,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { useMemo, useState } from 'react'

export default function Layout({ session }) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Upload Invoice', href: '/upload', icon: Upload },
    { name: 'All Invoices', href: '/invoices', icon: FileStack },
  ]

  const isActive = (path) => location.pathname === path

  const currentPageTitle = useMemo(() => {
    return navigation.find((n) => isActive(n.href))?.name ?? 'Invoice Detail'
  }, [location.pathname])

  const userInitial = session.user.email?.[0]?.toUpperCase() ?? '?'
  const userName =
    session.user.user_metadata?.full_name ||
    session.user.email?.split('@')[0] ||
    'User'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-full w-[272px] flex-col
          border-r border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl
          transition-transform duration-300 ease-out lg:translate-x-0 lg:shadow-none
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Brand */}
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-200/60">
              <FileText className="h-5 w-5 text-white" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-slate-900">
                InvoiceAI
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Smart Processing
              </p>
            </div>

            <button
              className="ml-auto rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Navigation
          </p>

          <nav className="space-y-1.5">
            {navigation.map((item) => {
              const active = isActive(item.href)
              const Icon = item.icon

              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium
                    transition-all duration-200
                    ${
                      active
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200/60'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }
                  `}
                >
                  <div
                    className={`
                      flex h-9 w-9 items-center justify-center rounded-xl transition
                      ${
                        active
                          ? 'bg-white/15 text-white'
                          : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700'
                      }
                    `}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>

                  <span className="flex-1">{item.name}</span>

                  <ChevronRight
                    className={`h-4 w-4 transition ${
                      active
                        ? 'translate-x-0 text-white/80'
                        : 'text-slate-300 group-hover:translate-x-0.5 group-hover:text-slate-500'
                    }`}
                  />
                </Link>
              )
            })}
          </nav>
        </div>

        {/* AI card */}
        <div className="px-3 pb-3">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-100">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <span className="text-xs font-semibold text-blue-700">AI-powered workflow</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              OCR extraction, smart classification, and faster invoice review.
            </p>
          </div>
        </div>

        {/* User section */}
        <div className="border-t border-slate-100 px-3 py-3">
          <div className="mb-2 flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-sm font-bold text-white shadow-sm">
              {userInitial}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
              <p className="truncate text-xs text-slate-500">{session.user.email}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-col lg:pl-[272px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3.5 lg:px-8">
            <button
              className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>

            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                {currentPageTitle}
              </h1>
              <p className="hidden text-xs text-slate-500 sm:block">
                Manage and monitor your invoice workflow
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-emerald-700">System online</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-6 xl:p-8">
          <div key={location.pathname} className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}