'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  RotateCcw,
  Hand,
  ArrowUp,
  Circle,
  SlidersHorizontal,
  Palette,
  X,
  Scan,
} from 'lucide-react';
import { PalettePanel } from './palette-panel';
import type { StudioHandle, StudioView } from '@/lib/studio-scene';
import {
  PLAY_MODE_STORAGE_KEY,
  resolvePlayMode,
  type PlayMode,
} from '@/lib/play-mode';
import type { RecoveryPhase } from '@/lib/softbody/recovery';
import type { BehaviorPhase } from '@/lib/softbody/behavior-types';
import type { SocialBeat } from '@/lib/softbody/social-response';
import type { IntakeStage } from '@/lib/contact-intake';
import { PIGMENTS, type PigmentId } from '@/lib/studio-pigment';
import { FeelPanel } from './feel-panel';
import { ExpressionPanel } from './expression-panel';
import { CandyTray } from './candy-tray';
import {
  DEFAULT_EXPRESSION,
  EXPRESSION_STORAGE_KEY,
  normalizeExpression,
  parseSavedExpression,
  type ExpressionSettings,
  type ExpressionId,
} from '@/lib/softbody/expression-settings';
import {
  DEFAULT_FEEL,
  FEEL_STORAGE_KEY,
  normalizeFeel,
  parseSavedFeel,
  supportVariants,
  type SupportVariant,
  type FeelTuning,
} from '@/lib/softbody/tuning';
import './softbody.css';
import './product.css';

