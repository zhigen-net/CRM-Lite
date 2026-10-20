import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { CrmAuthProvider } from '@/app/auth/CrmAuthContext'
import { PortalAuthProvider } from '@/portal/auth/PortalAuthContext'
import { CrmGuard } from '@/app/auth/CrmGuard'
import { PortalGuard } from '@/portal/auth/PortalGuard'
import { LoadingSpinner } from '@/shared/components/LoadingSpinner'

// 内部 CRM 页面（懒加载）
const CrmLogin = lazy(() => import('@/app/auth/LoginPage'))
const CrmLayout = lazy(() => import('@/app/layout/CrmLayout'))
const LeadsPage = lazy(() => import('@/app/leads/LeadsPage'))
const LeadDetailPage = lazy(() => import('@/app/leads/LeadDetailPage'))
const ClientsPage = lazy(() => import('@/app/clients/ClientsPage'))
const ClientDetailPage = lazy(() => import('@/app/clients/ClientDetailPage'))
const ServicesPage = lazy(() => import('@/app/services/ServicesPage'))
const ActivitiesPage = lazy(() => import('@/app/activities/ActivitiesPage'))
const UsersPage = lazy(() => import('@/app/users/UsersPage'))
const SystemSettingsPage = lazy(() => import('@/app/settings/SystemSettingsPage'))
const WorkflowEditorPage = lazy(() => import('@/app/settings/workflows/WorkflowEditorPage'))
const ProfilePage = lazy(() => import('@/app/profile/ProfilePage'))
const AiAccessPage = lazy(() => import('@/app/ai-access/AiAccessPage'))
const SiteDetailPage = lazy(() => import('@/app/sites/SiteDetailPage'))
const AnalyticsPage = lazy(() => import('@/app/analytics/AnalyticsPage'))

// 客户门户页面（懒加载）
const PortalLogin = lazy(() => import('@/portal/auth/LoginPage'))
const PortalLayout = lazy(() => import('@/portal/layout/PortalLayout'))
const PortalProfilePage = lazy(() => import('@/portal/profile/ProfilePage'))
const PortalServicesPage = lazy(() => import('@/portal/services/ServicesPage'))
const PortalResourcesPage = lazy(() => import('@/portal/resources/ResourcesPage'))
const PortalProgressPage = lazy(() => import('@/portal/progress/ProgressPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner fullScreen />}>
        <Routes>
          {/* 根路径重定向 */}
          <Route path="/" element={<Navigate to="/app/leads" replace />} />

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
                    <Route path="leads" element={<LeadsPage />} />
                    <Route path="leads/:id" element={<LeadDetailPage />} />
                    <Route path="clients" element={<ClientsPage />} />
                    <Route path="clients/:id" element={<ClientDetailPage />} />
                    <Route path="products" element={<ServicesPage />} />
                    <Route path="services" element={<Navigate to="/app/products" replace />} />
                    <Route path="partners" element={<Navigate to="/app/products" replace />} />
                    <Route path="activities" element={<ActivitiesPage />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="settings" element={<SystemSettingsPage />} />
                    <Route path="settings/workflows/new" element={<WorkflowEditorPage />} />
                    <Route path="settings/workflows/:wfId" element={<WorkflowEditorPage />} />
                    <Route path="docs" element={<Navigate to="/app/settings?tab=automation" replace />} />
                    <Route path="settings/options" element={<Navigate to="/app/settings" replace />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="ai-access" element={<AiAccessPage />} />
                    <Route path="ai-access/sites/:id" element={<SiteDetailPage />} />
                    <Route path="analytics" element={<AnalyticsPage />} />
                    <Route index element={<Navigate to="leads" replace />} />
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
