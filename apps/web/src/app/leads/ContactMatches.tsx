// 相同联系方式的线索和客户：新建、编辑时提示可能重复，详情页显示该联系方式之前来过（只提示，不拦截）
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { getOptionLabel, useOptionGroup } from '@/shared/hooks/useOptions'

interface ContactMatch {
  type: 'lead' | 'client'
  id: string
  leadNo: number | null
  name: string
  status: string | null
  ownerName: string | null
  createdAt: string
  canView: boolean
}

export function ContactMatches({ contact, excludeId }: { contact: string; excludeId?: string | undefined }) {
  const { t } = useTranslation()
  const { options: leadStatusOpts } = useOptionGroup('lead_status')
  const [debounced, setDebounced] = useState(contact.trim())
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(contact.trim()), 400)
    return () => clearTimeout(timer)
  }, [contact])

  const { data } = useQuery({
    queryKey: ['lead-contact-matches', debounced, excludeId ?? ''],
    queryFn: () => crmApi.get<{ data: ContactMatch[] }>('/leads/contact-matches', { params: { contact: debounced, excludeId } })
      .then((r) => r.data.data),
    enabled: debounced.length >= 5,
    staleTime: 60_000,
  })
  if (!data || data.length === 0 || debounced.length < 5) return null

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <p className="font-medium">{t('leads.matches.title', { count: data.length })}</p>
      <ul className="mt-1 space-y-0.5">
        {data.slice(0, 5).map((m) => {
          const label = m.type === 'client'
            ? t('leads.matches.client', { name: m.name })
            : `${m.leadNo != null ? `L-${String(m.leadNo).padStart(4, '0')} ` : ''}${m.name}`
          const path = m.type === 'client' ? `/app/clients/${m.id}` : `/app/leads/${m.id}`
          return (
            <li key={`${m.type}-${m.id}`} className="break-all">
              {m.canView
                ? <Link to={path} className="font-medium text-amber-900 underline hover:text-amber-700">{label}</Link>
                : <span className="font-medium">{label}</span>}
              <span className="text-amber-700">
                {' · '}{t('leads.matches.owner', { name: m.ownerName ?? t('leads.matches.unassigned') })}
                {m.type === 'lead' && m.status && <>{' · '}{getOptionLabel(leadStatusOpts, m.status)}</>}
                {' · '}{m.createdAt.slice(0, 10)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