export default function SoftBodyStudy() {
  const settingsDialog = useRef<HTMLDialogElement>(null),
    paletteDialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null),
    handle = useRef<StudioHandle | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [playMode, setPlayMode] = useState<PlayMode>('free');
  const [cameraLocked, setCameraLocked] = useState(false);
  const changeCameraLocked = (locked: boolean) => {
    setCameraLocked(locked);
    handle.current?.setCameraLocked(locked);
  };
  const changePlayMode = (next: PlayMode) => {
    handle.current?.setPlayMode(next);
    setPlayMode(next);
    try {
      localStorage.setItem(PLAY_MODE_STORAGE_KEY, next);
    } catch {
      /* Keep the in-memory choice. */
    }
  };
  const [view, setView] = useState<StudioView | null>('front'),
    [clay, setClay] = useState(false);
  const [tuning, setTuning] = useState<FeelTuning>({ ...DEFAULT_FEEL });
  const tuningRef = useRef<FeelTuning>({ ...DEFAULT_FEEL });
  const [saved, setSaved] = useState<FeelTuning | null>(null);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'expression' | 'feel'>('feel');
  const comparisonBase = useRef<FeelTuning | null>(null);
  const [comparison, setComparison] = useState<SupportVariant | null>(null);
  const [selfRighting, setSelfRighting] = useState(true);
  const [breathing, setBreathing] = useState(true);
  const [paletteSession, setPaletteSession] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<RecoveryPhase>('idle');
  const [characterPhase, setCharacterPhase] = useState<BehaviorPhase>('idle');
  const [socialBeat, setSocialBeat] = useState<SocialBeat>('none');
  const [candyCount, setCandyCount] = useState(0);
  const [feeding, setFeeding] = useState<IntakeStage>('idle');
  const [pigment, setPigment] = useState<PigmentId>('rose');
  const [expression, setExpression] = useState({ ...DEFAULT_EXPRESSION });
  const expressionRef = useRef({ ...DEFAULT_EXPRESSION });
  const [expressionNotice, setExpressionNotice] = useState('');
  const [activeExpression, setActiveExpression] =
    useState<ExpressionId>('neutral');
  const changeExpression = (values: Partial<ExpressionSettings>) => {
    const next = normalizeExpression(values, expressionRef.current);
    expressionRef.current = next;
    setExpression(next);
    handle.current?.setExpression(values);
    setExpressionNotice('');
  };
  const saveExpression = () => {
    try {
      localStorage.setItem(
        EXPRESSION_STORAGE_KEY,
        JSON.stringify({ version: 1, values: expressionRef.current }),
      );
      setExpressionNotice('表情偏好已保存，手感调校单独保留。');
    } catch {
      setExpressionNotice('暂时无法保存，当前选择仍然有效。');
    }
  };
  const react = (event: 'stroke' | 'sleep') => {
    changeExpression({ responsive: true, sequence: false });
    handle.current?.react(event, event === 'stroke' ? 1 : undefined);
  };
  const changeTuning = (values: FeelTuning) => {
    const next = normalizeFeel(values);
    tuningRef.current = next;
    setTuning(next);
    handle.current?.setTuning(next);
    setNotice('已实时应用；喜欢的话可以保存。');
    setComparison(null);
  };
  const compareSupport = (variant: SupportVariant) => {
    comparisonBase.current ??= { ...tuningRef.current };
    const next = supportVariants(comparisonBase.current)[variant];
    changeTuning(next);
    handle.current?.resetBody();
    setComparison(variant);
    setNotice(
      variant === 'original'
        ? '已恢复本次对照开始前的手感。'
        : '已应用对照手感；试试按压、提起和落地。保存前不会覆盖原来的设置。',
    );
  };
  const saveTuning = () => {
    try {
      localStorage.setItem(
        FEEL_STORAGE_KEY,
        JSON.stringify({ version: 1, values: tuningRef.current }),
      );
      setSaved({ ...tuningRef.current });
      setNotice('已保存到此浏览器，下次打开自动恢复。');
    } catch {
      setNotice('浏览器暂时无法保存；当前调节仍然有效。');
    }
  };
  useEffect(() => {
    let cancelled = false;
    let savedMode: string | null = null;
    try {
      savedMode = localStorage.getItem(PLAY_MODE_STORAGE_KEY);
    } catch {
      /* Use device default. */
    }
    const initialMode = resolvePlayMode(
      savedMode,
      window.matchMedia('(pointer: coarse)').matches,
      new URLSearchParams(window.location.search).get('playmode'),
    );
    const initialCameraLocked = window.matchMedia(
      '(max-width: 760px), (pointer: coarse)',
    ).matches;
    setCameraLocked(initialCameraLocked);
    let stored: FeelTuning | null = null;
    try {
      stored = parseSavedFeel(localStorage.getItem(FEEL_STORAGE_KEY));
      if (stored) {
        tuningRef.current = stored;
      }
    } catch {
      /* Storage may be unavailable in a private or restricted browser. */
    }
    try {
      const preferences = parseSavedExpression(
        localStorage.getItem(EXPRESSION_STORAGE_KEY),
      );
      if (preferences) expressionRef.current = preferences;
    } catch {
      /* Retain the in-memory expression settings. */
    }
    import('@/lib/studio-scene')
      .then(({ createStudio }) =>
        createStudio(
          host.current!,
          {
            onReady() {
              if (!cancelled) setReady(true);
            },
            onError(message) {
              if (!cancelled) setError(message);
            },
            onViewChange(v) {
              if (!cancelled) setView(v);
            },
            onStats() {},
            onExpression(id) {
              if (!cancelled) setActiveExpression(id);
            },
            onRecovery(phase) {
              if (!cancelled) setRecoveryPhase(phase);
            },
            onCharacter(phase) {
              if (!cancelled) setCharacterPhase(phase);
            },
            onSocial(beat) {
              if (!cancelled) setSocialBeat(beat);
            },
            onCandyCount(count) {
              if (!cancelled) setCandyCount(count);
            },
            onFeeding(stage, color) {
              if (!cancelled) {
                setFeeding(stage);
                setPigment(color);
              }
            },
          },
          {
            softbody: true,
            playMode: initialMode,
            cameraLocked: initialCameraLocked,
          },
        ),
      )
      .then((h) => {
        if (cancelled) h.dispose();
        else {
          handle.current = h;
          setPlayMode(initialMode);
          setBreathing(
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          );
          h.setTuning(tuningRef.current);
          h.setExpression(expressionRef.current);
          setTuning({ ...tuningRef.current });
          setSaved(stored);
          setExpression({ ...expressionRef.current });
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : '暂时无法加载，请刷新重试。',
          );
      });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);
  const selectView = (v: StudioView) => {
    setView(v);
    handle.current?.setView(v);
  };
  return (
    <main
      className={`softbody-page product-playground${paletteOpen ? ' palette-open' : ''}`}
    >
      <header className="softbody-header">
        <Link href="/" className="softbody-logo">
          softie<sup>®</sup>
        </Link>
        <nav className="product-tools" aria-label="玩法工具">
          <button
            disabled={!ready}
            onClick={() => handle.current?.resetView()}
            aria-label="视角复原"
            title="恢复默认视角和缩放"
          >
            <Scan size={18} />
          </button>
          <button
            disabled={!ready}
            onClick={() => handle.current?.selectColor('rose', 100, 0)}
            title="恢复原版玫瑰粉"
            aria-label="原色"
          >
            <RotateCcw size={18} />
            <span>原色</span>
          </button>
          <button
            disabled={!ready}
            aria-label="调色板"
            onClick={() => {
              setPaletteSession((v) => v + 1);
              setPaletteOpen(true);
              paletteDialog.current?.showModal();
            }}
          >
            <Palette size={18} />
            <span>调色板</span>
          </button>
          <button
            aria-label="设置"
            onClick={() => settingsDialog.current?.showModal()}
          >
            <SlidersHorizontal size={18} />
            <span>设置</span>
          </button>
        </nav>
      </header>
      <div className="softbody-layout">
        <section className="softbody-play" aria-label="软体互动空间">
          <div className="softbody-stage" ref={host} />
          <div className="softbody-caption">
            <span>
              <i /> {PIGMENTS.find((p) => p.id === pigment)?.label}凝胶
            </span>
            <span>
              {(characterPhase === 'absorbing' &&
                (
                  {
                    pressing: '嗯？甜甜的碰到我啦。',
                    wrapping: '软软地，把糖抱住。',
                    entering: '轻轻挤进来一点。',
                    sealing: '抱住啦，慢慢合起来。',
                    inside: '在肚子里，晃一晃。',
                    dissolving: '甜味，慢慢化开了。',
                    settling: '染上一点新的颜色。',
                  } as Partial<Record<IntakeStage, string>>
                )[feeding]) ||
                (['arrived', 'idle', 'held'].includes(characterPhase) &&
                  {
                    none: '',
                    look: '刚才把我扔哪儿啦。',
                    inflate: '哼，我还生着气呢。',
                    stamp: '哼！',
                    wait: '再陪我一会儿。',
                    soften: '嗯…再摸摸。',
                    nuzzle: '好吧，靠近一点。',
                    content: '这下舒服啦。',
                  }[socialBeat]) ||
                ((
                  {
                    held: '轻一点，我在呢。',
                    airborne: '呜——',
                    landing: '让我缓一下…',
                    orient: '哼，我看着你呢。',
                    returning: '蹦蹦跳跳，找你去！',
                    arrived: '到你面前了。',
                    noticing: '咦，地上有一颗糖。',
                    seeking: '等我，蹦过去看看！',
                    inspecting: '圆圆的，闻起来甜甜的。',
                    collecting: '嘿——跳起来，把甜抱住！',
                  } as Partial<Record<BehaviorPhase, string>>
                )[characterPhase] ??
                  {
                    idle: '轻轻碰，它会记得。',
                    notice: '咦，怎么躺下了…',
                    brace: '攒一点力气。',
                    roll: '嘿——翻过来！',
                    settle: '站稳，再站稳。',
                    celebrate: '呼，我自己起来啦。',
                    rest: '歇一下，再试一次。',
                  }[recoveryPhase])}
            </span>
          </div>
          {(!ready || error) && (
            <output className="softbody-loading">{error || '正在醒来…'}</output>
          )}
          <div className="softbody-hint">
            <span className="desktop-hint">滚轮拉近 · 点地上的糖，叫它来</span>
            <span className="mobile-hint">
              {cameraLocked
                ? '镜头已固定 · 揉一揉，双指可缩放'
                : '揉身体 · 空白处转视角 · 双指缩放'}
            </span>
            <br />
            <span>糖果贴身体两侧，下推压入 · 上提撤回</span>
          </div>
          <CandyTray
            handle={handle}
            disabled={!ready || !!error}
            count={candyCount}
          />
        </section>
        <dialog
          ref={settingsDialog}
          className="product-drawer"
          aria-labelledby="settings-title"
        >
          <div className="drawer-content">
            <div className="drawer-heading">
              <h2 id="settings-title">一点小偏好</h2>
              <button
                aria-label="关闭设置"
                onClick={() => settingsDialog.current?.close()}
              >
                <X size={20} />
              </button>
            </div>
            <aside className="softbody-controls">
              <p className="softbody-eyebrow">一点重量，一点弹性</p>
              <h1>
                轻轻，
                <br />
                <em>碰一下。</em>
              </h1>
              <p className="softbody-intro">
                按下去的地方软软凹陷，
                <br />
                {playMode === 'tabletop'
                  ? '揉一揉，提起来，软软弹回你面前。'
                  : '扔到一边，它会看着你跳回来。'}
              </p>
              <fieldset
                className="study-tabs play-mode-tabs"
                aria-label="活动方式"
              >
                <button
                  disabled={!ready || !!error}
                  aria-pressed={playMode === 'tabletop'}
                  onClick={() => changePlayMode('tabletop')}
                >
                  固定桌面
                </button>
                <button
                  disabled={!ready || !!error}
                  aria-pressed={playMode === 'free'}
                  onClick={() => changePlayMode('free')}
                >
                  自由活动
                </button>
              </fieldset>
              <p className="feel-description" aria-live="polite">
                {playMode === 'tabletop'
                  ? '留在附近，自由揉捏、提起和弹跳。空白处拖动可环绕观看。'
                  : '可以提起抛远，转动镜头探索整个空间。'}
                切换会收起糖果，让它回到中央。
              </p>
              <label className="camera-lock-setting">
                <span>
                  固定中央视角<small>减少画面晃动，更容易揉捏</small>
                </span>
                <input
                  type="checkbox"
                  checked={cameraLocked}
                  disabled={!ready || !!error}
                  onChange={(event) => changeCameraLocked(event.target.checked)}
                />
              </label>
              <div className="softbody-actions">
                <button
                  disabled={!ready || !!error}
                  onClick={() => handle.current?.poke()}
                >
                  <Hand size={18} />
                  <span>戳一下</span>
                </button>
                <button
                  disabled={!ready || !!error}
                  onClick={() => handle.current?.drop()}
                >
                  <ArrowUp size={18} />
                  <span>试跳一下</span>
                </button>
                <button
                  disabled={!ready || !!error}
                  onClick={() => handle.current?.resetBody()}
                >
                  <RotateCcw size={18} />
                  <span>回到原位</span>
                </button>
              </div>
              <div className="softbody-recovery">
                <button
                  disabled={!ready || !!error}
                  onClick={() => handle.current?.tip()}
                >
                  轻推侧身
                </button>
                <button
                  disabled={!ready || !!error}
                  aria-pressed={selfRighting}
                  onClick={() => {
                    const next = !selfRighting;
                    setSelfRighting(next);
                    handle.current?.setRecoveryEnabled(next);
                  }}
                >
                  {selfRighting ? '自行动作 · 开' : '自行动作 · 关'}
                </button>
              </div>
              {!expression.responsive && (
                <p className="feel-description">
                  当前是表情试演；切到「自己回应」可看它的情绪变化。
                </p>
              )}
              <button
                className="breath-toggle"
                disabled={!ready || !!error}
                aria-pressed={breathing}
                onClick={() => {
                  setBreathing(!breathing);
                  handle.current?.setBreathing(!breathing);
                }}
              >
                轻轻呼吸 · {breathing ? '开' : '关'}
              </button>
              <details className="advanced-settings">
                <summary>高级调校与表情试演</summary>
                <fieldset className="study-tabs" aria-label="调试面板">
                  <button
                    aria-pressed={panel === 'expression'}
                    onClick={() => setPanel('expression')}
                  >
                    表情试演
                  </button>
                  <button
                    aria-pressed={panel === 'feel'}
                    onClick={() => setPanel('feel')}
                  >
                    手感调校
                  </button>
                </fieldset>
                {panel === 'expression' ? (
                  <ExpressionPanel
                    settings={expression}
                    active={activeExpression}
                    disabled={!ready || !!error}
                    onChange={changeExpression}
                    onBlink={() => handle.current?.blink()}
                    onReact={react}
                    onSave={saveExpression}
                    notice={expressionNotice}
                  />
                ) : (
                  <FeelPanel
                    value={tuning}
                    saved={saved}
                    disabled={!ready || !!error}
                    onChange={changeTuning}
                    onSave={saveTuning}
                    notice={notice}
                    comparison={comparison}
                    onCompare={compareSupport}
                  />
                )}
                <fieldset className="softbody-views" aria-label="观察视角">
                  <legend>转过来看看</legend>
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
                      onClick={() => selectView(v)}
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
                <button
                  className="softbody-clay"
                  disabled={!ready}
                  aria-pressed={clay}
                  onClick={() => {
                    setClay(!clay);
                    handle.current?.setMaterial(clay ? 'gel' : 'clay');
                  }}
                >
                  <Circle size={14} />
                  {clay ? '回到凝胶' : '看看轮廓'}
                </button>
                <p className="softbody-keyboard">空格：戳一下　R：回到原位</p>
                <Link href="/lookdev">
                  对照定稿 <ArrowUpRight size={15} />
                </Link>
              </details>
            </aside>
          </div>
        </dialog>
        <dialog
          ref={paletteDialog}
          className="product-drawer palette-drawer"
          aria-labelledby="palette-title"
          onClose={() => setPaletteOpen(false)}
        >
          <div className="drawer-content">
            <div className="drawer-heading">
              <h2 id="palette-title">一点颜色</h2>
              <button
                aria-label="关闭调色板"
                onClick={() => paletteDialog.current?.close()}
              >
                <X size={20} />
              </button>
            </div>
            <PalettePanel
              key={paletteSession}
              handle={handle}
              disabled={!ready || !!error}
              current={pigment}
            />
          </div>
        </dialog>
      </div>
    </main>
  );
}
