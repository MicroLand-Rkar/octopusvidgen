import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, filmTitle, type Job, type JobChat, type JobProgress, type ProjectCard } from '../api';
import { StatusChip } from './StatusChip';
import { AttachTray, DropOverlay, checkFiles, pastedFiles, useDropZone } from './Attachments';
import { useT } from '../i18n';

export function FilmPage() {
  const { t } = useT();
  const { id = '' } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [chat, setChat] = useState<JobChat | null>(null);
  const [written, setWritten] = useState('');
  const [prog, setProg] = useState<JobProgress | null>(null);
  const [extra, setExtra] = useState<{ name: string; size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a reply re-queues the film, so polling starts again.
  const [tick, setTick] = useState(0);
  const [projects, setProjects] = useState<ProjectCard[]>([]);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const [j, c, b, p, f] = await Promise.all([
          api.job(id),
          api.jobChat(id).catch(() => null),
          api.jobBrief(id).catch(() => ''),
          api.jobProgress(id).catch(() => null),
          api.jobFiles(id).catch(() => []),
        ]);
        if (stop) return;
        setJob(j);
        setChat(c);
        setWritten(b);
        setProg(p);
        setExtra(f);
        if (j.status === 'queued' || j.status === 'running') timer = window.setTimeout(load, 3000);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : '');
      }
    };
    load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id, tick]);

  if (error !== null) return <p className="error">{error || t('film.loadError')}</p>;
  if (!job) return <p className="muted">{t('film.loading')}</p>;
  const live = job.status === 'queued' || job.status === 'running';

  return (
    <div className="filmlayout">
      <div className="filmpage">
        <p className="small">
          {job.project_id ? (
            <Link to={`/projects/${job.project_id}`}>← {projects.find((p) => p.id === job.project_id)?.name ?? t('film.projectFallback')}</Link>
          ) : (
            <Link to="/projects/single">← {t('film.backSingle')}</Link>
          )}
        </p>
        <div className="page-head">
          <h1>{filmTitle(job.prompt)}</h1>
          <StatusChip status={job.status} />
        </div>
        <div className="filmmeta">
          <span className="muted small">
            {job.style_slug} · {job.duration_s} s · {job.aspect} · {job.language}
          </span>
          <label className="small muted">
            {t('film.projectLabel')}{' '}
            <select
              className="inline-select"
              value={job.project_id ?? ''}
              onChange={async (e) => setJob({ ...job, ...(await api.moveJob(job.id, e.target.value || null)) })}
            >
              <option value="">{t('film.noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`player player--${job.aspect.replace(':', 'x')}`}>
          {job.has_video ? (
            <video src={api.videoUrl(job.id)} controls playsInline preload="metadata" />
          ) : (
            <div className="player__wait">
              {live ? (
                <div className="wait-pct">
                  <b>{job.status === 'queued' ? '…' : `${prog?.percent ?? 0}%`}</b>
                  <span>{job.status === 'queued' ? t('film.queuedWait') : t('film.making')}</span>
                </div>
              ) : (
                <span>
                  {job.status === 'failed' ? t('film.failedNote') : t('film.canceledNote')}
                </span>
              )}
            </div>
          )}
        </div>

        {prog && job.status !== 'canceled' && <ProgressCard p={prog} status={job.status} />}

        <div className="btn-row">
          {job.has_video && (
            <a className="btn btn--primary" href={api.videoUrl(job.id)} download={`film-${job.id.slice(0, 8)}.mp4`}>
              {t('film.downloadMp4')}
            </a>
          )}
          {extra.map((f) => (
            <a key={f.name} className="btn btn--ghost" href={api.fileUrl(job.id, f.name)} download={f.name} title={t('film.sizeKb', { n: Math.max(1, Math.round(f.size / 1024)) })}>
              {t('film.downloadFile', { name: f.name })}
            </a>
          ))}
          {live && (
            <button className="btn btn--ghost" type="button" onClick={async () => setJob(await api.cancelJob(job.id))}>
              {t('film.cancel')}
            </button>
          )}
        </div>

        {written && (
          <details className="brief-box">
            <summary>
              <h2>{t('film.briefTitle')}</h2>
            </summary>
            <p className="pre small">{written}</p>
          </details>
        )}

        {Object.keys(job.inputs ?? {}).length > 0 && (
          <section className="brief-box">
            <h2>{t('film.inputsTitle')}</h2>
            <ul className="inputs">
              {Object.entries(job.inputs).map(([k, v]) => (
                <li key={k}>
                  <span className="muted small">{k.replace(/_/g, ' ')}</span>
                  <span>{v.text ?? v.files?.join(', ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <FilmChat
        job={job}
        chat={chat}
        onSent={(c, requeued) => {
          setChat(c);
          if (requeued) setTick((t) => t + 1);
        }}
      />
    </div>
  );
}

function FilmChat({
  job,
  chat,
  onSent,
}: {
  job: Job;
  chat: JobChat | null;
  onSent: (c: JobChat, requeued: boolean) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = job.status === 'queued' || job.status === 'running';
  const count = chat?.messages.length ?? 0;
  function addFiles(list: File[]) {
    const { ok, error: e } = checkFiles(list, t);
    setErr(e);
    setFiles((cur) => [...cur, ...ok]);
  }
  const drop = useDropZone(addFiles);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [count, chat?.question]);

  async function send() {
    if ((!draft.trim() && !files.length) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await api.sendChat(job.id, draft, files);
      setDraft('');
      setFiles([]);
      onSent(c, !live);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('film.sendError'));
    } finally {
      setBusy(false);
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const question = chat?.question;
  const placeholder = question
    ? t('film.phQuestion')
    : live
      ? t('film.phLive')
      : job.status === 'succeeded'
        ? t('film.phSucceeded')
        : t('film.phResume');

  return (
    <aside className={`chat chat--film ${drop.over ? 'is-dropping' : ''}`} aria-label={t('film.chatTitle')} {...drop.zone}>
      <DropOverlay show={drop.over} text={t('film.dropHere')} />
      <div className="chat__top">
        <h2>{t('film.chatTitle')}</h2>
        <p className="muted small">
          {live
            ? `✓ ${t('film.chatLive')}`
            : t('film.chatIdle')}
        </p>
      </div>
      <div className="chat__thread" ref={threadRef} aria-live="polite">
        {chat?.messages.map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role} bubble--k-${m.kind}`}>
            {m.kind === 'plan' && i === 0 && <span className="bubble__tag">{t('film.tagPlan')}</span>}
            {m.kind === 'answer' && <span className="bubble__tag">{t('film.tagAnswer')}</span>}
            {m.kind === 'note' && <span className="bubble__tag">{t('film.tagNote')}</span>}
            {m.text}
            {m.files && m.files.length > 0 && <span className="bubble__files">📎 {m.files.join(', ')}</span>}
          </div>
        ))}
        {live && !question && (
          <div className="bubble bubble--claude bubble--wait">
            <span className="spinner" aria-hidden="true" /> {job.status === 'queued' ? t('film.queuedWait') : t('film.working')}
          </div>
        )}
      </div>
      <div className="chat__bottom">
        {question && (
          <div className="ask">
            <b>❓ {t('film.askHead')}</b>
            <p>{question}</p>
          </div>
        )}
        <AttachTray files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
        <div className="composer composer--files">
          <button type="button" className="btn btn--ghost attach" aria-label={t('film.attach')} onClick={() => fileRef.current?.click()}>
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <textarea
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const f = pastedFiles(e);
              if (f.length) addFiles(f);
            }}
            placeholder={placeholder}
            aria-label={t('film.sendLabel')}
          />
          <button type="button" className="btn btn--primary send" onClick={send} disabled={busy || (!draft.trim() && !files.length)}>
            {busy ? '…' : t('film.send')}
          </button>
        </div>
        {err && <p className="error small">{err}</p>}
      </div>
    </aside>
  );
}

const STAGES = new Set(['read', 'plan', 'images', 'build', 'render', 'finish']);

function clock(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ProgressCard({ p, status }: { p: JobProgress; status: Job['status'] }) {
  const live = status === 'running' || status === 'queued';
  const failed = status === 'failed';
  const { t } = useT();
  return (
    <section className={`progress ${failed ? 'progress--failed' : ''}`} aria-label={t('film.progressLabel')}>
      <div className="progress__head">
        <b>
          {status === 'succeeded'
            ? t('film.headDone')
            : failed
              ? t('film.headFailed')
              : status === 'queued'
                ? t('film.headQueued')
                : t('film.headRunning')}
        </b>
        <span className="muted small">
          {t(live ? 'film.elapsedLive' : 'film.elapsedDone', { time: clock(p.elapsed_s) })} · {t('film.steps', { n: p.steps })}
        </span>
        {!failed && <b className="progress__pct">{p.percent}%</b>}
      </div>
      {!failed && (
      <div className="bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
        <div className={`bar-fill ${live ? 'is-live' : ''}`} style={{ width: `${p.percent}%` }} />
      </div>
      )}
      <ol className="steps">
        {p.stages.map((st) => (
          <li key={st.key} className={`step step--${failed && st.state === 'active' ? 'failed' : st.state}`}>
            <span className="step__dot" aria-hidden="true">
              {st.state === 'done' ? '✓' : st.state === 'active' ? '' : ''}
            </span>
            <span>
              {STAGES.has(st.key) ? t(`film.stage.${st.key}`) : st.key}
              {st.key === 'images' && p.images > 0 && <span className="muted"> · {t('film.imagesGot', { n: p.images })}</span>}
            </span>
          </li>
        ))}
      </ol>
      {live && p.doing && (
        <p className="progress__doing small">
          <span className="muted">{t('film.now')} · </span>
          {p.doing}
        </p>
      )}
      {live && <p className="hint">{t('film.estimateHint')}</p>}
    </section>
  );
}
