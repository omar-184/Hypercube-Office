import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ToolId, ToolOptions } from '../../../shared/pdf-tools-api'
import type { ToolStringKey } from '../i18n/strings-tools'
import type { ToolsT } from './use-tools-i18n'

type AnyOptions = ToolOptions[ToolId]

interface Props<T extends ToolId> {
  tool: T
  options: ToolOptions[T]
  onChange: (next: ToolOptions[T]) => void
  /** protect: the "repeat password" box, kept outside the request */
  repeat: string
  onRepeat: (value: string) => void
  disabled: boolean
  t: ToolsT
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="pt-field">
      <span className="pt-field-label">{label}</span>
      {children}
      {hint && <span className="pt-field-hint">{hint}</span>}
    </label>
  )
}

interface ChoiceProps<V extends string | number> {
  value: V
  options: { value: V; label: string; desc?: string }[]
  onChange: (v: V) => void
  disabled: boolean
}

/**
 * Radio group of option buttons: one Tab stop (the checked option), arrow keys
 * move the selection like native radios, mirrored for right-to-left layouts.
 */
function Choice<V extends string | number>({
  value,
  options,
  onChange,
  disabled,
  labelledBy,
}: ChoiceProps<V> & { labelledBy: string }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const checked = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const forward = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const back = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
    if (!forward && !back) return
    e.preventDefault()
    const next = (checked + (forward ? 1 : -1) + options.length) % options.length
    onChange(options[next]!.value)
    buttons.current[next]?.focus()
  }
  return (
    <div
      className="pt-choice"
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={disabled ? undefined : onKeyDown}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            buttons.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === checked ? 0 : -1}
          className={`pt-choice-item${o.value === value ? ' active' : ''}`}
          disabled={disabled}
          // re-picking the current option is a no-op: Split's onChange resets typed ranges
          onClick={() => {
            if (o.value !== value) onChange(o.value)
          }}
        >
          <span className="pt-choice-label">{o.label}</span>
          {o.desc && <span className="pt-choice-desc">{o.desc}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * A titled option group. Deliberately not a <label> like Field: a label forwards
 * clicks on its text (and its empty space) to its first button, which silently
 * switched the choice to the first option.
 */
function ChoiceField<V extends string | number>({
  label,
  hint,
  ...choice
}: ChoiceProps<V> & { label: string; hint?: string }) {
  const labelId = useId()
  return (
    <div className="pt-field">
      <span className="pt-field-label" id={labelId}>
        {label}
      </span>
      <Choice {...choice} labelledBy={labelId} />
      {hint && <span className="pt-field-hint">{hint}</span>}
    </div>
  )
}

function PagesInput({
  label,
  value,
  onChange,
  disabled,
  t,
}: {
  label: ToolStringKey
  value: string
  onChange: (v: string) => void
  disabled: boolean
  t: ToolsT
}) {
  return (
    <Field label={t(label)} hint={t('pagesHint')}>
      <input
        className="pt-input"
        value={value}
        disabled={disabled}
        spellCheck={false}
        placeholder="1-3, 5, 8-"
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

function PasswordInput({
  value,
  onChange,
  disabled,
  t,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  t: ToolsT
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <span className="pt-password">
      <input
        className="pt-input"
        type={shown ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="pt-link" onClick={() => setShown(!shown)}>
        {shown ? t('hidePassword') : t('showPassword')}
      </button>
    </span>
  )
}

function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled: boolean
}) {
  return (
    <label className="pt-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/** The options block for one tool. Returns null for tools without options. */
export function ToolOptionsForm<T extends ToolId>(props: Props<T>) {
  const { tool, t, disabled } = props
  const o = props.options as AnyOptions
  const set = (patch: Partial<AnyOptions>) =>
    props.onChange({ ...(props.options as object), ...patch } as ToolOptions[T])

  switch (tool) {
    case 'split': {
      const opts = o as ToolOptions['split']
      return (
        <>
          <ChoiceField
            label={t('splitHow')}
            value={opts.kind}
            disabled={disabled}
            options={[
              { value: 'every', label: t('splitEvery') },
              { value: 'ranges', label: t('splitRanges') },
              { value: 'pages', label: t('splitSingle') },
            ]}
            onChange={(kind) =>
              props.onChange(
                (kind === 'every'
                  ? { kind, size: 1 }
                  : kind === 'ranges'
                    ? { kind, ranges: '' }
                    : { kind, pages: '' }) as ToolOptions[T],
              )
            }
          />
          {opts.kind === 'every' && (
            <Field label={t('splitSize')}>
              <input
                className="pt-input pt-input-narrow"
                type="number"
                min={1}
                value={opts.size}
                disabled={disabled}
                onChange={(e) => set({ size: Math.max(1, Number(e.target.value) || 1) })}
              />
            </Field>
          )}
          {opts.kind === 'ranges' && (
            <Field label={t('splitRangesLabel')} hint={t('splitRangesHint')}>
              <input
                className="pt-input"
                value={opts.ranges}
                disabled={disabled}
                spellCheck={false}
                placeholder="1-3, 4-10, 11-"
                onChange={(e) => set({ ranges: e.target.value })}
              />
            </Field>
          )}
          {opts.kind === 'pages' && (
            <PagesInput
              label="pagesRender"
              value={opts.pages}
              disabled={disabled}
              t={t}
              onChange={(pages) => set({ pages })}
            />
          )}
        </>
      )
    }
    case 'extract':
    case 'delete': {
      const opts = o as ToolOptions['extract']
      return (
        <PagesInput
          label={tool === 'extract' ? 'pagesKeep' : 'pagesDelete'}
          value={opts.pages}
          disabled={disabled}
          t={t}
          onChange={(pages) => set({ pages })}
        />
      )
    }
    case 'rotate': {
      const opts = o as ToolOptions['rotate']
      return (
        <>
          <ChoiceField
            label={t('rotateAngle')}
            value={opts.angle}
            disabled={disabled}
            options={[
              { value: 90, label: t('rotateRight') },
              { value: 180, label: t('rotate180') },
              { value: 270, label: t('rotateLeft') },
            ]}
            onChange={(angle) => set({ angle })}
          />
          <PagesInput
            label="pagesRotate"
            value={opts.pages}
            disabled={disabled}
            t={t}
            onChange={(pages) => set({ pages })}
          />
        </>
      )
    }
    case 'reorder': {
      const opts = o as ToolOptions['reorder']
      const reversed = /^\s*reverse\s*$/i.test(opts.order)
      return (
        <>
          <Checkbox
            checked={reversed}
            disabled={disabled}
            label={t('reorderReverse')}
            onChange={(on) => set({ order: on ? 'reverse' : '' })}
          />
          {!reversed && (
            <Field label={t('reorderLabel')} hint={t('reorderHint')}>
              <input
                className="pt-input"
                value={opts.order}
                disabled={disabled}
                spellCheck={false}
                placeholder="3, 1-2, 4-"
                onChange={(e) => set({ order: e.target.value })}
              />
            </Field>
          )}
        </>
      )
    }
    case 'compress': {
      const opts = o as ToolOptions['compress']
      return (
        <ChoiceField
          label={t('compressLevel')}
          value={opts.level}
          disabled={disabled}
          options={[
            { value: 'strong', label: t('compressStrong'), desc: t('compressStrongDesc') },
            { value: 'balanced', label: t('compressBalanced'), desc: t('compressBalancedDesc') },
            { value: 'light', label: t('compressLight'), desc: t('compressLightDesc') },
          ]}
          onChange={(level) => set({ level })}
        />
      )
    }
    case 'images-to-pdf': {
      const opts = o as ToolOptions['images-to-pdf']
      const paper = opts.pageSize !== 'fit'
      return (
        <>
          <Field label={t('pageSize')}>
            <select
              className="pt-input pt-input-narrow"
              value={opts.pageSize}
              disabled={disabled}
              onChange={(e) =>
                set({ pageSize: e.target.value as ToolOptions['images-to-pdf']['pageSize'] })
              }
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
              <option value="a3">A3</option>
              <option value="a5">A5</option>
              <option value="fit">{t('pageSizeFit')}</option>
            </select>
          </Field>
          {paper && (
            <>
              <ChoiceField
                label={t('orientation')}
                value={opts.orientation}
                disabled={disabled}
                options={[
                  { value: 'auto', label: t('orientationAuto') },
                  { value: 'portrait', label: t('orientationPortrait') },
                  { value: 'landscape', label: t('orientationLandscape') },
                ]}
                onChange={(orientation) => set({ orientation })}
              />
              <ChoiceField
                label={t('margin')}
                value={opts.margin}
                disabled={disabled}
                options={[
                  { value: 0, label: t('marginNone') },
                  { value: 18, label: t('marginSmall') },
                  { value: 42, label: t('marginLarge') },
                ]}
                onChange={(margin) => set({ margin })}
              />
            </>
          )}
        </>
      )
    }
    case 'pdf-to-images': {
      const opts = o as ToolOptions['pdf-to-images']
      return (
        <>
          <ChoiceField
            label={t('imageFormat')}
            value={opts.format}
            disabled={disabled}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
            ]}
            onChange={(format) => set({ format })}
          />
          <ChoiceField
            label={t('resolution')}
            value={opts.dpi}
            disabled={disabled}
            options={[
              { value: 72, label: t('resolutionScreen') },
              { value: 150, label: t('resolutionStandard') },
              { value: 300, label: t('resolutionPrint') },
            ]}
            onChange={(dpi) => set({ dpi })}
          />
          {opts.format === 'jpeg' && (
            <Field label={`${t('jpegQuality')} · ${opts.quality}`}>
              <input
                type="range"
                min={30}
                max={100}
                value={opts.quality}
                disabled={disabled}
                onChange={(e) => set({ quality: Number(e.target.value) })}
              />
            </Field>
          )}
          <PagesInput
            label="pagesRender"
            value={opts.pages}
            disabled={disabled}
            t={t}
            onChange={(pages) => set({ pages })}
          />
        </>
      )
    }
    case 'protect': {
      const opts = o as ToolOptions['protect']
      return (
        <>
          <Field label={t('protectOpen')}>
            <PasswordInput
              value={opts.userPassword}
              disabled={disabled}
              t={t}
              onChange={(userPassword) => set({ userPassword })}
            />
          </Field>
          <Field label={t('protectRepeat')}>
            <PasswordInput
              value={props.repeat}
              disabled={disabled}
              t={t}
              onChange={props.onRepeat}
            />
          </Field>
          <Field label={t('protectOwner')} hint={t('protectOwnerHint')}>
            <PasswordInput
              value={opts.ownerPassword}
              disabled={disabled}
              t={t}
              onChange={(ownerPassword) => set({ ownerPassword })}
            />
          </Field>
          <div className="pt-checks">
            <Checkbox
              checked={opts.allowPrint}
              disabled={disabled}
              label={t('protectAllowPrint')}
              onChange={(allowPrint) => set({ allowPrint })}
            />
            <Checkbox
              checked={opts.allowCopy}
              disabled={disabled}
              label={t('protectAllowCopy')}
              onChange={(allowCopy) => set({ allowCopy })}
            />
            <Checkbox
              checked={opts.allowEdit}
              disabled={disabled}
              label={t('protectAllowEdit')}
              onChange={(allowEdit) => set({ allowEdit })}
            />
          </div>
        </>
      )
    }
    case 'unlock':
      return <p className="pt-note">{t('unlockHint')}</p>
    case 'flatten':
      return <p className="pt-note">{t('flattenHint')}</p>
    case 'repair':
      return <p className="pt-note">{t('repairHint')}</p>
    case 'watermark': {
      const opts = o as ToolOptions['watermark']
      return (
        <>
          <Field label={t('watermarkText')} hint={t('latinOnly')}>
            <input
              className="pt-input"
              value={opts.text}
              disabled={disabled}
              onChange={(e) => set({ text: e.target.value })}
            />
          </Field>
          <div className="pt-row">
            <Field label={t('fontSize')}>
              <input
                className="pt-input pt-input-narrow"
                type="number"
                min={6}
                max={400}
                value={opts.fontSize}
                disabled={disabled}
                onChange={(e) => set({ fontSize: Number(e.target.value) || 72 })}
              />
            </Field>
            <Field label={t('color')}>
              <input
                className="pt-color"
                type="color"
                value={opts.color}
                disabled={disabled}
                onChange={(e) => set({ color: e.target.value })}
              />
            </Field>
            <Field label={`${t('opacity')} · ${Math.round(opts.opacity * 100)}%`}>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(opts.opacity * 100)}
                disabled={disabled}
                onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
              />
            </Field>
          </div>
          <ChoiceField
            label={t('angle')}
            value={String(opts.rotation)}
            disabled={disabled}
            options={[
              { value: 'diagonal', label: t('angleDiagonal') },
              { value: '0', label: t('angleHorizontal') },
              { value: '90', label: t('angleVertical') },
            ]}
            onChange={(v) => set({ rotation: v === 'diagonal' ? 'diagonal' : Number(v) })}
          />
          <ChoiceField
            label={t('position')}
            value={opts.position}
            disabled={disabled}
            options={[
              { value: 'center', label: t('positionCenter') },
              { value: 'top', label: t('positionTop') },
              { value: 'bottom', label: t('positionBottom') },
            ]}
            onChange={(position) => set({ position })}
          />
          <PagesInput
            label="pagesStamp"
            value={opts.pages}
            disabled={disabled}
            t={t}
            onChange={(pages) => set({ pages })}
          />
        </>
      )
    }
    case 'page-numbers': {
      const opts = o as ToolOptions['page-numbers']
      return (
        <>
          <ChoiceField
            label={t('numberFormat')}
            value={opts.format}
            disabled={disabled}
            options={[
              { value: '{n}', label: '1' },
              { value: t('formatPage'), label: t('formatPage', { n: 1 }) },
              {
                value: t('formatPageOf'),
                label: t('formatPageOf', { n: 1, total: 'N' }),
              },
              { value: '- {n} -', label: '- 1 -' },
            ]}
            onChange={(format) => set({ format })}
          />
          <Field label={t('position')}>
            <select
              className="pt-input pt-input-narrow"
              value={opts.position}
              disabled={disabled}
              onChange={(e) =>
                set({ position: e.target.value as ToolOptions['page-numbers']['position'] })
              }
            >
              <option value="bottom-center">{t('posBottomCenter')}</option>
              <option value="bottom-right">{t('posBottomRight')}</option>
              <option value="bottom-left">{t('posBottomLeft')}</option>
              <option value="top-center">{t('posTopCenter')}</option>
              <option value="top-right">{t('posTopRight')}</option>
              <option value="top-left">{t('posTopLeft')}</option>
            </select>
          </Field>
          <div className="pt-row">
            <Field label={t('numberStart')}>
              <input
                className="pt-input pt-input-narrow"
                type="number"
                value={opts.firstNumber}
                disabled={disabled}
                onChange={(e) => set({ firstNumber: Math.trunc(Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label={t('fontSize')}>
              <input
                className="pt-input pt-input-narrow"
                type="number"
                min={6}
                max={72}
                value={opts.fontSize}
                disabled={disabled}
                onChange={(e) => set({ fontSize: Number(e.target.value) || 11 })}
              />
            </Field>
          </div>
          <PagesInput
            label="pagesNumber"
            value={opts.pages}
            disabled={disabled}
            t={t}
            onChange={(pages) => set({ pages })}
          />
        </>
      )
    }
    case 'ocr': {
      const opts = o as ToolOptions['ocr']
      return (
        <>
          <p className="pt-note">{t('ocrHint')}</p>
          <PagesInput
            label="pages"
            value={opts.pages}
            disabled={disabled}
            t={t}
            onChange={(pages) => set({ pages })}
          />
        </>
      )
    }
    case 'properties': {
      const opts = o as ToolOptions['properties']
      const fields: { key: keyof ToolOptions['properties']; label: ToolStringKey }[] = [
        { key: 'title', label: 'propTitle' },
        { key: 'author', label: 'propAuthor' },
        { key: 'subject', label: 'propSubject' },
        { key: 'keywords', label: 'propKeywords' },
      ]
      return (
        <>
          {fields.map((f) => (
            <Field key={f.key} label={t(f.label)}>
              <input
                className="pt-input"
                value={opts[f.key] ?? ''}
                disabled={disabled}
                onChange={(e) => set({ [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <p className="pt-note">{t('propertiesOneFile')}</p>
        </>
      )
    }
    case 'merge':
    case 'extract-images':
      return null
  }
}
