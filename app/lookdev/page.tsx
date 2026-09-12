'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowUpRight,
  RotateCcw,
  Pause,
  Play,
  MoveHorizontal,
} from 'lucide-react';
import type { StudioHandle, StudioPose, StudioView } from '@/lib/studio-scene';
import './studio.css';

const references = [
  { id: 'front', label: '正面', view: 'front', pose: 'rest' },
  { id: 'three-quarter', label: '侧前方', view: 'three-quarter', pose: 'rest' },
  { id: 'side', label: '侧面', view: 'side', pose: 'rest' },
  { id: 'squash', label: '压低', view: 'three-quarter', pose: 'squash' },
] as const;

export default function AppearanceStudio() {
  const host = useRef<HTMLDivElement>(null),
    handle = useRef<StudioHandle | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [fps, setFps] = useState(0);
  const [view, setView] = useState<StudioView | null>('front'),
    [pose, setPose] = useState<StudioPose>('rest');
  const [material, setMaterial] = useState<'gel' | 'clay'>('gel'),
    [motion, setMotion] = useState(false);
  const [referenceMode, setReferenceMode] = useState<'cycles' | 'concept'>(
    'concept',
  );
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [conceptView, setConceptView] = useState<StudioView>('front');
  const conceptLabel = {
    front: '正面',
    'three-quarter': '侧前方',
    side: '侧面',
  }[conceptView];
  const conceptCrop = {
    front: '65 90 855 540',
    'three-quarter': '1008 86 862 544',
    side: '46 690 870 549',
  }[conceptView];
  const [cropX, cropY, cropWidth, cropHeight] = conceptCrop
    .split(' ')
    .map(Number);
  const [aligned, setAligned] = useState(true);
  const reference = references[referenceIndex];
  useEffect(() => {
    let cancelled = false;
    import('@/lib/studio-scene')
      .then(({ createStudio }) =>
        createStudio(host.current!, {
          onReady() {
            if (!cancelled) setReady(true);
          },
          onViewChange(v) {
            if (!cancelled) {
              setView(v);
              setAligned(false);
            }
          },
          onStats(n) {
            if (!cancelled) setFps(n);
          },
          onError(s) {
            if (!cancelled) {
              setReady(false);
              setError(s);
            }
          },
        }),
      )
      .then((h) => {
        if (cancelled) h.dispose();
        else handle.current = h;
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : '样片暂时无法加载。');
      });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);
  const chooseView = (v: StudioView) => {
    setAligned(false);
    setView(v);
    setConceptView(v);
    handle.current?.setView(v);
  };
  const choosePose = (v: StudioPose) => {
    setAligned(false);
    setPose(v);
    handle.current?.setPose(v);
  };
  const chooseMaterial = (v: 'gel' | 'clay') => {
    setAligned(false);
    setMaterial(v);
    handle.current?.setMaterial(v);
  };
  const toggleMotion = () => {
    setAligned(false);
    setMotion(!motion);
    handle.current?.setMotion(!motion);
  };
  const alignReference = (index: number) => {
    const target = references[index];
    setReferenceIndex(index);
    setView(target.view);
    setPose(target.pose);
    setMaterial('gel');
    setMotion(false);
    handle.current?.alignReference(target.view, target.pose);
    setAligned(true);
  };
  return (
    <main className="appearance-page" data-reference={referenceMode}>
      <header className="appearance-header">
        <Link className="appearance-logo" href="/">
          softie<span>®</span>
        </Link>
        <span className="appearance-edition">APPEARANCE STUDY / 04</span>
        <Link className="appearance-color-link" href="/lookdev/colors">
          看看糖果颜色
        </Link>
        <Link className="appearance-back" href="/softbody">
          试试软体互动 <ArrowUpRight size={16} />
        </Link>
      </header>
      <section className="appearance-heading">
        <div>
          <p className="appearance-eyebrow">一只小凝胶的样子</p>
          <h1>
            先看见，<em>软。</em>
          </h1>
        </div>
        <p className="appearance-intro">拖动旋转，看看它的每一面。</p>
      </section>
      <section className="appearance-comparison" aria-label="对照来源">
        <div className="appearance-control">
          <fieldset aria-label="参考来源">
            <button
              aria-pressed={referenceMode === 'cycles'}
              onClick={() => {
                setReferenceMode('cycles');
                if (ready) alignReference(referenceIndex);
              }}
            >
              Cycles 样片
            </button>
            <button
              aria-pressed={referenceMode === 'concept'}
              onClick={() => {
                setReferenceMode('concept');
                if (ready) chooseView(conceptView);
                setAligned(false);
              }}
            >
              已确认四视图
            </button>
          </fieldset>
        </div>
        {referenceMode === 'cycles' ? (
          <fieldset
            className="appearance-reference-views"
            aria-label="对照样片角度"
          >
            {references.map((item, index) => (
              <button
                key={item.id}
                disabled={!ready}
                aria-pressed={referenceIndex === index}
                aria-label={`${item.label}样片`}
                onClick={() => alignReference(index)}
              >
                {item.label}
              </button>
            ))}
          </fieldset>
        ) : (
          <p>造型标准 · 切换视角同步对照</p>
        )}
      </section>
      <div className="appearance-grid">
        <section className="appearance-live" aria-label="实时外观样片">
          <div className="appearance-panel-label">
            <span>
              <i /> WebGPU · 实时
            </span>
            <span>{material === 'gel' ? '玫瑰凝胶' : '灰模 · 检查轮廓'}</span>
          </div>
          <div className="appearance-stage" ref={host} />
          {(!ready || error) && (
            <output className="appearance-loading">
              {error || '正在让光穿过凝胶…'}
            </output>
          )}
          <div className="appearance-stage-footer">
            <span>
              <MoveHorizontal size={14} /> 拖动身体所在区域，转着看
            </span>
            <button
              onClick={() =>
                referenceMode === 'cycles'
                  ? alignReference(referenceIndex)
                  : chooseView(conceptView)
              }
              disabled={!ready}
              aria-label="回到参考视角"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </section>
        <figure className="appearance-reference">
          <figcaption className="appearance-panel-label">
            <span>
              {referenceMode === 'cycles'
                ? `同模型 · ${reference.label}`
                : `已确认形象 · ${conceptLabel}`}
            </span>
            <span>
              {referenceMode === 'cycles'
                ? 'Cycles · 离线静帧'
                : '你的造型标准'}
            </span>
          </figcaption>
          {referenceMode === 'cycles' ? (
            <Image
              className="appearance-cycles-image"
              src={`/reference/cycles/${reference.id}.png`}
              width={768}
              height={720}
              unoptimized
              alt={`同一史莱姆模型的 ${reference.label} Cycles 离线渲染，固定图片。`}
            />
          ) : (
            <svg
              className="appearance-reference-crop"
              viewBox={conceptCrop}
              aria-label={`已确认四视图中的${conceptLabel}，保持原图比例`}
            >
              <title>{`已确认四视图 · ${conceptLabel}`}</title>
              <defs>
                <clipPath id="approved-view-crop">
                  <rect
                    x={cropX}
                    y={cropY}
                    width={cropWidth}
                    height={cropHeight}
                  />
                </clipPath>
              </defs>
              <image
                href="/reference/approved-turnaround.png"
                width="1860"
                height="1260"
                clipPath="url(#approved-view-crop)"
              />
            </svg>
          )}
          <p>
            {referenceMode === 'cycles'
              ? '真实模型渲染 · 身体透色、气泡折射与接触光'
              : '对照头顶曲线、两侧饱满度、底部收圆和小脸比例。'}
          </p>
        </figure>
      </div>
      {referenceMode === 'cycles' && (
        <output className="appearance-comparison-note">
          <span>
            {!ready
              ? '右侧是已渲染的固定图片；左侧正在加载。'
              : aligned
                ? '镜头与姿态已对齐 · 材质和灯光方案不同'
                : '左侧已自由调整 · 右侧仍是固定样片'}
            <small>离线静帧不代表实时性能。</small>
          </span>
          <button
            disabled={!ready}
            onClick={() => alignReference(referenceIndex)}
          >
            对齐参考 <RotateCcw size={13} />
          </button>
        </output>
      )}
      <section className="appearance-controls" aria-label="样片控制">
        <div className="appearance-control">
          <span>看哪里</span>
          <fieldset aria-label="观察视角">
            {(
              [
                ['three-quarter', '参考角度'],
                ['front', '正面'],
                ['side', '侧面'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                disabled={!ready}
                aria-pressed={view === v}
                onClick={() => chooseView(v)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="appearance-control">
          <span>看什么</span>
          <fieldset aria-label="材质">
            {(
              [
                ['gel', '凝胶'],
                ['clay', '灰模'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                disabled={!ready}
                aria-pressed={material === v}
                onClick={() => chooseMaterial(v)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="appearance-control">
          <span>小小形变</span>
          <fieldset aria-label="身体姿态">
            {(
              [
                ['rest', '自然'],
                ['squash', '压低'],
                ['puff', '鼓圆'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                disabled={!ready}
                aria-pressed={pose === v}
                onClick={() => choosePose(v)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        <button
          className="appearance-motion"
          disabled={!ready}
          aria-pressed={motion}
          onClick={toggleMotion}
        >
          {motion ? <Pause size={15} /> : <Play size={15} />}{' '}
          {motion ? '暂停呼吸' : '轻轻呼吸'}
        </button>
      </section>
      <footer className="appearance-footer">
        <span>
          WEBGPU <b>{fps || '—'}</b> 帧/秒（页面回调）
          <i /> 可实时旋转与变形
        </span>
        <span>外观样片 · 完整喂糖动作仍在小空间</span>
      </footer>
      <details className="appearance-storyboard">
        <summary>
          展开已确认四视图 <span>↗</span>
        </summary>
        <Image
          src="/reference/approved-turnaround.png"
          width={1860}
          height={1260}
          unoptimized
          alt="用户确认的史莱姆造型标准：正面、侧前方、侧面和背面。"
        />
      </details>
    </main>
  );
}
