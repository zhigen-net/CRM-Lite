// 产品与服务：服务项目（名称、价格、说明、交付步骤）与服务资料；线索的意向服务、客户的服务套餐和交付进度都来自这里
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Textarea } from '@/shared/components/Textarea'
import { Modal } from '@/shared/components/Modal'
import { FileManager } from '@/shared/components/FileManager'
import type { Service } from '@/shared/types'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  processSteps: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export default function ServicesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editTarget, setEditTarget] = useState<Service | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data),
  })

  const form = useForm<FormData>({ resolver: zodResolver(schema) })

  const openCreate = () => {
    form.reset({ name: '', description: '', price: null, processSteps: '' })
    setEditTarget(null)
    setShowCreate(true)
  }

  const openEdit = (s: Service) => {
    form.reset({ name: s.name, description: s.description, price: s.price, processSteps: (s.processSteps ?? []).join('\n') })
    setEditTarget(s)
    setShowCreate(true)
  }

  const saveMutation = useMutation({
    mutationFn: (body: FormData) => {
      const payload = { ...body, processSteps: body.processSteps ? body.processSteps.split('\n').map((s) => s.trim()).filter(Boolean) : [] }
      return editTarget ? crmApi.put(`/services/${editTarget.id}`, payload) : crmApi.post('/services', payload)
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['services'] }); setShowCreate(false) },
  })

  const deleteService = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/services/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  })

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('products.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{t('products.subtitle')}</p>
        </div>
        <Button onClick={openCreate}>{t('services.new')}</Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</div>
      ) : (
        <div className="space-y-4">
          {(data?.data ?? []).length === 0 && (
            <div className="rounded-xl border bg-white py-12 text-center text-sm text-gray-400">{t('products.noServices')}</div>
          )}
          {(data?.data ?? []).map((service) => {
            return (
              <div key={service.id} className="rounded-xl border overflow-hidden">
                {/* 服务头部 */}
                <div className="bg-white px-4 py-3 border-b flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-semibold text-gray-900">{service.name}</h2>
                      {service.price != null && (
                        <span className="text-sm font-medium text-primary-600">¥{service.price.toLocaleString()}</span>
                      )}
                    </div>
                    {service.description && (
                      <p className="mt-0.5 text-sm text-gray-500">{service.description}</p>
                    )}
                    {(service.processSteps ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                        {(service.processSteps ?? []).map((step, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <span className="w-4 h-4 rounded-full bg-primary-100 text-primary-700 text-center leading-4 flex-shrink-0 font-medium">{i + 1}</span>
                            {step}
                            {i < (service.processSteps ?? []).length - 1 && <span className="text-gray-300">→</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(service)}>{t('common.edit')}</Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { if (confirm(t('services.deleteConfirm', { name: service.name }))) deleteService.mutate(service.id) }}
                      className="text-red-500 hover:text-red-700"
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>

                {/* 服务资料：介绍、报价单等，跟进时可直接发给客户 */}
                <div className="bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-600 mb-3">{t('services.form.docs')}</p>
                  <FileManager entityType="service" entityId={service.id} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <Modal
          title={editTarget ? t('services.editTitle') : t('services.new')}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
              <Button loading={saveMutation.isPending} onClick={form.handleSubmit((d) => saveMutation.mutate(d))}>{t('common.save')}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('services.form.name')} error={form.formState.errors.name?.message} {...form.register('name')} />
            <Textarea label={t('services.form.description')} {...form.register('description')} />
            <Input label={t('services.form.price')} type="number" {...form.register('price')} />
            <Textarea label={t('services.form.steps')} rows={5} placeholder={t('products.serviceForm.stepsPlaceholder')} {...form.register('processSteps')} />
          </div>
        </Modal>
      )}
    </div>
  )
}
