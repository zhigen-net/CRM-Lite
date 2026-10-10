import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { Button } from '@/shared/components/Button'
import { cn } from '@/shared/utils/cn'
import { crmApi } from '@/shared/utils/request'
import { setAppTimezone } from '@/shared/utils/format'
import { AiAgentChat } from '@/shared/components/AiAgentChat'

export default function CrmLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useCrmAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navItems = [
    { to: '/app/leads', label: t('nav.leads') },
    { to: '/app/clients', label: t('nav.clients') },
    { to: '/app/activities', label: t('nav.activities') },
    { to: '/app/products', label: t('nav.products'), roles: ['admin', 'operations'] },
  ]

  const adminNavItems = [
    { to: '/app/users', label: t('nav.users') },
    { to: '/app/settings', label: t('nav.settings') },
  ]

  const { data: newLeadsData } = useQuery({
    queryKey: ['leads', 'new-count'],
    queryFn: () =>
      crmApi.get<{ total: number }>('/leads/new-count').then((r) => r.data.total),
    // 每个打开的页面都会轮询：间隔过短会大量消耗 Workers 请求数和 D1 读取额度
    // （页面在后台时 React Query 默认暂停轮询）
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const handleLogout = () => {
    logout()
    navigate('/app/login')
  }

  const toggleLang = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    i18n.changeLanguage(next)
  }

  const { data: publicSettings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => crmApi.get<{ data: { systemName: string; timezone: string; aiAgentEnabled: boolean } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  const systemName = publicSettings?.systemName ?? 'CRM'
  useEffect(() => { document.title = systemName }, [systemName])
  useEffect(() => {
    if (publicSettings?.timezone) setAppTimezone(publicSettings.timezone)
  }, [publicSettings?.timezone])

  const docsItem = { to: '/app/docs', label: t('nav.docs') }
  const filteredNavItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(user?.role ?? ''),
  )
  const allNavItems =
    user?.role === 'admin'
      ? [...filteredNavItems, ...adminNavItems, docsItem]
      : [...filteredNavItems, docsItem]

  const UserMenu = ({ onNavClick }: { onNavClick?: (() => void) | undefined }) => {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const initials = (user?.name ?? '?').slice(0, 1).toUpperCase()

    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }, [])

    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
            {initials}
          </span>
          <span className="flex-1 text-left truncate">{user?.name}</span>
          <span className="text-xs text-gray-400">{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-white shadow-lg overflow-hidden">
            {[
              { tab: 'info',     icon: '👤', labelKey: 'profile.tabs.basic' },
              { tab: 'password', icon: '🔑', labelKey: 'profile.tabs.password' },
              { tab: 'api',      icon: '🔌', labelKey: 'profile.tabs.api' },
              { tab: 'notify',   icon: '🔔', labelKey: 'profile.tabs.notifications' },
            ].map(({ tab, icon, labelKey }) => (
              <NavLink
                key={tab}
                to={`/app/profile?tab=${tab}`}
                onClick={() => { setOpen(false); onNavClick?.() }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className="w-5 text-center">{icon}</span>
                {t(labelKey)}
              </NavLink>
            ))}
            <div className="border-t" />
            <button
              onClick={() => { toggleLang(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="w-5 text-center">🌐</span>
              {i18n.language === 'zh' ? 'English' : '中文'}
            </button>
            <div className="border-t" />
            <button
              onClick={() => { handleLogout(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <span className="w-5 text-center">🚪</span>
              {t('nav.logout')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const Sidebar = ({ onNavClick }: { onNavClick?: () => void }) => (
    <>
      <div className="flex h-14 items-center px-4 border-b">
        <span className="font-bold text-gray-900">{systemName}</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {allNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              )
            }
          >
            {item.label}
            {item.to === '/app/leads' && newLeadsData != null && newLeadsData > 0 && (
              <span className="ml-1.5 flex-shrink-0 rounded-full bg-red-400 text-white min-w-[14px] h-3.5 flex items-center justify-center px-1" style={{ fontSize: '9px', lineHeight: 1 }}>
                {newLeadsData > 99 ? '99+' : newLeadsData}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-2">
        <UserMenu onNavClick={onNavClick} />
      </div>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-100">
      {/* mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between bg-white px-4 shadow-sm">
        <span className="font-bold text-gray-900">{systemName}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLang}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 text-sm font-medium"
          >
            {i18n.language === 'zh' ? 'EN' : '中'}
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'md:hidden fixed left-0 top-0 bottom-0 z-50 flex w-64 flex-col bg-white shadow-xl transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} />
      </aside>

      <aside className="hidden md:flex w-56 flex-col bg-white shadow-sm flex-shrink-0">
        <Sidebar />
      </aside>

      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <Outlet />
      </main>

      {publicSettings?.aiAgentEnabled !== false && <AiAgentChat />}
    </div>
  )
}
