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
  Star,
} from 'lucide-react'
import { useState } from 'react'

export default function Layout({ session }) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const navigation = [
    { name: 'Dashboard',      href: '/dashboard', icon: LayoutDashboard },
    { name: 'Upload Invoice', href: '/upload',    icon: Upload },
    { name: 'All Invoices',   href: '/invoices',  icon: FileStack },
  ]

  const isActive = (path) => location.pathname === path

  const userInitial = session.user.email?.[0]?.toUpperCase() ?? '?'
  const userName    = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside className={`
        fixed top-0 left-0 z-50 h-full w-64 flex flex-col
        bg-white border-r border-gray-200 shadow-xl
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0 lg:shadow-none
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-200">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold text-gray-900 leading-tight">InvoiceAI</span>
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Processing</span>
          </div>
          <button
            className="ml-auto lg:hidden p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navigation.map((item, i) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`
                  animate-slide-in-left
                  group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-200 relative overflow-hidden
                  ${active
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }
                `}
              >
                {/* Active left bar */}
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-full" />
                )}
                <item.icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* AI badge */}
        <div className="mx-3 mb-3 p-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100">
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-blue-700">AI-Powered</span>
          </div>
          <p className="text-[11px] text-blue-500 leading-relaxed">
            Automatic OCR extraction & vendor classification
          </p>
        </div>

        {/* User section */}
        <div className="px-3 pb-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-xs font-bold text-white">{userInitial}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
              <p className="text-xs text-gray-400 truncate">{session.user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200 group"
          >
            <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-4 px-4 py-3.5 bg-white/80 backdrop-blur border-b border-gray-200 lg:px-8">
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {navigation.find(n => isActive(n.href))?.name ?? 'Invoice Detail'}
          </h1>

          {/* Right side: subtle breadcrumb indicator */}
          <div className="ml-auto flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse-soft" title="System online" />
            <span className="text-xs text-gray-400 hidden sm:block">System online</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
