// 编辑线索基本信息：姓名、联系方式、来源、意向服务、备注（录入有误时修正）
// 只提交有变化的字段；修改会写入线索的系统变更记录
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Modal } from '@/shared/components/Modal'
import { Input } from '@/shared/components/Input'
import { Textarea } from '@/shared/components/Textarea'
import { Button } from '@/shared/components/Button'
import { Combobox } from '@/shared/components/Combobox'
import { ContactMatches } from './ContactMatches'
import type { Lead, Service } from '@/shared/types'

export function LeadEditModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: lead.name, contactInfo: lead.contactInfo, source: lead.source ?? '',
    intendedServices: lead.intendedServices ?? [], notes: lead.notes ?? '',
  })
  // 与线索列表共用缓存，格式一致（来源为数组；服务为 { data }）
  const { data: sources } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: () => crmApi.get<{ data: string[] }>('/leads/sources').then((r) => r.data.data),
  })
  const { data: servicesData } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data),
  })
  // 已停用的服务如果线索上已有，也要显示出来，避免保存时被丢掉
  const serviceNames = [...new Set([...(servicesData?.data ?? []).map((s) => s.name), ...form.intendedServices])]

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {}
      if (form.name.trim() !== lead.name) patch.name = form.name
      if (form.contactInfo.trim() !== lead.contactInfo) patch.contactInfo = form.contactInfo
      if (form.source.trim() !== (lead.source ?? '')) patch.source = form.source
      if (JSON.stringify(form.intendedServices) !== JSON.stringify(lead.intendedServices ?? [])) patch.intendedServices = form.intendedServices
      if (form.notes !== (lead.notes ?? '')) patch.notes = form.notes.trim() ? form.notes : null
      return Object.keys(patch).length ? crmApi.put(`/leads/${lead.id}`, patch) : Promise.resolve(null)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] })
      queryClient.invalidateQueries({ queryKey: ['activities', 'lead', lead.id] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-sources'] })
      onClose()
    },
  })
  const error = (save.error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message
  const valid = form.name.trim() && form.contactInfo.trim() && form.source.trim()
  const toggle = (name: string) => setForm((f) => ({
    ...f, intendedServices: f.intendedServices.includes(name) ? f.intendedServices.filter((s) => s !== name) : [...f.intendedServices, name],
  }))

  return (
    <Modal title={t('leads.edit.title')} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t('common.save')}</Button>
      </>}>
      <div className="space-y-3">
        <Input label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label={t('leads.cols.contact')} value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} />
        {form.contactInfo.trim() !== lead.contactInfo && <ContactMatches contact={form.contactInfo} excludeId={lead.id} />}
        <Combobox label={t('leads.cols.source')} value={form.source} onChange={(v) => setForm({ ...form, source: v })}
          options={sources ?? []} placeholder={t('leads.form.sourcePlaceholder')} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-700">{t('leads.cols.service')}</p>
          <div className="flex flex-wrap gap-2">
            {serviceNames.map((name) => (
              <button key={name} type="button" onClick={() => toggle(name)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${form.intendedServices.includes(name) ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:border-primary-400'}`}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <Textarea label={t('leads.form.notes')} value={form.notes} rows={4} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <p className="text-xs text-gray-400">{t('leads.edit.hint')}</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  )
}
