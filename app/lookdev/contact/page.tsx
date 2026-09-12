'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  MoveDown,
  RotateCcw,
  Play,
  Pause,
  Sparkles,
} from 'lucide-react';
import type { StudioHandle, StudioView } from '@/lib/studio-scene';
import type { ContactSnapshot } from '@/lib/studio-contact';
import '../colors/colors.css';
import '../absorption/absorption.css';
import './contact.css';

export default function ContactStudyPage() {
  const host = useRef<HTMLDivElement>(null),
    studio = useRef<StudioHandle | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [fps, setFps] = useState(0);
  const [view, setView] = useState<StudioView | null>('three-quarter');
  const [state, setState] = useState<ContactSnapshot>({
    location: 'front',
    depth: 0,
    angle: 0,
    face: 'curious',
    phase: '等你轻轻碰一下',
    indent: 0,
    contacts: 0,
    reaction: 0,
    physicsMs: 0,
    intake: {
      stage: 'idle',
      wrap: 0,
      offset: 0.3,
      permeability: 0,
      dissolve: 0,
      diffusionAge: 0,
      released: 0,
      paused: false,
    },
  });
  const busy = state.intake.stage !== 'idle' && state.intake.stage !== 'done';
  const manual = state.intake.stage === 'idle';
  const progress = {
    idle: 0,
    pressing: 0,
    wrapping: 0,
    entering: 1,
    sealing: 2,
    inside: 3,
    dissolving: 3,
    settling: 4,
    done: 4,
  }[state.intake.stage];
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
              }
            },
            onStats(n) {
              if (!cancelled) setFps(n);
            },
            onViewChange(v) {
              if (!cancelled) setView(v);
            },
            onContact(s) {
              if (!cancelled) setState(s);
            },
          },
          { contactStudy: true },
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
  return (
    <main className="color-study absorption-study contact-study">
      <header className="color-header">
        <Link className="color-logo" href="/softbody">
          softie<sup>®</sup>
        </Link>
        <span>A LITTLE PRESS / 03</span>
        <Link className="color-back" href="/lookdev">
          对照原来的它 <ArrowUpRight size={15} />
        </Link>
      </header>
      <section className="color-heading">
        <div>
          <p>一颗小糖，变成它的一部分。</p>
          <h1>
            慢慢，<em>融进来。</em>
          </h1>
        </div>
        <p>
          从轻轻触碰，到软软地合拢。
          <br />
          甜味，在身体里慢慢化开。
        </p>
      </section>
      <section className="absorption-stage" aria-label="方糖接触样片">
        <div className="absorption-canvas" ref={host} />
        <div className="absorption-caption">
          <span>
            <i /> WebGPU · 实时接触
          </span>
          <span>{fps || '—'} 帧/秒</span>
        </div>
        <div className="absorption-note">
          <span>↘</span>
          <div>
            <strong>{state.phase}</strong>
            <p>
              {manual
                ? '点住身体选位置，上下拖动调节深浅；松开回弹。'
                : '转个角度，看看身体里的糖。'}
            </p>
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
      <section className="intake-controls" aria-label="吸收过程">
        <div className="intake-actions">
          <button
            className="contact-release"
            disabled={!ready}
            onClick={() => studio.current?.setContact({ intake: 'step' })}
          >
            慢进一段
          </button>
          <button
            className="absorption-play"
            disabled={!ready}
            onClick={() =>
              studio.current?.setContact({
                intake: busy
                  ? state.intake.paused
                    ? 'resume'
                    : 'pause'
                  : 'start',
              })
            }
          >
            {busy ? (
              state.intake.paused ? (
                <Play size={17} />
              ) : (
                <Pause size={17} />
              )
            ) : (
              <Sparkles size={17} />
            )}
            {busy
              ? state.intake.paused
                ? '继续吸收'
                : '暂停看看'
              : state.intake.stage === 'done'
                ? '再来一次'
                : '让它吸收'}
          </button>
          <button
            className="contact-release"
            disabled={!ready}
            onClick={() => studio.current?.setContact({ intake: 'reset' })}
          >
            <RotateCcw size={16} />
            重新来一颗
          </button>
        </div>
        <ol aria-label="吸收进度">
          {['接触', '深入', '合拢', '消融', '吸收'].map((label, i) => (
            <li
              key={label}
              aria-current={progress === i ? 'step' : undefined}
              data-complete={progress > i}
            >
              {label}
            </li>
          ))}
        </ol>
      </section>
      <section className="contact-controls" aria-label="方糖接触控制">
        <fieldset className="contact-locations" aria-label="方糖位置">
          {(
            [
              ['front', '碰正面'],
              ['side', '碰侧面'],
              ['crown', '碰头顶'],
            ] as const
          ).map(([location, label]) => (
            <button
              key={location}
              disabled={!ready || !manual}
              aria-pressed={state.location === location}
              onClick={() => studio.current?.setContact({ location })}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <button
          className="absorption-play"
          disabled={!ready || !manual}
          onClick={() => studio.current?.setContact({ depth: 85 })}
        >
          <MoveDown size={17} />
          轻轻压下
        </button>
        <button
          className="contact-release"
          disabled={!ready || !manual}
          onClick={() => studio.current?.setContact({ depth: 0 })}
        >
          <RotateCcw size={16} />
          移开糖果
        </button>
        <label className="contact-pressure">
          压入深浅 <output>{Math.round(state.depth)}%</output>
          <input
            type="range"
            aria-label="压入深浅"
            min="0"
            max="100"
            step="1"
            disabled={!ready || !manual}
            value={state.depth}
            onChange={(e) =>
              studio.current?.setContact({ depth: Number(e.target.value) })
            }
          />
          <span>
            轻轻贴住 <b>再压一点</b>
          </span>
        </label>
        <label className="contact-pressure">
          转一转方糖 <output>{Math.round(state.angle)}°</output>
          <input
            type="range"
            aria-label="方糖角度"
            min="0"
            max="90"
            step="1"
            disabled={!ready || !manual}
            value={state.angle}
            onChange={(e) =>
              studio.current?.setContact({ angle: Number(e.target.value) })
            }
          />
          <span>
            平边 <b>转个角度</b>
          </span>
        </label>
      </section>
      <footer className="color-footer">
        <span>选个位置，试试轻按，也可以让它把糖收进身体里。</span>
        <Link href="/lookdev/colors">
          看看其他颜色 <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
