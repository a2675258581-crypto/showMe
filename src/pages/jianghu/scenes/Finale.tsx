import { Scene } from '../primitives'

/** 占位：待实现 */
export function Finale({
  onActive,
}: {
  onActive: (id: string) => void
  /** 「再读一遍」：滚回卷首 */
  onAgain: () => void
}) {
  return (
    <Scene
      id="finale"
      tone="dawn"
      bg="--jh-dawn"
      prevBg="--jh-night-2"
      sticky={false}
      onActive={onActive}
    >
      <div className="min-h-[100svh]" />
    </Scene>
  )
}
