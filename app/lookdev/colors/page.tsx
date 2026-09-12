'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import type { StudioHandle, StudioView } from '@/lib/studio-scene';
import { PIGMENTS, type PigmentId } from '@/lib/studio-pigment';
import './colors.css';

export default function ColorStudy() {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const studios = useRef<(StudioHandle | null)[]>([null, null]);
  const [ready, setReady] = useState([false, false]);
  const [errors, setErrors] = useState(['', '']);
  const [fps, setFps] = useState([0, 0]);
  const [pigment, setPigment] = useState<PigmentId>('mint');
  const [amount, setAmount] = useState(100);
  const [view, setView] = useState<StudioView | null>('front');
  const current = useRef({ pigment: 'mint' as PigmentId, amount: 100 });
  const bothReady = ready.every(Boolean);

  useEffect(() => {
    let cancelled = false;
    const slots = [left.current!, right.current!];
    void import('@/lib/studio-scene')
      .then(async ({ createStudio }) => {
        // Start sequentially so WebGPU shader compilation doesn't burst twice.
        for (let i = 0; i < slots.length; i++) {
          if (cancelled) break;
          try {
            const h = await createStudio(
              slots[i],
              {
                onReady() {
                  if (!cancelled)
                    setReady((v) => v.map((r, j) => j === i || r));
                },
                onStats(n) {
                  if (!cancelled)
                    setFps((v) => v.map((r, j) => (j === i ? n : r)));
                },
                onViewChange(v) {
                  if (!cancelled) setView(v);
                },
                onError(s) {
                  if (!cancelled) {
                    setErrors((v) => v.map((r, j) => (j === i ? s : r)));
                    setReady((v) => v.map((r, j) => (j === i ? false : r)));
                  }
                },
              },
              { pigmentStudy: i === 1 },
            );
            if (cancelled) h.dispose();
            else {
              studios.current[i] = h;
              if (i === 1)
                h.setPigment(current.current.pigment, current.current.amount);
            }
          } catch (e) {
            if (!cancelled)
              setErrors((v) =>
                v.map((r, j) =>
                  j === i
                    ? e instanceof Error
                      ? e.message
                      : '样片暂时无法加载。'
                    : r,
                ),
              );
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrors([
            '样片模块加载失败，请刷新重试。',
            '样片模块加载失败，请刷新重试。',
          ]);
          setReady([false, false]);
        }
      });
    return () => {
      cancelled = true;
      studios.current.forEach((h) => h?.dispose());
      studios.current = [null, null];
    };
  }, []);

  const select = (id: PigmentId) => {
    setPigment(id);
    current.current.pigment = id;
    studios.current[1]?.setPigment(id, current.current.amount);
  };
  const changeAmount = (n: number) => {
    setAmount(n);
    current.current.amount = n;
    studios.current[1]?.setPigment(current.current.pigment, n);
  };
  const align = (v: StudioView) => {
    studios.current.forEach((h) => h?.alignReference(v, 'rest'));
    setView(v);
  };
  const selected = PIGMENTS.find((p) => p.id === pigment)!;

  return (
    <main className="color-study">
      <header className="color-header">
        <Link className="color-logo" href="/softbody">
          softie<sup>®</sup>
        </Link>
        <span>COLOR STUDY / 01</span>
        <Link className="color-back" href="/lookdev">
          对照定稿 <ArrowUpRight size={15} />
        </Link>
      </header>
      <section className="color-heading">
        <div>
          <p>一点甜，慢慢变成它的颜色。</p>
          <h1>
            换个颜色，<em>还是软。</em>
          </h1>
        </div>
        <p>
          同样的轮廓，同一束光。
          <br />
          看看颜色变了，透亮的感觉还在不在。
        </p>
      </section>
      <div className="color-panels">
        {[0, 1].map((i) => (
          <section
            className="color-panel"
            key={i}
            aria-label={i === 0 ? '原版玫瑰对照' : '染色样片'}
          >
            <div className="color-panel-top">
              <span>
                <i style={{ background: i ? selected.swatch : '#ed91a3' }} />
                {i ? `${selected.label} · 颜色样片` : '玫瑰 · 已确认材质'}
              </span>
              <small>{i ? '试试不同浓度' : '原版对照'}</small>
            </div>
            <div className="color-canvas" ref={i === 0 ? left : right} />
            {(!ready[i] || errors[i]) && (
              <output className="color-loading">
                {errors[i] || '正在让光穿过凝胶…'}
              </output>
            )}
            <div className="color-panel-bottom">
              <span>拖动，转着看</span>
              <span>WebGPU · {fps[i] || '—'} 帧/秒</span>
            </div>
          </section>
        ))}
      </div>
      <section className="color-controls" aria-label="颜色样片控制">
        <fieldset className="color-swatches">
          <legend>喜欢哪一种甜？</legend>
          <div className="color-swatch-grid">
            {PIGMENTS.map((p) => (
              <button
                key={p.id}
                aria-pressed={pigment === p.id}
                disabled={!bothReady}
                onClick={() => select(p.id)}
              >
                <i style={{ background: p.swatch }} />
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="color-strength">
          染色程度 <output>{pigment === 'rose' ? '原版' : `${amount}%`}</output>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={amount}
            disabled={!bothReady || pigment === 'rose'}
            onChange={(e) => changeAmount(Number(e.target.value))}
          />
          <span>
            原来的玫瑰色 <b>完整新颜色</b>
          </span>
        </label>
        <fieldset className="color-views">
          <legend>同步对照视角</legend>
          {(
            [
              ['front', '正面'],
              ['three-quarter', '侧前方'],
              ['side', '侧面'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              disabled={!bothReady}
              aria-pressed={view === v}
              onClick={() => align(v)}
            >
              {label}
            </button>
          ))}
          <button
            className="color-reset"
            disabled={!bothReady}
            onClick={() => {
              select('mint');
              changeAmount(100);
              align('front');
            }}
            aria-label="重置颜色对照"
          >
            <RotateCcw size={15} />
          </button>
        </fieldset>
      </section>
      <footer className="color-footer">
        <Link href="/lookdev/absorption">
          看糖慢慢融进去 <ArrowUpRight size={14} />
        </Link>
        <Link href="/softbody">
          回到小空间 <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
