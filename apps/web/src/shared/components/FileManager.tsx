import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'

interface Attachment {
  id: string
  name: string
  fileKey: string
  size: number | null
  mimeType: string | null
  createdAt: string
}

type EntityType = 'service' | 'partner' | 'product'

type FileType = 'image' | 'pdf' | 'audio' | 'other'

function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'mp4'].includes(ext)) return 'audio'
  return 'other'
}

const FILE_ICONS: Record<FileType, string> = {
  image: '🖼',
  pdf: '📄',
  audio: '🎵',
  other: '📎',
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface PreviewState {
  att: Attachment
  objectUrl: string | null
  loading: boolean
}

function PreviewModal({ state, onClose }: { state: PreviewState; onClose: () => void }) {
  const { t } = useTranslation()
  const fileType = getFileType(state.att.name)

  const handleDownload = () => {
    if (!state.objectUrl) return
    const a = document.createElement('a')
    a.href = state.objectUrl
    a.download = state.att.name
    a.click()
  }

  return (
    <div
      data-modal-open
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 text-white">
        <span className="truncate text-sm font-medium">{state.att.name}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={!state.objectUrl}
            className="rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40"
          >
            {t('common.download')}
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-300 hover:bg-white/10 text-xl"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
        {state.loading && <div className="text-sm text-gray-400">{t('common.loading')}</div>}
        {!state.loading && state.objectUrl && (
          <>
            {fileType === 'image' && (
              <img src={state.objectUrl} alt={state.att.name} className="max-h-full max-w-full rounded object-contain" />
            )}
            {fileType === 'pdf' && (
              <iframe src={state.objectUrl} title={state.att.name} className="h-full w-full rounded bg-white" />
            )}
            {fileType === 'audio' && (
              <div className="rounded-xl bg-white/10 p-8 text-center">
                <div className="mb-4 text-5xl">🎵</div>
                <p className="mb-4 text-sm text-gray-300 truncate max-w-xs">{state.att.name}</p>
                <audio controls src={state.objectUrl} className="w-72 max-w-full" />
              </div>
            )}
            {fileType === 'other' && (
              <div className="rounded-xl bg-white/10 p-8 text-center">
                <div className="mb-4 text-5xl">📎</div>
                <p className="mb-4 text-sm text-gray-300">{state.att.name}</p>
                <button onClick={handleDownload} className="rounded bg-white/20 px-4 py-2 text-sm text-white hover:bg-white/30">
                  {t('common.download')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface Props {
  entityType: EntityType
  entityId: string
  readonly?: boolean
}

export function FileManager({ entityType, entityId, readonly = false }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const queryKey = ['attachments', entityType, entityId]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      crmApi.get<{ data: Attachment[] }>('/upload/attachments', {
        params: { entityType, entityId },
      }).then((r) => r.data.data),
  })
  const attachments = data ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/upload/attachments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''

    setUploading(true)
    try {
      await Promise.all(
        files.map((file) => {
          const form = new FormData()
          form.append('file', file)
          return crmApi.post(
            `/upload/attachments?entityType=${entityType}&entityId=${entityId}`,
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
          )
        }),
      )
      queryClient.invalidateQueries({ queryKey })
    } finally {
      setUploading(false)
    }
  }

  const openPreview = async (att: Attachment) => {
    const fileType = getFileType(att.name)
    setPreview({ att, objectUrl: null, loading: true })
    try {
      const res = await crmApi.get<Blob>(`/upload/file?key=${encodeURIComponent(att.fileKey)}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      if (fileType === 'other') {
        const a = document.createElement('a')
        a.href = url
        a.download = att.name
        a.click()
        URL.revokeObjectURL(url)
        setPreview(null)
      } else {
        setPreview({ att, objectUrl: url, loading: false })
      }
    } catch {
      setPreview(null)
    }
  }

  const closePreview = () => {
    if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl)
    setPreview(null)
  }

  return (
    <div>
      {isLoading ? (
        <p className="text-xs text-gray-400">{t('common.loading')}</p>
      ) : attachments.length === 0 && readonly ? (
        <p className="text-xs text-gray-400">{t('fileManager.empty')}</p>
      ) : (
        <div className="space-y-1">
          {attachments.map((att) => {
            const fileType = getFileType(att.name)
            return (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5"
              >
                <span className="text-base">{FILE_ICONS[fileType]}</span>
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  className="flex-1 min-w-0 text-left text-xs text-gray-700 hover:text-primary-600 truncate"
                  title={att.name}
                >
                  {att.name}
                </button>
                {att.size && <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(att.size)}</span>}
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t('fileManager.deleteConfirm', { name: att.name }))) deleteMutation.mutate(att.id)
                    }}
                    className="flex-shrink-0 text-gray-300 hover:text-red-400 text-lg leading-none"
                    title={t('common.delete')}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!readonly && (
        <div className="mt-2">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-primary-400 hover:text-primary-600 disabled:opacity-50 transition-colors"
          >
            {uploading ? t('common.uploading') : t('fileManager.upload')}
          </button>
        </div>
      )}

      {preview && <PreviewModal state={preview} onClose={closePreview} />}
    </div>
  )
}
