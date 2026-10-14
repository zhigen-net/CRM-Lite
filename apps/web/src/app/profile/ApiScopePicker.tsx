import { useTranslation } from 'react-i18next'

// 与服务端 domain/capabilities/types.ts 的 SCOPES 保持一致
export const API_SCOPES = [
  'leads:read', 'leads:create', 'leads:write',
  'clients:read', 'clients:write',
  'activities:read', 'activities:write',
  'meta:read',
] as const
export type ApiScope = typeof API_SCOPES[number]

export const SCOPE_PRESETS = {
  push: ['leads:create'],
  readonly: ['leads:read', 'clients:read', 'activities:read', 'meta:read'],
  readwrite: [...API_SCOPES],
} as const satisfies Record<string, readonly ApiScope[]>
export type ScopePreset = keyof typeof SCOPE_PRESETS | 'custom'

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s) => b.includes(s))

/** 按 scopes 识别对应的预设，识别不了时为 custom */
export function presetOf(scopes: readonly string[]): ScopePreset {
  for (const [k, v] of Object.entries(SCOPE_PRESETS)) if (sameSet(scopes, v)) return k as ScopePreset
  return 'custom'
}

interface Props {
  value: ApiScope[]
  onChange: (scopes: ApiScope[]) => void
}

/** 创建 API Key 时选择权限：常用预设 + 自定义 */
export function ApiScopePicker({ value, onChange }: Props) {
  const { t } = useTranslation()
  const preset = presetOf(value)
  const presets: ScopePreset[] = ['push', 'readonly', 'readwrite', 'custom']

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">{t('profile.api.scopes.label')}</p>
      <div className="space-y-1.5">
        {presets.map((p) => (
          <label key={p} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              checked={preset === p}
              onChange={() => onChange(p === 'custom' ? [...value] : [...SCOPE_PRESETS[p]])}
            />
            <span>
              <span className="text-sm text-gray-800">{t(`profile.api.scopes.presets.${p}`)}</span>
              <span className="block text-xs text-gray-400">{t(`profile.api.scopes.presetDesc.${p}`)}</span>
            </span>
          </label>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-1.5 rounded border bg-gray-50 p-2">
          {API_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={value.includes(s)}
                onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))}
              />
              {t(`profile.api.scopes.names.${s.replace(':', '_')}`)}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400">{t('profile.api.scopes.hint')}</p>
    </div>
  )
}

/** 列表里展示密钥权限：预设名或自定义的权限列表 */
export function ScopeSummary({ scopes }: { scopes: readonly string[] }) {
  const { t } = useTranslation()
  const preset = presetOf(scopes)
  if (preset !== 'custom') return <span className="text-xs text-gray-600">{t(`profile.api.scopes.presets.${preset}`)}</span>
  return <span className="text-xs text-gray-600">{scopes.map((s) => t(`profile.api.scopes.names.${s.replace(':', '_')}`)).join('、')}</span>
}
