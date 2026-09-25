import { Scene, type StorySceneProps } from '../primitives'

/** 占位：待实现 */
export function Stars({ scene, onActive }: StorySceneProps) {
  return (
    <Scene id={scene.id} tone={scene.tone} bg="--jh-paper" onActive={onActive}>
      <div />
    </Scene>
  )
}
