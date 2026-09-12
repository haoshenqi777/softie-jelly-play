export type PlayMode = 'tabletop' | 'free';
export const PLAY_MODE_STORAGE_KEY = 'softie.play-mode.v1';

export function resolvePlayMode(
  saved: unknown,
  coarsePointer: boolean,
  override?: string | null,
): PlayMode {
  if (override === 'tabletop' || override === 'free') return override;
  if (saved === 'tabletop' || saved === 'free') return saved;
  return coarsePointer ? 'tabletop' : 'free';
}
