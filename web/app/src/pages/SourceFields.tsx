import { useRef, useState, type DragEvent } from 'react';
import type { InputField, Style } from '../api';
import { useT } from '../i18n';

export type SourceValues = { text: Record<string, string>; files: Record<string, File[]> };

const MAX_FILE = 500 * 1024 * 1024;

/** The material a style can work from: its note, then one field per thing the user can bring. */
export function SourceFields({
  style,
  values,
  onChange,
}: {
  style: Style;
  values: SourceValues;
  onChange: (v: SourceValues) => void;
}) {
  const { t, ts } = useT();
  const { material, agent_can_source, fields } = style.inputs;
  const note = ts(style.inputs.note);
  const own = fields.filter((f) => !f.common);
  const common = fields.filter((f) => f.common);
  const [showCommon, setShowCommon] = useState(false);

  const setText = (k: string, v: string) => onChange({ ...values, text: { ...values.text, [k]: v } });
  const setFiles = (k: string, v: File[]) => onChange({ ...values, files: { ...values.files, [k]: v } });

  return (
    <div className="sources">
      <div className="sources__head">
        <span className={`tag tag--${material}`}>{t(`src.material.${material}`)}</span>
      </div>
      {note && <p className="muted small">{note}</p>}
      {material !== 'none' && agent_can_source && (
        <p className="small ok">{t('src.canSource')}</p>
      )}
      {own.map((f) => (
        <Field key={f.key} f={f} values={values} setText={setText} setFiles={setFiles} />
      ))}
      {common.length > 0 && (
        <>
          <button type="button" className="linkbtn small" aria-expanded={showCommon} onClick={() => setShowCommon(!showCommon)}>
            {showCommon ? t('src.closeCommon') : t('src.openCommon')}
          </button>
          {showCommon &&
            common.map((f) => <Field key={f.key} f={f} values={values} setText={setText} setFiles={setFiles} />)}
        </>
      )}
    </div>
  );
}

function Field({
  f,
  values,
  setText,
  setFiles,
}: {
  f: InputField;
  values: SourceValues;
  setText: (k: string, v: string) => void;
  setFiles: (k: string, v: File[]) => void;
}) {
  const { t, ts } = useT();
  const id = `src-${f.key}`;
  const hint = ts(f.hint);
  const label = (
    <label htmlFor={id}>
      {ts(f.label)}
      {f.required ? <span className="req"> {t('src.required')}</span> : <span className="muted"> {t('src.optional')}</span>}
    </label>
  );
  if (f.kind !== 'files') {
    return (
      <div className="field">
        {label}
        <input
          id={id}
          type={f.kind === 'url' ? 'url' : 'text'}
          inputMode={f.kind === 'url' ? 'url' : undefined}
          placeholder={f.kind === 'url' ? 'https://' : undefined}
          value={values.text[f.key] ?? ''}
          onChange={(e) => setText(f.key, e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {hint && (
          <p className="hint" id={`${id}-hint`}>
            {hint}
          </p>
        )}
      </div>
    );
  }
  return <FileField f={f} id={id} label={label} files={values.files[f.key] ?? []} setFiles={(v) => setFiles(f.key, v)} />;
}

function FileField({
  f,
  id,
  label,
  files,
  setFiles,
}: {
  f: InputField;
  id: string;
  label: JSX.Element;
  files: File[];
  setFiles: (v: File[]) => void;
}) {
  const { t, ts } = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const max = f.max_files ?? 10;

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= max) {
        setErr(t('src.maxFiles', { max }));
        break;
      }
      if (file.size > MAX_FILE) {
        setErr(t('src.tooBig', { name: file.name }));
        continue;
      }
      if (!accepts(f.accept, file)) {
        setErr(t('src.badType', { name: file.name }));
        continue;
      }
      next.push(file);
      setErr(null);
    }
    setFiles(next);
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="field">
      {label}
      <div
        className={`drop ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => ref.current?.click()}>
          {t('src.choose')}
        </button>
        <span className="muted small">{t('src.dropOr', { types: describeAccept(f.accept) ?? t('src.anyFile'), max })}</span>
        <input
          ref={ref}
          id={id}
          type="file"
          hidden
          multiple={max > 1}
          accept={f.accept || undefined}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {f.hint && <p className="hint">{ts(f.hint)}</p>}
      {err && <p className="error small">{err}</p>}
      {files.length > 0 && (
        <ul className="filelist">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <span>{file.name}</span>
              <span className="muted">{formatSize(file.size)}</span>
              <button
                type="button"
                className="linkbtn"
                aria-label={t('src.removeLabel', { name: file.name })}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                {t('src.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function accepts(accept: string, file: File) {
  if (!accept.trim()) return true;
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith('.') ? a === ext : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : a === file.type));
}

/** Readable list of accepted types ("image, PDF"), or null when any file is fine. */
function describeAccept(accept: string): string | null {
  if (!accept.trim()) return null;
  const parts = accept.split(',').map((a) => a.trim());
  const nice = parts.map((a) => (a.endsWith('/*') ? a.slice(0, -2) : a.startsWith('.') ? a.slice(1).toUpperCase() : a.split('/').pop()!.toUpperCase()));
  return Array.from(new Set(nice)).slice(0, 5).join(', ');
}

function formatSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
