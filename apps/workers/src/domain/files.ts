// 文件下载权限：按文件所属的业务对象判断（跟进记录附件跟随线索/客户的可见范围）
import type { Actor } from './actor'
import { notFound } from './errors'
import { activityVisibility } from './activities/policy'

/**
 * 检查操作者能否下载 R2 中的某个文件。
 * - 产品库/服务/合作伙伴资料（entity_attachments）：内部员工都可下载
 * - 跟进记录附件：与跟进记录的可见范围一致（销售只能下载自己负责的线索/客户下的附件）
 * - 其它文件（客户门户资料、尚未关联的上传）：仅管理员和运营
 * 无权限时按"文件不存在"处理，不暴露文件是否存在
 */
export async function assertCanDownloadFile(db: D1Database, actor: Actor, key: string): Promise<void> {
  if (actor.role !== 'sales') return

  const shared = await db.prepare('SELECT 1 FROM entity_attachments WHERE file_key = ? LIMIT 1').bind(key).first()
  if (shared) return

  const scope = activityVisibility(actor)
  const visible = await db.prepare(
    `SELECT 1 FROM activity_attachments aa
     JOIN sales_activities sa ON aa.activity_id = sa.id
     LEFT JOIN leads l ON sa.lead_id = l.id
     LEFT JOIN clients c ON sa.client_id = c.id
     WHERE aa.r2_object_key = ?${scope.sql} LIMIT 1`,
  ).bind(key, ...scope.params).first()
  if (visible) return

  throw notFound('文件不存在')
}
