'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Pause, Play, RotateCcw } from 'lucide-react';
import type { StudioHandle, StudioView } from '@/lib/studio-scene';
import { ABSORPTION_STAGES, absorptionFrame } from '@/lib/absorption-motion';
import '../colors/colors.css';
import './absorption.css';

export default function AbsorptionStudy() {
  const host = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);
  const [frame, setFrame] = useState(() => absorptionFrame(0));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<StudioView | null>('three-quarter');
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/studio-scene')
      .then(async ({ createStudio }) => {
        if (cancelled) return;
        const handle = await createStudio(
          host.current!,
          {
            onReady() {
              if (!cancelled) setReady(true);
            },
            onError(s) {
              if (!cancelled) {
                setError(s);
                setReady(false);
                setPlaying(false);
              }
            },
            onStats(n) {
              if (!cancelled) setFps(n);
            },
            onViewChange(v) {
              if (!cancelled) setView(v);
            },
            onAbsorption(f, p) {
              if (!cancelled) {
                setFrame(f);
                setPlaying(p);
              }
            },
          },
          { absorptionStudy: true },
        );
        if (cancelled) handle.dispose();
        else {
          studio.current = handle;
          handle.alignReference('three-quarter', 'rest');
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : '样片加载失败，请刷新重试。',
          );
      });
    return () => {
      cancelled = true;
      studio.current?.dispose();
      studio.current = null;
    };
  }, []);
  const seek = (time: number) =>
    studio.current?.setAbsorption({ time, playing: false });
  const stage =
    frame.time < 2.9 ? 0 : frame.time < 4.9 ? 1 : frame.time < 10.3 ? 2 : 3;
  const toggle = () =>
    studio.current?.setAbsorption({
      playing: !playing,
      ...(frame.time >= 12 ? { time: 0 } : {}),
    });
  return (
    <main className="color-study absorption-study">
      <header className="color-header">
        <Link className="color-logo" href="/softbody">
          softie<sup>®</sup>
        </Link>
        <span>A LITTLE SWEET / 02</span>
        <Link className="color-back" href="/lookdev/contact">
          试试真实接触 <ArrowUpRight size={15} />
        </Link>
      </header>
      <section className="color-heading">
        <div>
          <p>让一颗糖，慢慢变成身体的一部分。</p>
          <h1>
            把甜，<em>抱进来。</em>
          </h1>
        </div>
        <p>
          一颗薄荷糖的近景样片。
          <br />
          停下来，转个角度，看看它怎样融进去。
        </p>
      </section>
      <section className="absorption-stage" aria-label="薄荷糖吸收近景">
        <div className="absorption-canvas" ref={host} />
        <div className="absorption-caption">
          <span>
            <i /> WebGPU · 实时样片
          </span>
          <span>{fps || '—'} 帧/秒</span>
        </div>
        <div className="absorption-note">
          <span>0{stage + 1}</span>
          <div>
            <strong>{ABSORPTION_STAGES[stage].label}</strong>
            <p>{ABSORPTION_STAGES[stage].description}</p>
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
            {error || '正在让光穿过凝胶…'}
          </output>
        )}
      </section>
      <section className="absorption-controls" aria-label="吸收样片播放控制">
        <div className="absorption-transport">
          <button
            className="absorption-play"
            disabled={!ready}
            onClick={toggle}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}{' '}
            {playing ? '暂停' : frame.time >= 12 ? '再看一遍' : '播放吸收'}
          </button>
          <button
            className="absorption-restart"
            aria-label="回到开始"
            disabled={!ready}
            onClick={() => seek(0)}
          >
            <RotateCcw size={16} />
          </button>
          <label className="absorption-scrub">
            吸收进度 <output>{frame.time.toFixed(1)} / 12 秒</output>
            <input
              aria-label="吸收时间"
              type="range"
              min="0"
              max="12"
              step="0.01"
              value={frame.time}
              disabled={!ready}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </label>
          <fieldset className="absorption-speed" aria-label="播放速度">
            {[0.25, 0.5, 1].map((n) => (
              <button
                key={n}
                aria-pressed={speed === n}
                disabled={!ready}
                onClick={() => {
                  setSpeed(n);
                  studio.current?.setAbsorption({ speed: n });
                }}
              >
                {n}×
              </button>
            ))}
          </fieldset>
        </div>
        <div className="absorption-checkpoints">
          {ABSORPTION_STAGES.map((s, i) => (
            <button
              key={s.id}
              disabled={!ready}
              aria-pressed={stage === i}
              onClick={() => seek(s.time)}
            >
              <span>0{i + 1}</span>
              {s.label}
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </section>
      <footer className="color-footer">
        <span>拖动画面转动视角 · 拖动进度逐帧观察</span>
        <Link href="/lookdev">
          对照原来的它 <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
