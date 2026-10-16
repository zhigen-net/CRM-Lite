import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useCrmAuth } from './CrmAuthContext'
import { crmApi } from '@/shared/utils/request'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { useState, useEffect } from 'react'

export default function CrmLoginPage() {
  const { t } = useTranslation()
  const { login } = useCrmAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const { data: publicSettings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => crmApi.get<{ data: { systemName: string | null } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  const systemName = publicSettings?.systemName || t('common.brand')
  useEffect(() => { document.title = systemName }, [systemName])

  const { data: setupData, isLoading: setupLoading } = useQuery({
    queryKey: ['setup-required'],
    queryFn: () => crmApi.get<{ data: { required: boolean } }>('/public/setup-required').then((r) => r.data.data),
    staleTime: 0,
  })
  const setupRequired = setupData?.required ?? false

  // ── 登录表单 ────────────────────────────────────────────────────
  const loginSchema = z.object({
    email: z.string().email(t('auth.invalidEmail')),
    password: z.string().min(6, t('auth.passwordMin')),
  })
  type LoginData = z.infer<typeof loginSchema>

  const loginForm = useForm<LoginData>({ resolver: zodResolver(loginSchema) })

  const onLogin = async (data: LoginData) => {
    setServerError('')
    try {
      await login(data.email, data.password)
      navigate('/app/leads', { replace: true })
    } catch {
      setServerError(t('auth.loginFailed'))
    }
  }

  // ── 首次设置表单 ────────────────────────────────────────────────
  const setupSchema = z.object({
    name: z.string().min(1, t('auth.nameRequired')),
    email: z.string().email(t('auth.invalidEmail')),
    password: z.string().min(8, t('auth.passwordMin8')),
    confirmPassword: z.string(),
    // 行业模板：blank = 通用，fertility = 辅助生殖（预置服务项目、合作伙伴类型与业务背景）
    template: z.enum(['blank', 'fertility']),
  }).refine((d) => d.password === d.confirmPassword, {
    message: t('auth.passwordMismatch'),
    path: ['confirmPassword'],
  })
  type SetupData = z.infer<typeof setupSchema>

  const setupForm = useForm<SetupData>({ resolver: zodResolver(setupSchema), defaultValues: { template: 'blank' } })

  const setupMutation = useMutation({
    mutationFn: (data: SetupData) =>
      crmApi.post('/public/setup', { name: data.name, email: data.email, password: data.password, template: data.template }),
    onSuccess: async (_, data) => {
      try {
        await login(data.email, data.password)
        navigate('/app/leads', { replace: true })
      } catch {
        setServerError(t('auth.loginFailed'))
      }
    },
    onError: () => setServerError(t('auth.setupFailed')),
  })

  if (setupLoading) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{systemName}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {setupRequired ? t('auth.setupTitle') : t('auth.title')}
          </p>
        </div>

        {setupRequired ? (
          // ── 首次设置 ──────────────────────────────────────────
          <form onSubmit={setupForm.handleSubmit((d) => { setServerError(''); setupMutation.mutate(d) })} className="space-y-4">
            <Input
              id="setup-name"
              label={t('auth.name')}
              placeholder={t('auth.namePlaceholder')}
              error={setupForm.formState.errors.name?.message}
              {...setupForm.register('name')}
            />
            <Input
              id="setup-email"
              label={t('auth.email')}
              type="email"
              autoComplete="username"
              placeholder="admin@company.com"
              error={setupForm.formState.errors.email?.message}
              {...setupForm.register('email')}
            />
            <Input
              id="setup-password"
              label={t('auth.password')}
              type="password"
              autoComplete="new-password"
              placeholder={t('auth.passwordMin8')}
              error={setupForm.formState.errors.password?.message}
              {...setupForm.register('password')}
            />
            <Input
              id="setup-confirm"
              label={t('auth.confirmPassword')}
              type="password"
              autoComplete="new-password"
              placeholder={t('auth.confirmPasswordPlaceholder')}
              error={setupForm.formState.errors.confirmPassword?.message}
              {...setupForm.register('confirmPassword')}
            />

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-gray-700">{t('auth.templateLabel')}</legend>
              <div className="space-y-1.5">
                {(['blank', 'fertility'] as const).map((tpl) => (
                  <label key={tpl} className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
                    <input type="radio" value={tpl} className="mt-1" {...setupForm.register('template')} />
                    <span>
                      <span className="block text-sm text-gray-800">{t(`auth.templates.${tpl}.name`)}</span>
                      <span className="block text-xs text-gray-400">{t(`auth.templates.${tpl}.desc`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-400">{t('auth.templateHint')}</p>
            </fieldset>

            {serverError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={setupMutation.isPending}>
              {t('auth.setupSubmit')}
            </Button>
          </form>
        ) : (
          // ── 正常登录 ──────────────────────────────────────────
          <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
            <Input
              id="email"
              label={t('auth.email')}
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              error={loginForm.formState.errors.email?.message}
              {...loginForm.register('email')}
            />
            <Input
              id="password"
              label={t('auth.password')}
              type="password"
              autoComplete="current-password"
              placeholder={t('auth.enterPassword')}
              error={loginForm.formState.errors.password?.message}
              {...loginForm.register('password')}
            />

            {serverError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loginForm.formState.isSubmitting}>
              {t('auth.login')}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
