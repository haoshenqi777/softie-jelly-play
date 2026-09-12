'use client';
import {
  EXPRESSIONS,
  type ExpressionId,
  type ExpressionSettings,
} from '@/lib/softbody/expression-settings';
export function ExpressionPanel({
  settings,
  active,
  disabled,
  notice,
  onChange,
  onBlink,
  onReact,
  onSave,
}: {
  settings: ExpressionSettings;
  active: ExpressionId;
  disabled: boolean;
  notice: string;
  onChange: (values: Partial<ExpressionSettings>) => void;
  onBlink: () => void;
  onReact: (event: 'stroke' | 'sleep') => void;
  onSave: () => void;
}) {
  return (
    <section className="expression-panel" aria-label="表情试演">
      <div className="feel-heading">
        <h2>小脸，有话说。</h2>
        <span>16 种小心思</span>
      </div>
      <fieldset className="expression-mode" aria-label="表情模式">
        <button
          disabled={disabled}
          aria-pressed={settings.responsive}
          onClick={() => onChange({ responsive: true, sequence: false })}
        >
          自己回应
        </button>
        <button
          disabled={disabled}
          aria-pressed={!settings.responsive}
          onClick={() =>
            onChange({ expression: active, responsive: false, sequence: false })
          }
        >
          单独试演
        </button>
      </fieldset>
      <p className="expression-mode-hint">
        {settings.responsive
          ? '慢慢摸会笑，连着戳会闹脾气。安静一会儿，它会犯困。'
          : '选一张小脸细看，也可以拖住身体观察表情。'}
      </p>
      {(['daily', 'reaction'] as const).map((group) => (
        <fieldset className="expression-group" key={group}>
          <legend>{group === 'daily' ? '平时的小心思' : '被你碰到以后'}</legend>
          <div className="expression-grid">
            {EXPRESSIONS.filter((e) => e.group === group).map((e) => (
              <button
                key={e.id}
                disabled={disabled}
                aria-pressed={active === e.id}
                onClick={() =>
                  onChange({
                    expression: e.id,
                    responsive: false,
                    sequence: false,
                  })
                }
              >
                {e.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="expression-description" aria-live="polite">
        {EXPRESSIONS.find((e) => e.id === active)?.hint}
      </p>
      <label htmlFor="expression-intensity">
        表情强度<output>{settings.intensity}%</output>
      </label>
      <input
        id="expression-intensity"
        type="range"
        min={0}
        max={100}
        step={1}
        value={settings.intensity}
        disabled={disabled}
        onChange={(e) => onChange({ intensity: Number(e.target.value) })}
      />
      <div className="softbody-range-hint">
        <span>轻轻一点</span>
        <span>更明显</span>
      </div>
      <label htmlFor="expression-speed">
        变化速度<output>{settings.speed}</output>
      </label>
      <input
        id="expression-speed"
        type="range"
        min={0}
        max={100}
        step={1}
        value={settings.speed}
        disabled={disabled}
        onChange={(e) => onChange({ speed: Number(e.target.value) })}
      />
      <div className="softbody-range-hint">
        <span>慢慢露出来</span>
        <span>轻快回应</span>
      </div>
      <div className="expression-options">
        {(
          [
            ['autoBlink', '自然眨眼'],
            ['gaze', '目光跟随'],
            ['microMotion', '神态小动作'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={settings[key]}
              disabled={disabled}
              onChange={(e) => onChange({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <fieldset className="expression-reactions" aria-label="试试回应">
        <button disabled={disabled} onClick={() => onReact('stroke')}>
          摸摸它
        </button>
        <button disabled={disabled} onClick={() => onReact('sleep')}>
          打个盹
        </button>
        <button disabled={disabled} onClick={onBlink}>
          眨眨眼
        </button>
      </fieldset>
      <div className="feel-save">
        <button
          disabled={disabled}
          aria-pressed={settings.sequence}
          onClick={() =>
            onChange({ sequence: !settings.sequence, responsive: false })
          }
        >
          {settings.sequence ? '停止试演' : '循环试演'}
        </button>
        <button disabled={disabled} onClick={onSave}>
          保存表情偏好
        </button>
      </div>
      <output className="feel-notice">
        {notice ||
          (settings.sequence
            ? '每张小脸停留 3.2 秒，点击表情可停下来。'
            : '“摸摸它”和“打个盹”会切回自己回应。糖果相关神态暂可单独试演。')}
      </output>
    </section>
  );
}
