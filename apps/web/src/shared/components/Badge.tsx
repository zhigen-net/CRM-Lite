import { cn } from '@/shared/utils/cn'

type Variant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

interface Props {
  children: React.ReactNode
  variant?: Variant
  className?: string
}

const variantClass: Record<Variant, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
}

export function Badge({ children, variant = 'gray', className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClass[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
