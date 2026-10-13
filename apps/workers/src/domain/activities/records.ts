// 跟进记录与附件的写库语句（供跟进记录服务和线索状态流转共用，保证列名只写在一处）

export interface AttachmentInput {
  key: string
  name: string
  size?: number | undefined
}

export interface ActivityRecord {
  id: string
  leadId: string | null
  clientId: string | null
  userId: string
  activityType: string
  description: string | null
  activityDate: string
  nextContactDate: string | null
  extraData?: Record<string, unknown> | null | undefined
}

export function insertActivityStatement(db: D1Database, a: ActivityRecord): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO sales_activities (id, client_id, lead_id, user_id, activity_type, description, activity_date, next_contact_date, extra_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    a.id, a.clientId, a.leadId, a.userId, a.activityType, a.description, a.activityDate, a.nextContactDate,
    a.extraData ? JSON.stringify(a.extraData) : null,
  )
}

export function insertAttachmentStatements(db: D1Database, activityId: string, attachments: AttachmentInput[]): D1PreparedStatement[] {
  return attachments.map((att) =>
    db.prepare(
      'INSERT INTO activity_attachments (id, activity_id, r2_object_key, file_name, file_size) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), activityId, att.key, att.name, att.size ?? 0),
  )
}

/** 系统变更记录（状态变更、转化等），记在操作人名下，时间为当前 UTC 时间（与 CURRENT_TIMESTAMP 同格式） */
export function insertSystemActivityStatement(
  db: D1Database, target: { leadId?: string | null; clientId?: string | null }, userId: string, description: string,
): D1PreparedStatement {
  return insertActivityStatement(db, {
    id: crypto.randomUUID(), leadId: target.leadId ?? null, clientId: target.clientId ?? null, userId,
    activityType: 'System', description, activityDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
    nextContactDate: null,
  })
}
