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

interface PartnerProduct {
  id: string
  partnerId: string
  partnerName: string
  serviceId: string
  name: string
  description: string | null
  price: number | null
  currency: string
  isActive: number
}

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

  const { data: allProductsData } = useQuery({
    queryKey: ['partner-products-by-service'],
    queryFn: () =>
      crmApi.get<{ data: PartnerProduct[] }>('/partner-products', { params: { active: 'true' } }).then((r) => r.data),
    staleTime: 1000 * 30,
  })

  const productsByService = (allProductsData?.data ?? []).reduce<Record<string, PartnerProduct[]>>((acc, p) => {
    if (!acc[p.serviceId]) acc[p.serviceId] = []
    acc[p.serviceId]!.push(p)
    return acc
  }, {})

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
        <h1 className="text-xl font-semibold text-gray-900">{t('services.title')}</h1>
        <Button onClick={openCreate}>{t('services.new')}</Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</div>
      ) : (
        <div className="space-y-8">
          {(data?.data ?? []).map((service) => {
            const products = productsByService[service.id] ?? []
            const byPartner = products.reduce<Record<string, { name: string; products: PartnerProduct[] }>>((acc, p) => {
              if (!acc[p.partnerId]) acc[p.partnerId] = { name: p.partnerName, products: [] }
              acc[p.partnerId]!.products.push(p)
              return acc
            }, {})

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

                {/* 主体：产品 + 服务资料 */}
                <div className="bg-gray-50 grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                  {/* 产品列表（占 2/3） */}
                  <div className="lg:col-span-2 p-4">
                    <p className="text-sm font-medium text-gray-600 mb-3">
                      {t('services.form.available')}
                      {products.length > 0 && <span className="ml-1.5 text-xs text-gray-400 font-normal">{t('partners.detail.productCount', { count: products.length, partners: Object.keys(byPartner).length })}</span>}
                    </p>
                    {products.length === 0 ? (
                      <p className="text-xs text-gray-400 py-4 text-center">
                        {t('services.form.noProducts', { link: t('services.form.partnersLink') })}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {Object.values(byPartner).map((group) => (
                          <div key={group.name}>
                            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                              {group.name}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {group.products.map((p) => (
                                <div key={p.id} className="rounded-lg border bg-white overflow-hidden">
                                  <div className="px-3 pt-3 pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-medium text-sm text-gray-900 leading-snug">{p.name}</span>
                                      {p.price != null && (
                                        <span className="text-sm font-semibold text-primary-600 flex-shrink-0">
                                          {p.currency} {p.price.toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                    {p.description && (
                                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>
                                    )}
                                  </div>
                                  <div className="border-t bg-gray-50 px-3 py-2">
                                    <FileManager entityType="product" entityId={p.id} readonly />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 服务资料（占 1/3） */}
                  <div className="p-4">
                    <p className="text-sm font-medium text-gray-600 mb-3">{t('services.form.docs')}</p>
                    <FileManager entityType="service" entityId={service.id} />
                  </div>
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
