'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Play, Pause, RotateCcw } from 'lucide-react';
import type { StudioHandle, StudioView } from '@/lib/studio-scene';
import type { DigestionSnapshot } from '@/lib/studio-digestion';
import { DIGESTION, digestionAt } from '@/lib/candy-digestion';
import { PLAY_PIGMENTS } from '@/lib/studio-pigment';
import '../colors/colors.css';
import '../absorption/absorption.css';
import './digestion.css';

export default function DigestionStudy() {
  const host = useRef<HTMLDivElement>(null),
    studio = useRef<StudioHandle | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [view, setView] = useState<StudioView | null>('front');
  const [state, setState] = useState<DigestionSnapshot>({
    ...digestionAt(0),
    kind: 'cube',
    pigment: 'sky',
    playing: false,
    speed: 1,
  });
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/studio-scene')
      .then(async ({ createStudio }) => {
        if (cancelled) return;
        const h = await createStudio(
          host.current!,
          {
            onReady() {
              if (!cancelled) setReady(true);
            },
            onStats() {},
            onError(s) {
              if (!cancelled) setError(s);
            },
            onViewChange(v) {
              if (!cancelled) setView(v);
            },
            onDigestion(s) {
              if (!cancelled) setState(s);
            },
          },
          { digestionStudy: true },
        );
        if (cancelled) h.dispose();
        else {
          studio.current = h;
          h.alignReference('front', 'rest');
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : '样片加载失败');
      });
    return () => {
      cancelled = true;
      studio.current?.dispose();
      studio.current = null;
    };
  }, []);
  const stages = {
    inside: '刚进入，先完整待一会儿',
    dissolving: '糖芯慢慢变小，颜色轻轻散开',
    settling: '最后一点甜，慢慢晕匀',
    done: '变成它的一部分',
  };
  return (
    <main className="color-study absorption-study digestion-study">
      <header className="color-header">
        <Link className="color-logo" href="/softbody">
          softie<sup>®</sup>
        </Link>
        <span>INSIDE / 04</span>
        <Link className="color-back" href="/softbody">
          回到试玩
        </Link>
      </header>
      <section className="color-heading">
        <div>
          <p>在身体里，也还是那颗糖。</p>
          <h1>
            慢慢，<em>化开。</em>
          </h1>
        </div>
        <p>
          暂停看看糖芯的颜色与轮廓。
          <br />
          拖动转个角度，再慢慢播放。
        </p>
      </section>
      <section className="absorption-stage" aria-label="体内消化样片">
        <div className="absorption-canvas" ref={host} />
        <div className="absorption-caption">
          <span>WebGPU · 体内糖芯</span>
          <span>
            {state.time.toFixed(1)} / {DIGESTION.total} 秒
          </span>
        </div>
        <div className="absorption-note">
          <div>
            <strong>{stages[state.stage]}</strong>
            <p>剩余糖量 {Math.round(state.remaining * 100)}%</p>
          </div>
        </div>
        <fieldset className="absorption-camera" aria-label="观察角度">
          {(
            [
              ['front', '正面'],
              ['three-quarter', '侧前方'],
              ['side', '侧面'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              disabled={!ready}
              aria-pressed={view === v}
              onClick={() => studio.current?.alignReference(v, 'rest')}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {(!ready || error) && (
          <output className="color-loading">
            {error || '正在让光穿过糖芯…'}
          </output>
        )}
      </section>
      <section className="digestion-panel" aria-label="消化播放控制">
        <div className="digestion-row">
          <button
            className="absorption-play"
            disabled={!ready}
            onClick={() =>
              studio.current?.setDigestion({
                playing: !state.playing,
                ...(state.stage === 'done' ? { time: 0 } : {}),
              })
            }
          >
            {state.playing ? <Pause size={16} /> : <Play size={16} />}{' '}
            {state.playing ? '暂停看看' : '播放消化'}
          </button>
          <button
            disabled={!ready}
            onClick={() =>
              studio.current?.setDigestion({ time: 0, playing: false })
            }
          >
            <RotateCcw size={15} /> 重新看
          </button>
          <button
            disabled={!ready}
            aria-pressed={state.speed === 0.25}
            onClick={() =>
              studio.current?.setDigestion({
                speed: state.speed === 0.25 ? 1 : 0.25,
              })
            }
          >
            {state.speed === 0.25 ? '恢复正常速度' : '四分之一慢放'}
          </button>
          <span className="digestion-checkpoints">
            {(
              [
                ['刚进入', 0.4],
                ['化掉一半', 4.5],
                ['剩一小颗', 6.5],
              ] as const
            ).map(([label, time]) => (
              <button
                key={label}
                disabled={!ready}
                onClick={() =>
                  studio.current?.setDigestion({ time, playing: false })
                }
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        <label className="digestion-timeline">
          消化时间{' '}
          <input
            type="range"
            aria-label="消化时间"
            min="0"
            max={DIGESTION.total}
            step=".01"
            disabled={!ready}
            value={state.time}
            onChange={(e) =>
              studio.current?.setDigestion({
                time: Number(e.target.value),
                playing: false,
              })
            }
          />
          <output>{state.time.toFixed(1)} 秒</output>
        </label>
        <div className="digestion-row">
          <fieldset aria-label="糖果形状">
            {(
              [
                ['cube', '方糖'],
                ['round', '圆糖'],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                disabled={!ready}
                aria-pressed={state.kind === kind}
                onClick={() => studio.current?.setDigestion({ kind })}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <fieldset aria-label="糖果颜色">
            {PLAY_PIGMENTS.map((p) => (
              <button
                key={p.id}
                disabled={!ready}
                aria-pressed={state.pigment === p.id}
                onClick={() => studio.current?.setDigestion({ pigment: p.id })}
              >
                <i style={{ background: p.swatch }} />
                {p.label}
              </button>
            ))}
          </fieldset>
        </div>
        <p className="digestion-footnote">
          这里从完全进入身体开始观察。糖芯、透光和消化节奏与试玩页共用。
        </p>
      </section>
    </main>
  );
}
