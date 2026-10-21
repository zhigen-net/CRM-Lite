import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Select } from '@/shared/components/Select'
import { Modal } from '@/shared/components/Modal'
import { Badge } from '@/shared/components/Badge'
import type { User, Team, UserRole, Service } from '@/shared/types'

const roleBadge: Record<UserRole, 'red' | 'blue' | 'green'> = {
  admin: 'red', operations: 'blue', sales: 'green',
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['admin', 'operations', 'sales']),
  teamId: z.string().optional(),
})

const editSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['admin', 'operations', 'sales']),
  teamId: z.string().optional(),
  specialization: z.array(z.string()),
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(1),
}).refine((d) => d.newPassword === d.confirmPassword, {
  path: ['confirmPassword'],
})

type RegisterForm = z.infer<typeof registerSchema>
type EditForm = z.infer<typeof editSchema>
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>

function parseSpecialization(val: unknown): string[] {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { /* ignore */ }
  }
  return []
}

import { Pagination } from '@/shared/components/Pagination'

const PAGE_SIZE = 20

export default function UsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showRegister, setShowRegister] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  const searchTimeout = useState<ReturnType<typeof setTimeout> | null>(null)
  const handleSearch = (val: string) => {
    setSearch(val)
    if (searchTimeout[0]) clearTimeout(searchTimeout[0])
    searchTimeout[1](setTimeout(() => { setDebouncedSearch(val); setPage(1) }, 300))
  }

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', debouncedSearch, page],
    queryFn: () => crmApi.get<{ data: User[]; total: number; page: number; pageSize: number }>('/users', {
      params: { search: debouncedSearch || undefined, page, pageSize: PAGE_SIZE },
    }).then((r) => r.data),
  })

  const users = usersData?.data ?? []
  const total = usersData?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const { data: teams } = useQuery({
    // 与系统设置、工作流共用缓存 ['teams']，都存团队数组
    queryKey: ['teams'],
    queryFn: () => crmApi.get<{ data: Team[] }>('/teams').then((r) => r.data.data),
  })

  const { data: servicesResp } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data),
  })
  const serviceNames = (servicesResp?.data ?? []).map((s) => s.name)

  const roleLabel: Record<UserRole, string> = {
    admin: t('users.roles.admin'), operations: t('users.roles.operator'), sales: t('users.roles.sales'),
  }

  const teamOptions = [
    { value: '', label: t('common.none') },
    ...((teams ?? []).map((tm) => ({ value: tm.id, label: tm.name }))),
  ]

  const registerForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })
  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) })
  const resetPasswordForm = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema) })

  const openEdit = (u: User) => {
    editForm.reset({
      name: u.name,
      phone: u.phone ?? '',
      role: u.role,
      teamId: u.teamId ?? '',
      specialization: parseSpecialization(u.specialization),
    })
    setEditTarget(u)
  }

  const openResetPassword = (u: User) => {
    resetPasswordForm.reset()
    setResetTarget(u)
  }

  const registerMutation = useMutation({
    mutationFn: (body: RegisterForm) =>
      crmApi.post('/auth/register', { ...body, teamId: body.teamId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowRegister(false)
      registerForm.reset()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('common.saveFailed')
      registerForm.setError('email', { message: msg })
    },
  })

  const editMutation = useMutation({
    mutationFn: (body: EditForm) =>
      crmApi.put(`/users/${editTarget!.id}`, { ...body, teamId: body.teamId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditTarget(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('common.saveFailed')
      editForm.setError('name', { message: msg })
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ newPassword }: ResetPasswordForm) =>
      crmApi.put(`/users/${resetTarget!.id}/password`, { newPassword }),
    onSuccess: () => {
      setResetTarget(null)
      resetPasswordForm.reset()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('common.saveFailed')
      resetPasswordForm.setError('newPassword', { message: msg })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (user: User) =>
      crmApi.put(`/users/${user.id}`, { isActive: !user.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('users.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{t('common.total')} {total} {t('users.count')}</p>
        </div>
        <Button onClick={() => setShowRegister(true)}>{t('users.new')}</Button>
      </div>

      <div className="mb-4">
        <Input placeholder={t('users.search')} value={search} onChange={(e) => handleSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</div>
      ) : (
        <>
          {/* 移动端：卡片列表 */}
          <div className="space-y-3 sm:hidden">
            {users.map((user) => (
              <div key={user.id} className={`rounded-lg border bg-white p-4 ${!user.isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {user.name}
                      {!user.isActive && <span className="ml-2 text-xs text-red-500 font-normal">{t('common.disabled')}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{user.email}</p>
                    {user.phone && <p className="text-xs text-gray-400 mt-0.5">{user.phone}</p>}
                  </div>
                  <Badge variant={roleBadge[user.role]}>{roleLabel[user.role]}</Badge>
                </div>

                <div className="flex items-center gap-3 mb-1 text-xs text-gray-500">
                  <span>{t('nav.leads')} <span className="font-medium text-gray-700">{user.currentLeadsCount}</span></span>
                  <span>{t('nav.clients')} <span className="font-medium text-gray-700">{user.currentClientsCount ?? 0}</span></span>
                </div>
                <div className="mb-2 text-xs text-gray-400">
                  {t('users.cols.team')}：{user.teamName ?? <span className="text-gray-300">—</span>}
                </div>

                {(() => {
                  const specs = parseSpecialization(user.specialization)
                  return specs.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {specs.map((s) => (
                        <Badge key={s} variant="blue">{s}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-3">{t('users.cols.skillsEmpty')}</p>
                  )
                })()}

                <div className="flex gap-2 border-t pt-3">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>{t('common.edit')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => openResetPassword(user)}>{t('users.resetPwdBtn')}</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={user.isActive ? 'text-red-500' : 'text-green-600'}
                    onClick={() => {
                      if (confirm(t(user.isActive ? 'users.disableConfirm' : 'users.enableConfirm', { name: user.name }))) toggleActiveMutation.mutate(user)
                    }}
                  >
                    {user.isActive ? t('common.disable') : t('common.enable')}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden sm:block rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.form.name')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.form.email')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.form.phone')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.form.role')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.form.team')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('users.cols.skills')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('nav.leads')} / {t('nav.clients')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.id} className={`hover:bg-gray-50 ${!user.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {user.name}
                      {!user.isActive && <span className="ml-2 text-xs text-red-500 font-normal">{t('common.disabled')}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{user.email}</td>
                    <td className="px-4 py-3 text-gray-500">{user.phone ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <Badge variant={roleBadge[user.role]}>{roleLabel[user.role]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {user.teamName ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const specs = parseSpecialization(user.specialization)
                        return specs.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {specs.map((s) => (
                              <Badge key={s} variant="blue">{s}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">{t('users.cols.skillsEmpty')}</span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <span>{t('nav.leads')} <span className="font-medium text-gray-800">{user.currentLeadsCount}</span></span>
                      <span className="mx-1.5 text-gray-300">/</span>
                      <span>{t('nav.clients')} <span className="font-medium text-gray-800">{user.currentClientsCount ?? 0}</span></span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                          {t('common.edit')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openResetPassword(user)}>
                          {t('users.resetPwdBtn')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={user.isActive ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-800'}
                          onClick={() => {
                            if (confirm(t(user.isActive ? 'users.disableConfirm' : 'users.enableConfirm', { name: user.name }))) toggleActiveMutation.mutate(user)
                          }}
                        >
                          {user.isActive ? t('common.disable') : t('common.enable')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}

      {/* 新建用户 */}
      {showRegister && (
        <Modal
          title={t('users.new')}
          onClose={() => setShowRegister(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowRegister(false)}>{t('common.cancel')}</Button>
              <Button
                loading={registerMutation.isPending}
                onClick={registerForm.handleSubmit((d) => registerMutation.mutate(d))}
              >
                {t('common.create')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('users.form.name')} error={registerForm.formState.errors.name?.message} {...registerForm.register('name')} />
            <Input label={t('users.form.phone')} placeholder={t('users.form.optional')} {...registerForm.register('phone')} />
            <Input label={t('users.form.email')} type="email" error={registerForm.formState.errors.email?.message} {...registerForm.register('email')} />
            <Input label={t('users.form.initPassword')} type="password" error={registerForm.formState.errors.password?.message} {...registerForm.register('password')} />
            <Select
              label={t('users.form.role')}
              options={[
                { value: 'admin', label: t('users.roles.admin') },
                { value: 'operations', label: t('users.roles.operator') },
                { value: 'sales', label: t('users.roles.sales') },
              ]}
              {...registerForm.register('role')}
            />
            <Select label={t('users.form.team')} options={teamOptions} {...registerForm.register('teamId')} />
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal
          title={t('users.form.editTitle', { name: editTarget.name })}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button
                loading={editMutation.isPending}
                onClick={editForm.handleSubmit((d) => editMutation.mutate(d))}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('users.form.name')} error={editForm.formState.errors.name?.message} {...editForm.register('name')} />
            <Input label={t('users.form.phone')} placeholder={t('users.form.optional')} {...editForm.register('phone')} />
            <Select
              label={t('users.form.role')}
              options={[
                { value: 'admin', label: t('users.roles.admin') },
                { value: 'operations', label: t('users.roles.operator') },
                { value: 'sales', label: t('users.roles.sales') },
              ]}
              {...editForm.register('role')}
            />
            <Select label={t('users.form.team')} options={teamOptions} {...editForm.register('teamId')} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-700">
                {t('users.form.skills')}
                <span className="ml-1 text-xs font-normal text-gray-400">（{t('users.form.skillsHint')}）</span>
              </p>
              {serviceNames.length === 0 ? (
                <p className="text-xs text-gray-400">{t('users.form.skillsEmpty', { link: t('users.form.skillsLink') })}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {serviceNames.map((name) => {
                    const cur = editForm.watch('specialization')
                    const selected = Array.isArray(cur) && cur.includes(name)
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          const cur = editForm.getValues('specialization')
                          const curArr = Array.isArray(cur) ? cur : []
                          editForm.setValue(
                            'specialization',
                            selected ? curArr.filter((s) => s !== name) : [...curArr, name],
                          )
                        }}
                        className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
                          selected
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                        }`}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 重置密码 */}
      {resetTarget && (
        <Modal
          title={t('users.form.resetTitle', { name: resetTarget.name })}
          onClose={() => setResetTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetTarget(null)}>{t('common.cancel')}</Button>
              <Button
                loading={resetPasswordMutation.isPending}
                onClick={resetPasswordForm.handleSubmit((d) => resetPasswordMutation.mutate(d))}
              >
                {t('users.form.confirmReset')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t('users.form.resetHint', { name: resetTarget.name })}</p>
            <Input
              label={t('users.form.newPassword')}
              type="password"
              autoComplete="new-password"
              error={resetPasswordForm.formState.errors.newPassword?.message}
              {...resetPasswordForm.register('newPassword')}
            />
            <Input
              label={t('users.form.confirmPassword')}
              type="password"
              autoComplete="new-password"
              error={resetPasswordForm.formState.errors.confirmPassword?.message}
              {...resetPasswordForm.register('confirmPassword')}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
