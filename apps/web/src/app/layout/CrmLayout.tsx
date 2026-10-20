import { useState, useEffect, useRef, Suspense } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { cn } from '@/shared/utils/cn'
import { crmApi } from '@/shared/utils/request'
import { setAppTimezone } from '@/shared/utils/format'
import { AiAgentChat } from '@/shared/components/AiAgentChat'
import { LoadingSpinner } from '@/shared/components/LoadingSpinner'
import { prefetchAllRoutes, prefetchRoute } from '@/app/routes'
import { NavIcon } from './NavIcon'

export default function CrmLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useCrmAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 主导航按 访客 → 线索 → 客户 的流程排列；roles 为空表示所有角色可见
  const navItems: { to: string; label: string; icon: string; roles?: string[] }[] = [
    { to: '/app/dashboard', icon: 'dashboard', label: t('nav.dashboard') },
    { to: '/app/analytics', icon: 'analytics', label: t('nav.analytics'), roles: ['admin', 'operations'] },
    { to: '/app/leads', icon: 'leads', label: t('nav.leads') },
    { to: '/app/clients', icon: 'clients', label: t('nav.clients') },
    { to: '/app/activities', icon: 'activities', label: t('nav.activities') },
    { to: '/app/products', icon: 'products', label: t('nav.products'), roles: ['admin', 'operations'] },
  ]

  // 「设置」分组：AI 接入所有角色可用（用户通过 AI Agent / MCP 或外部系统接入）
  const settingsItems: { to: string; label: string; icon: string; roles?: string[] }[] = [
    { to: '/app/ai-access', icon: 'aiAccess', label: t('nav.aiAccess') },
    { to: '/app/users', icon: 'users', label: t('nav.users'), roles: ['admin'] },
    { to: '/app/settings', icon: 'settings', label: t('nav.settings'), roles: ['admin'] },
  ]

  // 登录后空闲时预加载其它页面，第一次点击导航不用等待下载
  useEffect(() => { prefetchAllRoutes() }, [])

  const { data: newLeadsData } = useQuery({
    queryKey: ['leads', 'new-count'],
    queryFn: () =>
      crmApi.get<{ total: number }>('/leads/new-count').then((r) => r.data.total),
    // 每个打开的页面都会轮询：间隔过短会大量消耗 Workers 请求数和 D1 读取额度
    // （页面在后台时 React Query 默认暂停轮询）
    // 2 分钟一次足够提醒新线索
    refetchInterval: 120_000,
    staleTime: 60_000,
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
    queryFn: () => crmApi.get<{ data: { systemName: string | null; timezone: string; aiAgentEnabled: boolean } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  const systemName = publicSettings?.systemName || t('common.brand')
  useEffect(() => { document.title = systemName }, [systemName])
  useEffect(() => {
    if (publicSettings?.timezone) setAppTimezone(publicSettings.timezone)
  }, [publicSettings?.timezone])

  type NavItem = { to: string; label: string; icon: string; roles?: string[] }
  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.roles || item.roles.includes(user?.role ?? ''))
  const navGroups = [
    { key: 'main', label: null, items: visible(navItems) },
    { key: 'settings', label: t('nav.groupSettings'), items: visible(settingsItems) },
  ]
  const roleLabel = user?.role ? t(`users.roles.${user.role === 'operations' ? 'operator' : user.role}`) : ''

  // 桌面端可收起为图标栏，偏好保存在本机
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('nav-collapsed') === '1' } catch { return false }
  })
  const toggleCollapsed = () => setCollapsed((v) => {
    try { localStorage.setItem('nav-collapsed', v ? '0' : '1') } catch { /* 忽略 */ }
    return !v
  })

  const BrandMark = ({ size = 'h-8 w-8 text-sm' }: { size?: string }) => (
    <span className={cn('flex flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 font-bold text-white shadow-sm', size)}>
      {systemName.slice(0, 1).toUpperCase()}
    </span>
  )

  const UserMenu = ({ onNavClick, compact }: { onNavClick?: (() => void) | undefined; compact?: boolean }) => {
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

    const itemCls = 'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors'
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          title={compact ? user?.name : undefined}
          className={cn('flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-gray-100', open && 'bg-gray-100', compact && 'justify-center')}
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
            {initials}
          </span>
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">{user?.name}</span>
                <span className="block truncate text-xs text-gray-400">{roleLabel}</span>
              </span>
              <NavIcon name="chevronUp" className={cn('h-4 w-4 text-gray-400 transition-transform', !open && 'rotate-180')} />
            </>
          )}
        </button>

        {open && (
          <div className={cn('absolute bottom-full mb-2 overflow-hidden rounded-xl border bg-white py-1 shadow-lg', compact ? 'left-0 w-52' : 'left-0 right-0')}>
            <div className="border-b px-3 py-2">
              <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="truncate text-xs text-gray-400">{user?.email}</p>
            </div>
            {[
              { tab: 'info',     icon: 'profile',  labelKey: 'profile.tabs.basic' },
              { tab: 'password', icon: 'password', labelKey: 'profile.tabs.password' },
              { tab: 'notify',   icon: 'notify',   labelKey: 'profile.tabs.notifications' },
            ].map(({ tab, icon, labelKey }) => (
              <NavLink key={tab} to={`/app/profile?tab=${tab}`} onClick={() => { setOpen(false); onNavClick?.() }} className={itemCls}>
                <NavIcon name={icon} className="h-4 w-4 text-gray-400" />
                {t(labelKey)}
              </NavLink>
            ))}
            <div className="my-1 border-t" />
            <button onClick={() => { toggleLang(); setOpen(false) }} className={itemCls}>
              <NavIcon name="language" className="h-4 w-4 text-gray-400" />
              {i18n.language === 'zh' ? 'English' : '中文'}
            </button>
            <button onClick={() => { handleLogout(); setOpen(false) }} className={cn(itemCls, 'text-red-600 hover:bg-red-50')}>
              <NavIcon name="logout" className="h-4 w-4" />
              {t('nav.logout')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const Sidebar = ({ onNavClick, compact = false }: { onNavClick?: () => void; compact?: boolean }) => (
    <>
      <div className={cn('flex h-16 items-center gap-2.5 border-b border-gray-100', compact ? 'justify-center px-2' : 'px-4')}>
        <BrandMark />
        {!compact && <span className="truncate text-[15px] font-semibold text-gray-900">{systemName}</span>}
      </div>
      <nav className={cn('flex-1 overflow-y-auto py-4', compact ? 'px-2' : 'px-3')}>
        {navGroups.map((group) => group.items.length > 0 && (
          <div key={group.key} className={cn('space-y-1', group.label && 'mt-6')}>
            {group.label && (compact
              ? <div className="mx-2 mb-2 border-t border-gray-100" />
              : <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>)}
            {group.items.map((item) => {
              const badge = item.to === '/app/leads' && newLeadsData != null && newLeadsData > 0
                ? (newLeadsData > 99 ? '99+' : String(newLeadsData)) : null
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavClick}
                  onMouseEnter={() => prefetchRoute(item.to)}
                  onFocus={() => prefetchRoute(item.to)}
                  onTouchStart={() => prefetchRoute(item.to)}
                  title={compact ? item.label : undefined}
                  className={({ isActive }) => cn(
                    'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                    compact ? 'justify-center px-2' : 'px-3',
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary-600" />}
                      <NavIcon name={item.icon} className={cn('h-[18px] w-[18px] flex-shrink-0', isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600')} />
                      {!compact && <span className="flex-1 truncate">{item.label}</span>}
                      {badge && (compact
                        ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                        : <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{badge}</span>)}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-gray-100 p-2">
        <UserMenu onNavClick={onNavClick} compact={compact} />
      </div>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 移动端顶部栏 */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b bg-white/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark size="h-7 w-7 text-xs" />
          <span className="truncate font-semibold text-gray-900">{systemName}</span>
        </div>
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          aria-label="menu"
        >
          <NavIcon name="menu" className="h-5 w-5" />
        </button>
      </div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'md:hidden fixed left-0 top-0 bottom-0 z-50 flex w-64 flex-col bg-white shadow-xl transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} />
      </aside>

      <aside className={cn('relative hidden flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:flex', collapsed ? 'w-[68px]' : 'w-60')}>
        <Sidebar compact={collapsed} />
        {/* 收起 / 展开 */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="absolute -right-3 top-[52px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm hover:text-gray-700"
        >
          <NavIcon name={collapsed ? 'expand' : 'collapse'} className="h-3.5 w-3.5" />
        </button>
      </aside>

      {/* 手机上底部留出空间，避免右下角的 AI 按钮挡住最后一条的操作 */}
      <main className="flex-1 overflow-y-auto pb-20 pt-14 md:pb-0 md:pt-0">
        {/* 页面加载时只在内容区显示加载中，导航保持可见 */}
        <Suspense fallback={<div className="flex h-full min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>}>
          <Outlet />
        </Suspense>
      </main>

      {publicSettings?.aiAgentEnabled !== false && <AiAgentChat />}
    </div>
  )
}
