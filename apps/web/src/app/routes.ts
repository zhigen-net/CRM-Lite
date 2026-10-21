// CRM 页面的懒加载入口：页面按需拆分成单独的文件，同时提供预加载
// 登录后浏览器空闲时预加载全部页面、鼠标移到导航上时预加载对应页面，避免第一次点击时等待下载
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type Loader = () => Promise<{ default: ComponentType }>

const loaders = {
  dashboard: () => import('@/app/dashboard/DashboardPage'),
  leads: () => import('@/app/leads/LeadsPage'),
  leadDetail: () => import('@/app/leads/LeadDetailPage'),
  clients: () => import('@/app/clients/ClientsPage'),
  clientDetail: () => import('@/app/clients/ClientDetailPage'),
  products: () => import('@/app/services/ServicesPage'),
  operationLog: () => import('@/app/operation-log/OperationLogPage'),
  users: () => import('@/app/users/UsersPage'),
  settings: () => import('@/app/settings/SystemSettingsPage'),
  workflowEditor: () => import('@/app/settings/workflows/WorkflowEditorPage'),
  profile: () => import('@/app/profile/ProfilePage'),
  aiAccess: () => import('@/app/ai-access/AiAccessPage'),
  siteRedirect: () => import('@/app/sites/SiteDrawer'),
  analytics: () => import('@/app/analytics/AnalyticsPage'),
} satisfies Record<string, Loader>

type PageKey = keyof typeof loaders
const keys = Object.keys(loaders) as PageKey[]

export const pages = {} as Record<PageKey, LazyExoticComponent<ComponentType>>
for (const k of keys) pages[k] = lazy<ComponentType>(loaders[k])

/** 导航地址对应的页面（列表页进入详情页的也一起预加载） */
const byPath: Record<string, PageKey[]> = {
  '/app/dashboard': ['dashboard'],
  '/app/leads': ['leads', 'leadDetail'],
  '/app/clients': ['clients', 'clientDetail'],
  '/app/products': ['products'],
  '/app/operation-log': ['operationLog'],
  '/app/users': ['users'],
  '/app/settings': ['settings'],
  '/app/profile': ['profile'],
  '/app/ai-access': ['aiAccess'],
  '/app/analytics': ['analytics'],
}

const started = new Set<string>()
const load = (k: PageKey) => {
  if (started.has(k)) return
  started.add(k)
  // 预加载失败（网络中断等）不影响使用，真正打开页面时会重新加载
  loaders[k]().catch(() => started.delete(k))
}

/** 预加载某个导航地址对应的页面 */
export function prefetchRoute(path: string) {
  byPath[path.split('?')[0] ?? '']?.forEach(load)
}

/** 浏览器空闲时预加载全部页面；开启省流量模式时跳过 */
export function prefetchAllRoutes() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  const run = () => keys.forEach(load)
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
