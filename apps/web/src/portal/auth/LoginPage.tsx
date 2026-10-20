import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { usePortalAuth } from './PortalAuthContext'
import { crmApi } from '@/shared/utils/request'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})
const magicLinkSchema = z.object({
  email: z.string().email(),
})
type PasswordForm = z.infer<typeof passwordSchema>
type MagicLinkForm = z.infer<typeof magicLinkSchema>

export default function PortalLoginPage() {
  const { t } = useTranslation()
  const { login, sendMagicLink, verifyMagicLink } = usePortalAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'password' | 'magiclink'>('password')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [serverError, setServerError] = useState('')

  const { data: publicSettings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => crmApi.get<{ data: { systemName: string | null; portalEnabled: boolean } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  const systemName = publicSettings?.systemName || t('portal.auth.title')
  useEffect(() => { document.title = systemName }, [systemName])

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      verifyMagicLink(token)
        .then(() => navigate('/portal/profile', { replace: true }))
        .catch(() => setServerError(t('portal.auth.linkExpired')))
    }
  }, [searchParams, verifyMagicLink, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })
  const magicLinkForm = useForm<MagicLinkForm>({ resolver: zodResolver(magicLinkSchema) })

  const onPasswordSubmit = async (data: PasswordForm) => {
    setServerError('')
    try {
      await login(data.email, data.password)
      navigate('/portal/profile', { replace: true })
    } catch {
      setServerError(t('portal.auth.loginFailed'))
    }
  }

  const onMagicLinkSubmit = async (data: MagicLinkForm) => {
    setServerError('')
    try {
      await sendMagicLink(data.email)
      setMagicLinkSent(true)
    } catch {
      setServerError(t('portal.auth.sendFailed'))
    }
  }

  // 客户门户未开启：不显示登录表单
  if (publicSettings && !publicSettings.portalEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-md">
          <h1 className="text-xl font-bold text-gray-900">{systemName}</h1>
          <p className="mt-3 text-sm text-gray-500">{t('portal.auth.disabled')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{systemName}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('portal.auth.subtitle')}</p>
        </div>

        <div className="mb-6 flex rounded-lg border p-1">
          <button
            onClick={() => setMode('password')}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === 'password' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('portal.auth.passwordTab')}
          </button>
          <button
            onClick={() => setMode('magiclink')}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === 'magiclink' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('portal.auth.magicTab')}
          </button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
            <Input
              id="email"
              label={t('portal.auth.email')}
              type="email"
              autoComplete="username"
              placeholder="your@email.com"
              error={passwordForm.formState.errors.email?.message}
              {...passwordForm.register('email')}
            />
            <Input
              id="password"
              label={t('portal.auth.password')}
              type="password"
              autoComplete="current-password"
              placeholder={t('portal.auth.enterPassword')}
              error={passwordForm.formState.errors.password?.message}
              {...passwordForm.register('password')}
            />
            {serverError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={passwordForm.formState.isSubmitting}
            >
              {t('portal.auth.login')}
            </Button>
          </form>
        ) : magicLinkSent ? (
          <div className="rounded-lg bg-green-50 p-4 text-center text-sm text-green-700">
            <p className="font-medium">{t('portal.auth.linkSent')}</p>
            <p className="mt-1">{t('portal.auth.linkSentHint')}</p>
            <button
              onClick={() => setMagicLinkSent(false)}
              className="mt-3 text-green-600 underline"
            >
              {t('portal.auth.resend')}
            </button>
          </div>
        ) : (
          <form onSubmit={magicLinkForm.handleSubmit(onMagicLinkSubmit)} className="space-y-4">
            <Input
              id="ml-email"
              label={t('portal.auth.email')}
              type="email"
              placeholder="your@email.com"
              error={magicLinkForm.formState.errors.email?.message}
              {...magicLinkForm.register('email')}
            />
            {serverError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={magicLinkForm.formState.isSubmitting}
            >
              {t('portal.auth.sendLink')}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
