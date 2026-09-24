import { useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  title?: ReactNode
  hint?: ReactNode
  className?: string
  children?: ReactNode
}

/** 拖放 / 点击选择文件区域 */
export function DropZone({ onFiles, accept, multiple, title = '拖入文件，或点击选择', hint, className, children }: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(multiple ? files : files.slice(0, 1))
      }}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition-all duration-300',
        over ? 'scale-[1.01] border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-accent/60 hover:bg-fill-2',
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      {children ?? (
        <>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform duration-300 group-hover:-translate-y-1">
            <Upload className="size-5" />
          </span>
          <div className="text-sm font-medium text-fg">{title}</div>
          {hint && <div className="text-xs text-fg-3">{hint}</div>}
        </>
      )}
    </div>
  )
}
