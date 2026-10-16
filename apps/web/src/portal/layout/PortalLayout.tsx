import { useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { usePortalAuth } from '@/portal/auth/PortalAuthContext'
import { Button } from '@/shared/components/Button'
import { cn } from '@/shared/utils/cn'
import { crmApi } from '@/shared/utils/request'

export default function PortalLayout() {
  const { t } = useTranslation()
  const { clientUser, logout } = usePortalAuth()
  const navigate = useNavigate()

  const navItems = [
    { to: '/portal/profile', label: t('portal.nav.profile') },
    { to: '/portal/services', label: t('portal.nav.services') },
    { to: '/portal/progress', label: t('portal.nav.progress') },
    { to: '/portal/resources', label: t('portal.nav.resources') },
  ]

  const { data: publicSettings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => crmApi.get<{ data: { systemName: string | null } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  const systemName = publicSettings?.systemName || t('portal.auth.title')
  useEffect(() => { document.title = systemName }, [systemName])

  const handleLogout = () => {
    logout()
    navigate('/portal/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16 sm:pb-0">
      {/* 顶部导航 */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <span className="font-bold text-gray-900">{systemName}</span>

          {/* 桌面端导航 */}
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-sm text-gray-500 max-w-[140px] truncate">
              {clientUser?.email}
            </span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              {t('portal.nav.logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>

      {/* 移动端底部导航栏 */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 flex border-t bg-white">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center py-2 text-xs font-medium transition-colors',
                isActive ? 'text-primary-600' : 'text-gray-500',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
