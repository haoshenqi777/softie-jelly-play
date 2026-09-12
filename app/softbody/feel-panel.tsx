'use client';
import { useState } from 'react';
import {
  DEFAULT_FEEL,
  FEEL_CONTROLS,
  FEEL_PRESETS,
  type FeelKey,
  type FeelTuning,
  type SupportVariant,
} from '@/lib/softbody/tuning';

function NumericValue({
  value,
  label,
  disabled,
  onChange,
}: {
  value: number;
  label: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [edit, setEdit] = useState({ source: value, text: value.toFixed(1) });
  const draft = edit.source === value ? edit.text : value.toFixed(1);
  const setDraft = (text: string) => setEdit({ source: value, text });
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() && Number.isFinite(n)) {
      const clamped = Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
      onChange(clamped);
      setDraft(clamped.toFixed(1));
    } else setDraft(value.toFixed(1));
  };
  return (
    <input
      type="number"
      aria-label={`${label}数值`}
      min={0}
      max={100}
      step={0.1}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setDraft(value.toFixed(1));
        }
      }}
    />
  );
}

export function FeelPanel({
  value,
  saved,
  disabled,
  onChange,
  onSave,
  notice,
  comparison,
  onCompare,
}: {
  value: FeelTuning;
  saved: FeelTuning | null;
  disabled: boolean;
  onChange: (value: FeelTuning) => void;
  onSave: () => void;
  notice: string;
  comparison: SupportVariant | null;
  onCompare: (variant: SupportVariant) => void;
}) {
  const [group, setGroup] = useState('身体');
  const same = (v: Readonly<FeelTuning>) =>
    FEEL_CONTROLS.every((c) => v[c.key] === value[c.key]);
  const preset =
    FEEL_PRESETS.find((p) => same(p.values))?.name ??
    (saved && same(saved) ? '我的手感' : '自定义');
  const change = (key: FeelKey, n: number) => onChange({ ...value, [key]: n });
  return (
    <section className="softbody-tuning" aria-label="手感调校">
      <div className="feel-heading">
        <h2>手感调校</h2>
        <span>0–100 · 精度 0.1</span>
      </div>
      <fieldset className="feel-comparison" aria-label="支撑感对照">
        <legend>同一组手感，逐步比较</legend>
        <div>
          {(
            [
              ['original', '调整前'],
              ['support', 'A · 加强支撑'],
              ['crown', 'B · 集中软顶'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              disabled={disabled}
              aria-pressed={comparison === id}
              onClick={() => onCompare(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="feel-description">
          A 只增加支撑；B 在 A
          上收小柔软区域。切换会回到原位，保存前不覆盖你的手感。
        </p>
      </fieldset>
      <label className="feel-preset">
        手感预设
        <select
          aria-label="手感预设"
          value={preset}
          disabled={disabled}
          onChange={(e) => {
            const p = FEEL_PRESETS.find((p) => p.name === e.target.value);
            if (p) onChange({ ...p.values });
            else if (e.target.value === '我的手感' && saved)
              onChange({ ...saved });
          }}
        >
          <option value="自定义" disabled>
            自定义
          </option>
          {FEEL_PRESETS.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
          {saved && <option>我的手感</option>}
        </select>
      </label>
      <div className="feel-tabs" role="tablist" aria-label="调校分类">
        {['身体', '触摸', '运动'].map((g, index) => (
          <button
            key={g}
            id={`feel-tab-${g}`}
            role="tab"
            aria-selected={g === group}
            aria-controls="feel-panel"
            tabIndex={g === group ? 0 : -1}
            onKeyDown={(e) => {
              const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
              if (!keys.includes(e.key)) return;
              e.preventDefault();
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? 2
                    : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
              setGroup(['身体', '触摸', '运动'][next]);
              (
                e.currentTarget.parentElement?.children[
                  next
                ] as HTMLButtonElement
              )?.focus();
            }}
            onClick={() => setGroup(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <div
        id="feel-panel"
        role="tabpanel"
        aria-labelledby={`feel-tab-${group}`}
      >
        {FEEL_CONTROLS.filter((c) => c.group === group).map((c) => (
          <div className="feel-control" key={c.key}>
            <div className="feel-label">
              <label htmlFor={`feel-${c.key}`}>{c.label}</label>
              <NumericValue
                value={value[c.key]}
                label={c.label}
                disabled={disabled}
                onChange={(n) => change(c.key, n)}
              />
            </div>
            <input
              id={`feel-${c.key}`}
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={value[c.key]}
              disabled={disabled}
              aria-describedby={`hint-${c.key}`}
              onChange={(e) => change(c.key, Number(e.target.value))}
            />
            <div className="softbody-range-hint">
              <span>{c.low}</span>
              <span>{c.high}</span>
            </div>
            <p id={`hint-${c.key}`} className="feel-description">
              {c.hint}
            </p>
          </div>
        ))}
      </div>
      <div className="feel-save">
        <button disabled={disabled} onClick={onSave}>
          保存这组手感
        </button>
        <button
          disabled={disabled}
          onClick={() => onChange({ ...DEFAULT_FEEL })}
        >
          恢复默认
        </button>
      </div>
      <output className="feel-notice">
        {notice || '保存后，下次在此浏览器打开会自动沿用。'}
      </output>
    </section>
  );
}
