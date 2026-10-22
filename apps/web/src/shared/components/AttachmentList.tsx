import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import type { ActivityAttachment } from '@/shared/types'

type FileType = 'image' | 'pdf' | 'audio' | 'other'

function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'mp4', 'webm'].includes(ext)) return 'audio'
  return 'other'
}

const FILE_ICONS: Record<FileType, string> = {
  image: '🖼',
  pdf: '📄',
  audio: '🎵',
  other: '📎',
}

interface PreviewState {
  att: ActivityAttachment
  objectUrl: string | null
  loading: boolean
  error: boolean
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
      {/* 顶栏 */}
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

      {/* 内容区 */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
        {state.loading && (
          <div className="text-sm text-gray-400">{t('common.loading')}</div>
        )}
        {state.error && (
          <div className="text-sm text-red-400">{t('attachments.loadFailed')}</div>
        )}
        {!state.loading && !state.error && state.objectUrl && (
          <>
            {fileType === 'image' && (
              <img
                src={state.objectUrl}
                alt={state.att.name}
                className="max-h-full max-w-full rounded object-contain"
              />
            )}
            {fileType === 'pdf' && (
              <iframe
                src={state.objectUrl}
                title={state.att.name}
                className="h-full w-full rounded bg-white"
              />
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
                <button
                  onClick={handleDownload}
                  className="rounded bg-white/20 px-4 py-2 text-sm text-white hover:bg-white/30"
                >
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
  attachments: ActivityAttachment[]
}

export function AttachmentList({ attachments }: Props) {
  const [preview, setPreview] = useState<PreviewState | null>(null)

  // 打开预览：先展示 loading，再异步拉取 blob
  const openPreview = async (att: ActivityAttachment) => {
    const fileType = getFileType(att.name)
    setPreview({ att, objectUrl: null, loading: true, error: false })

    try {
      const res = await crmApi.get<Blob>(`/upload/file?key=${encodeURIComponent(att.key)}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      setPreview({ att, objectUrl: url, loading: false, error: false })

      // 不支持预览的直接触发下载
      if (fileType === 'other') {
        const a = document.createElement('a')
        a.href = url
        a.download = att.name
        a.click()
        URL.revokeObjectURL(url)
        setPreview(null)
      }
    } catch {
      setPreview({ att, objectUrl: null, loading: false, error: true })
    }
  }

  const closePreview = () => {
    if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl)
    setPreview(null)
  }

  // 组件卸载时释放 URL
  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl)
    }
  }, [preview?.objectUrl])

  if (!attachments || attachments.length === 0) return null

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attachments.map((att) => {
          const fileType = getFileType(att.name)
          return (
            <button
              key={att.key}
              type="button"
              onClick={() => openPreview(att)}
              className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-primary-600 transition-colors"
              title={att.name}
            >
              <span>{FILE_ICONS[fileType]}</span>
              <span className="max-w-[120px] truncate">{att.name}</span>
            </button>
          )
        })}
      </div>

      {preview && <PreviewModal state={preview} onClose={closePreview} />}
    </>
  )
}
