import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useT } from '../i18n';

type T = ReturnType<typeof useT>['t'];

const MAX_FILE = 500 * 1024 * 1024;

/** Lets a whole panel take dropped files, like a chat app: returns the handlers to spread on it
 *  and whether files are being dragged over it. */
export function useDropZone(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    over: enabled && over,
    zone: {
      onDragEnter: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

/** Files pasted into a text box (screenshots, copied images). */
export function pastedFiles(e: ClipboardEvent): File[] {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length) e.preventDefault();
  // Pasted screenshots all arrive as "image.png": give them distinct names.
  return files.map((f, i) =>
    f.name === 'image.png' ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f,
  );
}

/** Keeps files under the size limit; returns the kept ones and a message about any left out. */
export function checkFiles(files: File[], t: T): { ok: File[]; error: string | null } {
  const big = files.filter((f) => f.size > MAX_FILE);
  return {
    ok: files.filter((f) => f.size <= MAX_FILE && f.size > 0),
    error: big.length ? t('att.tooBig', { names: big.map((f) => f.name).join(', ') }) : null,
  };
}

/** The files waiting to go with the next message: image thumbnails, other files as named chips. */
export function AttachTray({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const { t } = useT();
  const urls = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  if (!files.length) return null;
  return (
    <ul className="tray" aria-label={t('att.trayLabel')}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="tray__item" title={f.name}>
          {urls[i] ? (
            <img src={urls[i]!} alt="" />
          ) : (
            <span className="tray__icon" aria-hidden="true">
              {icon(f)}
            </span>
          )}
          <span className="tray__name">{f.name}</span>
          <span className="tray__size">{size(f.size)}</span>
          <button type="button" className="tray__x" aria-label={t('att.remove', { name: f.name })} onClick={() => onRemove(i)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The overlay shown while files are dragged over a panel. */
export function DropOverlay({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return (
    <div className="dropover" aria-hidden="true">
      <span>⬇︎</span>
      <b>{text}</b>
    </div>
  );
}

function icon(f: File) {
  if (f.type.startsWith('video/')) return '🎬';
  if (f.type.startsWith('audio/')) return '🎵';
  if (f.type === 'application/pdf') return '📄';
  if (/\.(csv|xlsx?|json)$/i.test(f.name)) return '📊';
  return '📎';
}

function size(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
