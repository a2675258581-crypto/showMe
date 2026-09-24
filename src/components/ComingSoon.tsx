import { Hammer } from 'lucide-react'
import { Panel } from './ui'

export default function ComingSoon() {
  return (
    <Panel className="flex flex-col items-center gap-3 py-16 text-center">
      <Hammer className="size-8 text-fg-3" />
      <p className="text-fg-2">这个工具正在打磨中。</p>
    </Panel>
  )
}
