'use client';
import { useMemo, useSyncExternalStore, useState, type RefObject } from 'react';
import {
  PLAY_PIGMENTS,
  validPigment,
  type PigmentId,
} from '@/lib/studio-pigment';
import type { StudioHandle } from '@/lib/studio-scene';

const KEY = 'softie.saved-appearance.v1';
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
};
const readSaved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export function PalettePanel({
  handle,
  disabled,
  current,
}: {
  handle: RefObject<StudioHandle | null>;
  disabled: boolean;
  current: PigmentId;
}) {
  const [strength, setStrength] = useState(
      () => handle.current?.colorAppearance().strength ?? 100,
    ),
    [hue, setHue] = useState(() => handle.current?.colorAppearance().hue ?? 0);
  const [savedNow, setSaved] = useState<unknown>(null),
    [notice, setNotice] = useState('选一种颜色，马上试试看。');
  const raw = useSyncExternalStore(subscribe, readSaved, () => null);
  const saved = useMemo(() => {
    if (savedNow) return savedNow;
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [savedNow, raw]);
  const select = (id: PigmentId, amount = 100, shift = 0) => {
    setStrength(amount);
    setHue(shift);
    handle.current?.selectColor(id, amount, shift);
    setNotice(
      id === 'rose' ? '回到最初的玫瑰粉。' : '也可以用糖果慢慢染上另一种颜色。',
    );
  };
  return (
    <div className="palette-panel">
      <p className="drawer-intro">今天，想是什么颜色？</p>
      <div className="palette-grid">
        {PLAY_PIGMENTS.map((p) => (
          <button
            key={p.id}
            disabled={disabled}
            aria-pressed={current === p.id}
            onClick={() => select(p.id)}
          >
            <i style={{ '--gel-swatch': p.swatch } as React.CSSProperties} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      <details className="palette-fine">
        <summary>再调一点点</summary>
        <label>
          浓淡 <output>{strength}%</output>
          <input
            aria-label="颜色浓淡"
            type="range"
            min="15"
            max="100"
            value={strength}
            disabled={disabled}
            onChange={(e) => select(current, +e.target.value, hue)}
          />
        </label>
        <label>
          色调{' '}
          <output>
            {hue > 0 ? '+' : ''}
            {hue}°
          </output>
          <input
            aria-label="颜色色调"
            type="range"
            min="-45"
            max="45"
            value={hue}
            disabled={disabled}
            onChange={(e) => select(current, strength, +e.target.value)}
          />
        </label>
      </details>
      <div className="palette-actions">
        <button
          disabled={disabled}
          onClick={() => {
            const value = handle.current?.saveColor();
            if (!value) return;
            setSaved(value);
            try {
              localStorage.setItem(KEY, JSON.stringify(value));
              setNotice('留下啦。颜色会保留，糖果继续慢慢化开。');
            } catch {
              setNotice('已留下当前颜色；浏览器暂时无法长期保存。');
            }
          }}
        >
          留下这个颜色
        </button>
        <button
          disabled={disabled || !saved}
          onClick={() => {
            handle.current?.restoreColor(saved);
            const s = saved as {
              base?: unknown;
              strength?: number;
              hue?: number;
            };
            setStrength(s.strength ?? 100);
            setHue(s.hue ?? 0);
            setNotice('找回你留下的颜色。');
          }}
        >
          用我留下的
        </button>
      </div>
      <button
        className="palette-reset"
        disabled={disabled}
        onClick={() => select(validPigment('rose'))}
      >
        恢复原版玫瑰粉
      </button>
      <output className="palette-notice">{notice}</output>
    </div>
  );
}
