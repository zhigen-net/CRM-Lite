// 右侧抽屉：列表页打开详情统一用它（线索、客户等），按 Esc 或点遮罩关闭
import { useEffect, type ReactNode } from 'react'

export function Drawer({ title, onClose, children, width = 'max-w-3xl' }: {
  title: ReactNode; onClose: () => void; children: ReactNode; width?: string
}) {
  useEffect(() => {
    // 抽屉里的弹窗打开时，Esc 只关弹窗（弹窗自己处理），不关抽屉
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-modal-open]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className={`flex h-full w-full ${width} flex-col bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <h2 className="min-w-0 truncate text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100">×</button>
        </div>
        <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-5">{children}</div>
      </div>
    </div>
  )
}
