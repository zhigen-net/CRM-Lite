import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { CrmAuthProvider } from '@/app/auth/CrmAuthContext'
import { PortalAuthProvider } from '@/portal/auth/PortalAuthContext'
import { CrmGuard } from '@/app/auth/CrmGuard'
import { PortalGuard } from '@/portal/auth/PortalGuard'
import { LoadingSpinner } from '@/shared/components/LoadingSpinner'
import { pages } from '@/app/routes'

// 内部 CRM 页面（懒加载）
const CrmLogin = lazy(() => import('@/app/auth/LoginPage'))
const CrmLayout = lazy(() => import('@/app/layout/CrmLayout'))
// 客户门户页面（懒加载）
const PortalLogin = lazy(() => import('@/portal/auth/LoginPage'))
const PortalLayout = lazy(() => import('@/portal/layout/PortalLayout'))
const PortalProfilePage = lazy(() => import('@/portal/profile/ProfilePage'))
const PortalServicesPage = lazy(() => import('@/portal/services/ServicesPage'))
const PortalResourcesPage = lazy(() => import('@/portal/resources/ResourcesPage'))
const PortalProgressPage = lazy(() => import('@/portal/progress/ProgressPage'))

const P = pages

export default function App() {
  return (
    // 导航切换放进 startTransition：新页面下载完成前继续显示当前页面
    <BrowserRouter future={{ v7_startTransition: true }}>
      <Suspense fallback={<LoadingSpinner fullScreen />}>
        <Routes>
          {/* 根路径重定向 */}
          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />

          {/* 内部 CRM */}
          <Route
            path="/app/*"
            element={
              <CrmAuthProvider>
                <Routes>
                  <Route path="login" element={<CrmLogin />} />
                  <Route
                    path="*"
                    element={
                      <CrmGuard>
                        <CrmLayout />
                      </CrmGuard>
                    }
                  >
                    <Route path="dashboard" element={<P.dashboard />} />
                    {/* 详情在列表页的抽屉里打开：同一个路由，切换详情时列表不重新加载 */}
                    <Route path="leads/:id?" element={<P.leads />} />
                    <Route path="clients/:id?" element={<P.clients />} />
                    <Route path="products" element={<P.products />} />
                    <Route path="services" element={<Navigate to="/app/products" replace />} />
                    <Route path="partners" element={<Navigate to="/app/products" replace />} />
                    <Route path="activities" element={<Navigate to="/app/operation-log" replace />} />
                    <Route path="operation-log" element={<P.operationLog />} />
                    <Route path="users" element={<P.users />} />
                    <Route path="settings" element={<P.settings />} />
                    <Route path="settings/workflows/new" element={<P.workflowEditor />} />
                    <Route path="settings/workflows/:wfId" element={<P.workflowEditor />} />
                    <Route path="docs" element={<Navigate to="/app/settings?tab=automation" replace />} />
                    <Route path="settings/options" element={<Navigate to="/app/settings" replace />} />
                    <Route path="profile" element={<P.profile />} />
                    <Route path="ai-access" element={<P.aiAccess />} />
                    <Route path="ai-access/sites/:id" element={<P.siteRedirect />} />
                    <Route path="analytics" element={<P.analytics />} />
                    <Route index element={<Navigate to="dashboard" replace />} />
                  </Route>
                </Routes>
              </CrmAuthProvider>
            }
          />

          {/* 客户门户 */}
          <Route
            path="/portal/*"
            element={
              <PortalAuthProvider>
                <Routes>
                  <Route path="login" element={<PortalLogin />} />
                  <Route
                    path="*"
                    element={
                      <PortalGuard>
                        <PortalLayout />
                      </PortalGuard>
                    }
                  >
                    <Route path="profile" element={<PortalProfilePage />} />
                    <Route path="services" element={<PortalServicesPage />} />
                    <Route path="resources" element={<PortalResourcesPage />} />
                    <Route path="progress" element={<PortalProgressPage />} />
                    <Route index element={<Navigate to="profile" replace />} />
                  </Route>
                </Routes>
              </PortalAuthProvider>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
