import { useQuery } from '@tanstack/react-query'
import { crmApi } from '@/shared/utils/request'

export type WorkflowTrigger =
  | { type: 'field_change'; field: string; to: string }
  | { type: 'on_create' }

export type WorkflowAction =
  | { type: 'require_activity'; contentRequired: boolean; contentPresets?: string[] }
  | { type: 'require_fields';   fields: Array<{ field: string; label: string; type: string; optionGroup?: string }> }
  | { type: 'set_field';        field: string; label: string; value: string }
  | { type: 'send_email';       to: string; subject: string; body: string }
  | { type: 'webhook';          url: string; method: string; body: string }

export interface Workflow {
  id: string
  name: string
  entityType: string
  trigger: WorkflowTrigger
  conditions: unknown[]
  actions: WorkflowAction[]
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface ActivityConfig {
  requireActivity: boolean
  contentRequired: boolean
  contentPresets: string[]
  requiredFields: Array<{
    field: string
    label: string
    type: 'select' | 'datetime' | 'services' | 'text' | 'user'
    optionGroup?: string
  }>
}

export function useWorkflows(entityType: string) {
  const { data, ...rest } = useQuery<Workflow[]>({
    queryKey: ['workflows', entityType],
    queryFn: () =>
      crmApi
        .get<{ data: Workflow[] }>('/workflows', { params: { entityType } })
        .then((r) => r.data.data),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })

  // 根据触发字段+值，聚合该触发点下所有工作流的动作为 ActivityConfig
  const getActivityConfig = (field: string, value: string): ActivityConfig | null => {
    if (!data) return null
    const matched = data.filter(
      (w) => w.trigger.type === 'field_change'
        && (w.trigger as { field: string; to: string }).field === field
        && (w.trigger as { field: string; to: string }).to === value,
    )
    if (!matched.length) return null

    const config: ActivityConfig = {
      requireActivity: false,
      contentRequired: false,
      contentPresets: [],
      requiredFields: [],
    }
    for (const wf of matched) {
      for (const action of wf.actions) {
        if (action.type === 'require_activity') {
          config.requireActivity = true
          if (action.contentRequired) config.contentRequired = true
          if (action.contentPresets?.length) config.contentPresets.push(...action.contentPresets)
        } else if (action.type === 'require_fields') {
          config.requiredFields.push(...(action.fields as ActivityConfig['requiredFields']))
        }
      }
    }
    return config.requireActivity || config.requiredFields.length ? config : null
  }

  return { workflows: data ?? [], getActivityConfig, ...rest }
}
