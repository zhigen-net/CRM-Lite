// 在后台触发工作流（不阻塞响应），失败只记录日志
import { executeWorkflowsForTrigger } from '../crm/workflow/executor'
import type { Deps } from './actor'

type EntityType = Parameters<typeof executeWorkflowsForTrigger>[2]
type WorkflowEvent = Parameters<typeof executeWorkflowsForTrigger>[4]

export function fireWorkflow(deps: Deps, entityType: EntityType, entityId: string, event: WorkflowEvent): void {
  const label = event.type === 'field_change' ? `field_change ${event.field}` : event.type
  deps.waitUntil(
    executeWorkflowsForTrigger(deps.db, deps.env, entityType, entityId, event)
      .catch((err) => console.error(`[workflow] ${label} ${entityType} ${entityId} error:`, err)),
  )
}
