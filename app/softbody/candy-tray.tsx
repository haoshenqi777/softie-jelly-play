'use client';
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { StudioHandle } from '@/lib/studio-scene';
import type { CandyKind } from '@/lib/candy-physics';
import { PIGMENTS, PLAY_PIGMENTS, type PigmentId } from '@/lib/studio-pigment';
import { PLAY_CANDY_LIMIT } from '@/lib/play-limits';

const kinds = [
  { kind: 'cube', label: '蜜桃琥珀方糖', pigment: 'peach' },
  { kind: 'round', label: '月光蓝圆糖', pigment: 'sky' },
] as const;
type Gesture = {
  id: number;
  x: number;
  y: number;
  kind: CandyKind;
  moved: boolean;
  started: boolean;
  owner: HTMLButtonElement;
};
export function CandyTray({
  handle,
  disabled,
  count,
}: {
  handle: RefObject<StudioHandle | null>;
  disabled: boolean;
  count: number;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [flavor, setFlavor] = useState<PigmentId | null>(null);
  const [notice, setNotice] = useState('点一颗，或拖进来轻轻扔');
  const full = count >= PLAY_CANDY_LIMIT;
  const unavailable = () =>
    setNotice(
      full ? '一颗一颗来，吃完再拿下一颗' : '等手里的东西放下，再拿一颗',
    );
  useEffect(() => {
    const cancel = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.owner.hasPointerCapture(g.id)) g.owner.releasePointerCapture(g.id);
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const down = (e: ReactPointerEvent<HTMLButtonElement>, kind: CandyKind) => {
    if (e.button !== 0 || gesture.current || disabled) return;
    if (full) {
      unavailable();
      return;
    }
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      kind,
      moved: false,
      started: false,
      owner: e.currentTarget,
    };
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) {
      g.moved = true;
      g.started =
        handle.current?.beginCandy(g.kind, e.nativeEvent, g.owner) ?? false;
      if (!g.started) unavailable();
      else setNotice('松手扔出去，也可以再捡起来');
    }
    if (g.started) handle.current?.moveCandy(e.nativeEvent);
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>, cancel = false) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.started) handle.current?.releaseCandy(e.nativeEvent, cancel);
    else if (!g.moved && !cancel) {
      if (!handle.current?.spawnCandy(g.kind)) unavailable();
      else setNotice('拖起糖果，轻轻按进它的侧边。');
    }
    if (g.owner.hasPointerCapture(g.id)) g.owner.releasePointerCapture(g.id);
  };
  return (
    <div className="candy-tray" aria-label="糖果托盘">
      <div className="candy-tray-head">
        <span>一点甜</span>
        <label className="candy-flavor">
          口味
          <select
            aria-label="糖果口味"
            value={flavor ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value as PigmentId;
              setFlavor(id);
              handle.current?.setCandyPigment(id);
            }}
          >
            <option value="" disabled>
              蜜桃 / 月光
            </option>
            {PLAY_PIGMENTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <span>
          {count} / {PLAY_CANDY_LIMIT}
        </span>
      </div>
      <div className="candy-tray-items">
        {kinds.map(({ kind, label, pigment }) => (
          <button
            key={kind}
            disabled={disabled}
            aria-disabled={disabled || full}
            className="candy-pick"
            aria-label={
              flavor
                ? `${PIGMENTS.find((p) => p.id === flavor)!.label}${kind === 'cube' ? '方糖' : '圆糖'}`
                : label
            }
            onPointerDown={(e) => down(e, kind)}
            onPointerMove={move}
            onPointerUp={(e) => up(e)}
            onPointerCancel={(e) => up(e, true)}
            onLostPointerCapture={(e) => up(e, true)}
            onClick={(e) => {
              if (e.detail === 0 && !gesture.current) {
                if (full) {
                  unavailable();
                  return;
                }
                if (!handle.current?.spawnCandy(kind)) unavailable();
              }
            }}
          >
            <i
              className={`candy-swatch ${kind}`}
              style={{
                background: `radial-gradient(ellipse at 30% 25%,#ffffffc9,transparent 65%),${PIGMENTS.find((p) => p.id === (flavor ?? pigment))!.swatch}`,
              }}
              aria-hidden="true"
            />
            <span>
              {flavor
                ? `${PIGMENTS.find((p) => p.id === flavor)!.label}${kind === 'cube' ? '方糖' : '圆糖'}`
                : label}
            </span>
          </button>
        ))}
        <button
          className="candy-clear"
          disabled={disabled || count === 0}
          onClick={() => {
            handle.current?.clearCandies();
            setNotice('点一颗，或拖进来轻轻扔');
          }}
        >
          收拾
        </button>
      </div>
      <p aria-live="polite">
        {count === 0
          ? '点一颗，或拖进来轻轻扔'
          : full
            ? '点地上的糖叫它来 · 拖动可以拿起'
            : notice}
      </p>
    </div>
  );
}
