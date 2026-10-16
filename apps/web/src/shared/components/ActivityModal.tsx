import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Modal } from './Modal'
import { Button } from './Button'
import { Select } from './Select'
import { Textarea } from './Textarea'
import { Input } from './Input'
import { useOptionGroup, useOptions, toSelectOptions, parseActivityMeta } from '@/shared/hooks/useOptions'
import type { ActivityMetaField } from '@/shared/hooks/useOptions'
import { nowForInput } from '@/shared/utils/format'
import type { ActivityAttachment } from '@/shared/types'
import type { ActivityConfig } from '@/shared/hooks/useWorkflows'

const schema = z.object({
  activityType: z.string().min(1),
  description: z.string().optional(),
  activityDate: z.string().min(1),
  nextContactDate: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export interface ActivitySubmitData {
  activityType: string
  description?: string | undefined
  activityDate: string
  nextContactDate?: string | undefined
  extraData?: Record<string, unknown> | undefined
  attachmentKeys: ActivityAttachment[]
  policyFields?: Record<string, unknown> | undefined
}

interface ActivityModalProps {
  title: string
  onClose: () => void
  onSubmit: (data: ActivitySubmitData) => void
  loading: boolean
  activityConfig?: ActivityConfig | null
  initialPolicyValues?: Record<string, unknown>
  serverError?: string | undefined
  showNextContact?: boolean
  entityType?: 'lead' | 'client'
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ActivityModal({
  title, onClose, onSubmit, loading, activityConfig, initialPolicyValues, serverError, showNextContact, entityType,
}: ActivityModalProps) {
  const { t } = useTranslation()
  const { options: allActivityTypeOpts } = useOptionGroup('activity_type')
  const activityTypeOpts = allActivityTypeOpts.filter((o) => {
    if (o.value === 'System') return false
    if (!entityType) return true
    const meta = parseActivityMeta(o)
    if (!meta.scope || meta.scope.length === 0) return true
    return meta.scope.includes(entityType)
  })
  const { data: allOptions } = useOptions()

  const hasServicesField = activityConfig?.requiredFields?.some((f) => f.type === 'services') ?? false
  const { data: servicesData } = useQuery({
    queryKey: ['services'],
    queryFn: () =>
      crmApi.get<{ data: { id: string; name: string }[] }>('/services').then((r) => r.data),
    enabled: hasServicesField,
    staleTime: 1000 * 60 * 5,
  })
  const services = servicesData?.data ?? []

  const [policyFields, setPolicyFields] = useState<Record<string, unknown>>(initialPolicyValues ?? {})
  const [extraData, setExtraData] = useState<Record<string, unknown>>({})
  const [policyError, setPolicyError] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const daysFromNow = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA')
  }

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      activityType: activityTypeOpts[0]?.value ?? '',
      activityDate: nowForInput(),
      nextContactDate: showNextContact ? daysFromNow(3) : undefined,
    },
  })

  const description = watch('description')
  const selectedTypeMeta = parseActivityMeta(activityTypeOpts.find((o) => o.value === watch('activityType')) ?? {} as Parameters<typeof parseActivityMeta>[0])
  const extraFields: ActivityMetaField[] = selectedTypeMeta.fields ?? []
  const hasProductSelect = extraFields.some((f) => f.type === 'product_select')

  // 「产品选择」字段：从「产品与服务」中选择
  const { data: productsData } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: { id: string; name: string; price: number | null }[] }>('/services').then((r) => r.data),
    enabled: hasProductSelect,
    staleTime: 1000 * 60 * 5,
  })
  const allProducts = productsData?.data ?? []

  const setExtraField = (key: string, value: unknown) =>
    setExtraData((prev) => ({ ...prev, [key]: value }))

  const setPolicyField = (field: string, value: unknown) => {
    setPolicyFields((prev) => ({ ...prev, [field]: value }))
    setPolicyError('')
  }

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    setFiles((prev) => [...prev, ...Array.from(incoming)])
    setUploadError('')
  }

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = handleSubmit(async (formData) => {
    // 校验策略必填字段
    if (activityConfig?.contentRequired && !formData.description?.trim()) {
      setPolicyError(t('activityModal.content'))
      return
    }
    for (const rf of activityConfig?.requiredFields ?? []) {
      const val = policyFields[rf.field]
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
        setPolicyError(rf.label)
        return
      }
    }

    setUploadError('')
    let attachmentKeys: ActivityAttachment[] = []
    if (files.length > 0) {
      setUploading(true)
      try {
        const results = await Promise.all(
          files.map(async (file) => {
            const fd = new FormData()
            fd.append('file', file)
            const res = await crmApi.post<{ data: ActivityAttachment }>('/upload/internal', fd)
            return res.data.data
          }),
        )
        attachmentKeys = results
      } catch {
        setUploadError(t('common.uploadFailed'))
        setUploading(false)
        return
      }
      setUploading(false)
    }

    onSubmit({
      ...formData,
      attachmentKeys,
      extraData: Object.keys(extraData).length > 0 ? extraData : undefined,
      policyFields: Object.keys(policyFields).length > 0 ? policyFields : undefined,
    })
  })

  const busy = uploading || loading

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button loading={busy} onClick={handleSave}>
            {uploading ? t('common.uploading') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* 跟进类型和时间置顶，统一 h-8 高度 */}
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-gray-500 mb-1">{t('activityModal.type')}</label>
            <select
              className="w-full h-8 rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('activityType', { onChange: () => setExtraData({}) })}
            >
              {toSelectOptions(activityTypeOpts).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-none">
            <label className="block text-xs text-gray-500 mb-1">{t('activityModal.time')}</label>
            <input
              type="datetime-local"
              className="h-8 rounded-md border border-gray-300 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
              {...register('activityDate')}
            />
            {errors.activityDate?.message && (
              <p className="mt-0.5 text-xs text-red-600">{errors.activityDate.message}</p>
            )}
          </div>
        </div>

        {/* 快选预设 */}
        {(activityConfig?.contentPresets?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-gray-500">{t('activityModal.quickSelect')}</p>
            <div className="flex flex-wrap gap-1.5">
              {activityConfig!.contentPresets!.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setValue('description', preset)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    description === preset
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        <Textarea
          label={activityConfig?.contentRequired ? t('activityModal.content') : t('activityModal.type')}
          {...register('description')}
        />

        {/* 当前跟进类型的自定义字段 */}
        {extraFields.length > 0 && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-700">{t('activityModal.extra')}</p>
            {extraFields.map((f) => {
              if (f.type === 'product_select') {
                return (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                    <select
                      className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                      value={(extraData[f.key] as string) ?? ''}
                      onChange={(e) => {
                        const productId = e.target.value
                        const product = allProducts.find((p) => p.id === productId)
                        setExtraField(f.key, productId)
                        if (product) {
                          setExtraField(`${f.key}_name`, product.name)
                          // 自动填充同类型中名为 price 的 number 字段
                          const priceField = extraFields.find((ef) => ef.type === 'number' && ef.key === 'price')
                          if (priceField && product.price != null) {
                            setExtraField('price', product.price)
                          }
                        }
                      }}
                    >
                      <option value="">{t('activityModal.productPlaceholder')}</option>
                      {allProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.price != null ? ` (${p.price.toLocaleString()})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              }
              if (f.type === 'date') {
                return (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                    <input
                      type="date"
                      className="h-8 w-full rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                      value={(extraData[f.key] as string) ?? ''}
                      onChange={(e) => setExtraField(f.key, e.target.value)}
                    />
                  </div>
                )
              }
              if (f.type === 'select') {
                return (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                    <select
                      className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                      value={(extraData[f.key] as string) ?? ''}
                      onChange={(e) => setExtraField(f.key, e.target.value)}
                    >
                      <option value="">{t('activityModal.selectPlaceholder')}</option>
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                )
              }
              return (
                <div key={f.key}>
                  <label className="block text-xs text-gray-600 mb-1">{f.label}{f.unit ? `（${f.unit}）` : ''}</label>
                  <input
                    type={f.type === 'number' ? 'number' : 'text'}
                    className="h-8 w-full rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={(extraData[f.key] as string) ?? ''}
                    onChange={(e) => setExtraField(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                  />
                </div>
              )
            })}
          </div>
        )}

        {showNextContact && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('activityModal.nextContact')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="h-8 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                {...register('nextContactDate')}
              />
              {[{ label: t('activityModal.in3days'), days: 3 }, { label: t('activityModal.in1week'), days: 7 }, { label: t('activityModal.in1month'), days: 30 }].map(({ label, days }) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() + days)
                    setValue('nextContactDate', d.toLocaleDateString('en-CA'))
                  }}
                  className="h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-600 hover:border-primary-400 hover:text-primary-600 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 策略要求的额外字段 */}
        {(activityConfig?.requiredFields?.length ?? 0) > 0 && (
          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('activityModal.required')}</p>
            {activityConfig!.requiredFields!.map((rf) => {
              if (rf.type === 'select' && rf.optionGroup) {
                const opts = allOptions?.[rf.optionGroup] ?? []
                return (
                  <div key={rf.field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{rf.label}</label>
                    <select
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={(policyFields[rf.field] as string) ?? ''}
                      onChange={(e) => setPolicyField(rf.field, e.target.value)}
                    >
                      <option value="">{t('activityModal.selectPlaceholder')}</option>
                      {toSelectOptions(opts).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )
              }
              if (rf.type === 'datetime') {
                return (
                  <div key={rf.field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{rf.label}</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        className="h-8 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        value={(policyFields[rf.field] as string) ?? ''}
                        onChange={(e) => setPolicyField(rf.field, e.target.value)}
                      />
                      {[{ label: t('activityModal.in3days'), days: 3 }, { label: t('activityModal.in1week'), days: 7 }, { label: t('activityModal.in1month'), days: 30 }].map(({ label, days }) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setPolicyField(rf.field, daysFromNow(days))}
                          className="h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-600 hover:border-primary-400 hover:text-primary-600 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              }
              if (rf.type === 'services') {
                const selected = (policyFields[rf.field] as string[]) ?? []
                return (
                  <div key={rf.field}>
                    <p className="text-sm font-medium text-gray-700 mb-1.5">{rf.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {services.map((svc) => (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => {
                            const next = selected.includes(svc.name)
                              ? selected.filter((s) => s !== svc.name)
                              : [...selected, svc.name]
                            setPolicyField(rf.field, next)
                          }}
                          className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
                            selected.includes(svc.name)
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                          }`}
                        >
                          {svc.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              }
              return null
            })}
          </div>
        )}

        {(policyError || serverError) && (
          <p className="text-sm text-red-500">{policyError || serverError}</p>
        )}

        {/* 文件上传 */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-700">{t('activityModal.attachments')}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 hover:border-primary-400 hover:text-primary-600 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {t('activityModal.selectFile')}
          </button>

          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm">
                  <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="flex-1 truncate text-gray-700">{f.name}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="flex-shrink-0 text-gray-400 hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
        </div>
      </div>
    </Modal>
  )
}
