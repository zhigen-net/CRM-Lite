import { ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  size?: 'md' | 'lg'
}

export function Modal({ title, children, onClose, footer, size = 'md' }: Props) {
  return (
    <div data-modal-open className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className={`w-full max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:mx-4 ${size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'} sm:rounded-xl`}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}
