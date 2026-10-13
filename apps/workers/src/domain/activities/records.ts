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
