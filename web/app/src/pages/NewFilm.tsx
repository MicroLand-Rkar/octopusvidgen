import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type ChatMsg, type ProjectCard, type Style } from '../api';
import { SourceFields, accepts, type SourceValues } from './SourceFields';
import { AttachTray, DropOverlay, checkFiles, pastedFiles, useDropZone } from './Attachments';
import { LANGS, useT } from '../i18n';

const ASPECTS = ['16:9', '9:16', '1:1', '4:5'];
/** Styles made for a phone screen start in 9:16. */
const VERTICAL = new Set(['hf-vertical']);
/** Styles whose narration is Thai by default. */
const THAI_VOICE = new Set(['doc-mix']);
/** Most files one plan can carry. */
const MAX_ATTACH = 20;

export function NewFilm() {
  const { t, ts, examples, langName } = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [styles, setStyles] = useState<Style[]>([]);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [projectId, setProjectId] = useState<string>(params.get('project') ?? '');
  const [newProject, setNewProject] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [slug, setSlug] = useState<string | null>(params.get('style'));
  const [duration, setDuration] = useState(30);
  const [aspect, setAspect] = useState(VERTICAL.has(params.get('style') ?? '') ? '9:16' : '16:9');
  const [language, setLanguage] = useState(THAI_VOICE.has(params.get('style') ?? '') ? 'Thai' : langName);
  const [sources, setSources] = useState<SourceValues>({ text: {}, files: {} });
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // A wish handed over from another page (a TikTok trend idea) starts in the chat box.
  const [draft, setDraft] = useState(params.get('wish') ?? '');
  const [brief, setBrief] = useState('');
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Files waiting to go with the next message, and those already sent in the chat.
  const [pending, setPending] = useState<File[]>([]);
  const [sentFiles, setSentFiles] = useState<File[]>([]);

  useEffect(() => {
    api.styles().then(setStyles).catch((e) => setError(e.message));
    api.projects().then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(styles.map((s) => s.category_en))).sort()], [styles]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return styles.filter(
      (s) =>
        (category === 'All' || s.category_en === category) &&
        (!q || [s.en, s.cn, s.slug, s.line, ...s.uses].some((w) => w.toLowerCase().includes(q))),
    );
  }, [styles, query, category]);
  const chosen = styles.find((s) => s.slug === slug) ?? null;
  const keys = useMemo(() => new Set(chosen?.inputs.fields.map((f) => f.key)), [chosen]);
  const attached = chosen
    ? chosen.inputs.fields
        .filter((f) => (f.kind === 'files' ? sources.files[f.key]?.length : sources.text[f.key]?.trim()))
        .map((f) => f.label)
    : [];

  function addFiles(list: File[]) {
    if (!chosen) return setError(t('new.styleBeforeFiles'));
    const { ok, error: e } = checkFiles(list, t);
    const room = MAX_ATTACH - pending.length - sentFiles.length;
    if (ok.length > room) setError(t('new.maxFiles', { max: MAX_ATTACH }));
    else setError(e);
    setPending([...pending, ...ok.slice(0, Math.max(0, room))]);
  }
  const drop = useDropZone(addFiles, !!chosen);

  async function send(text: string) {
    const files = pending;
    let msg = text.trim();
    if ((!msg && !files.length) || !chosen || thinking) return;
    // Claude sees what was attached by name and type (it opens the files themselves when it makes the film).
    if (files.length) {
      const list = files.map((f) => `${f.name} (${f.type || 'file'}, ${Math.max(1, Math.round(f.size / 1024))} KB)`).join(', ');
      msg = `${msg || t('new.filesNote')}\n📎 ${list}`;
    }
    const next: ChatMsg[] = [...messages, { role: 'client', text: msg }];
    setMessages(next);
    setSentFiles([...sentFiles, ...files]);
    setPending([]);
    setDraft('');
    setError(null);
    setThinking(true);
    try {
      const r = await api.plan({
        style_slug: chosen.slug,
        duration_s: duration,
        aspect,
        language,
        material: [...attached, ...[...sentFiles, ...files].map((f) => `attached file ${f.name}`)],
        messages: next,
        project_id: projectId || null,
        chat_lang: langName,
        make_label: t('new.make'),
      });
      setMessages([...next, { role: 'claude', text: r.reply }]);
      setBrief(r.brief);
      setReady(r.ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('new.noReply'));
    } finally {
      setThinking(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  async function make(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!chosen) return setError(t('new.pickStyle'));
    const wishes = messages.filter((m) => m.role === 'client');
    if (!wishes.length) return setError(t('new.tellFirst'));
    // Files dropped into the chat count for a required file field when they are the right type.
    let dropped = [...sentFiles, ...pending];
    const fieldFiles: Record<string, File[]> = { ...sources.files };
    for (const f of chosen.inputs.fields) {
      if (f.required && f.kind === 'files' && !fieldFiles[f.key]?.length) {
        const fit = dropped.filter((x) => accepts(f.accept, x)).slice(0, f.max_files ?? 10);
        if (fit.length) {
          fieldFiles[f.key] = fit;
          dropped = dropped.filter((x) => !fit.includes(x));
        }
      }
    }
    const missing = chosen.inputs.fields.find(
      (f) => f.required && !(f.kind === 'files' ? fieldFiles[f.key]?.length : sources.text[f.key]?.trim()),
    );
    if (missing) return setError(t('new.needField', { field: ts(missing.label) }));
    const chat = messages.map((m) => `${m.role === 'client' ? 'Client' : 'Claude'}: ${m.text}`).join('\n\n');
    const prompt =
      (brief.trim()
        ? `Agreed brief (written with the client in the chat below${ready ? '' : '; a few points were still open, decide them yourself'}):\n${brief.trim()}\n\nThe planning chat:\n${chat}`
        : `The planning chat:\n${chat}`) + `\n\nChat language: ${langName}`;
    setBusy(true);
    try {
      // Only this style's fields go up (the user may have filled others before switching style).
      const text = Object.fromEntries(Object.entries(sources.text).filter(([k, v]) => keys.has(k) && v.trim()));
      const files: Record<string, File[]> = Object.fromEntries(
        Object.entries(fieldFiles).filter(([k, v]) => keys.has(k) && v.length),
      );
      if (dropped.length) files.attachments = dropped;
      const job = await api.createJob({ style_slug: chosen.slug, prompt, duration_s: duration, aspect, language, inputs: text, project_id: projectId || null }, files);
      nav(`/films/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('new.startFailed'));
      setBusy(false);
    }
  }

  function resetPlan() {
    setMessages([]);
    // Keep the files: they go back to waiting for the next message.
    setPending((p) => [...sentFiles, ...p]);
    setSentFiles([]);
    setBrief('');
    setReady(false);
    setError(null);
  }

  function pick(s: Style) {
    if (s.slug === slug) return;
    setSlug(s.slug);
    if (VERTICAL.has(s.slug)) setAspect('9:16');
    if (THAI_VOICE.has(s.slug)) setLanguage('Thai');
    // A new style means a new plan.
    resetPlan();
  }

  const hasWish = messages.some((m) => m.role === 'client');

  return (
    <form className="new" onSubmit={make}>
      <section className="new__styles" aria-labelledby="pick-h">
        <div className="new__head">
          <h1 id="pick-h">{t('new.step1')}</h1>
          <input
            type="search"
            placeholder={t('new.searchPlaceholder')}
            aria-label={t('new.searchLabel')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label={t('new.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'All' ? t('new.all', { n: styles.length }) : ts(c)}
              </option>
            ))}
          </select>
        </div>
        <ul className="styles" role="listbox" aria-label={t('new.stylesLabel')}>
          {shown.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                role="option"
                aria-selected={slug === s.slug}
                className={`style ${slug === s.slug ? 'is-on' : ''}`}
                onClick={() => pick(s)}
              >
                <span className="style__img">
                  {s.has_poster ? <img src={api.posterUrl(s.slug)} alt="" loading="lazy" /> : <span>{s.en}</span>}
                  {s.license && <span className="badge badge--nc">NC</span>}
                  {s.needs_image_gen && (
                    <span className={`badge ${s.image_tool === 'chrome-flow' ? 'badge--flow' : 'badge--off'}`}>
                      {s.image_tool === 'chrome-flow' ? t('new.badgeFlow') : t('new.badgeNoGen')}
                    </span>
                  )}
                </span>
                <b>{s.en}</b>
                <span className="muted small">{ts(s.category_en)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className={`chat ${drop.over ? 'is-dropping' : ''}`} aria-labelledby="brief-h" {...drop.zone}>
        <DropOverlay show={drop.over} text={t('new.dropHere')} />
        <div className="chat__top">
          <h2 id="brief-h">{t('new.step2')}</h2>
          <div className="projectpick">
            <label htmlFor="proj">{t('new.project')}</label>
            {newProject === null ? (
              <select
                id="proj"
                value={projectId}
                onChange={(e) => {
                  if (e.target.value === '__new') return setNewProject('');
                  setProjectId(e.target.value);
                  resetPlan();
                }}
              >
                <option value="">{t('new.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {t('new.episode', { n: p.episodes + 1 })}
                  </option>
                ))}
                <option value="__new">{t('new.newProject')}</option>
              </select>
            ) : (
              <div className="projectpick__new">
                <input autoFocus maxLength={80} value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder={t('new.projectName')} />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!newProject.trim()}
                  onClick={async () => {
                    try {
                      const p = await api.createProject(newProject);
                      setProjects([{ ...p, episodes: 0, latest_job_id: null, latest_style: null, latest_has_video: false, updated_at: p.created_at }, ...projects]);
                      setProjectId(p.id);
                      setNewProject(null);
                      resetPlan();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('new.projectFailed'));
                    }
                  }}
                >
                  {t('new.create')}
                </button>
                <button type="button" className="linkbtn small" onClick={() => setNewProject(null)}>
                  {t('new.cancel')}
                </button>
              </div>
            )}
          </div>
          {chosen ? (
            <div className="chosen">
              {chosen.has_poster && <img src={api.posterUrl(chosen.slug)} alt="" />}
              <div>
                <b>{chosen.en}</b>
                <p className="muted small">{ts(chosen.line)}</p>
              </div>
            </div>
          ) : null}
          {chosen?.needs_image_gen ? (
            chosen.image_tool === 'chrome-flow' ? (
              <p className="flow-note">
                <b>{t('new.flowTitle')}</b> {t('new.flowBody')}
              </p>
            ) : (
              <p className="flow-note flow-note--off">
                {t('new.noGen')}
              </p>
            )
          ) : null}
          {chosen?.license ? (
            <p className="flow-note flow-note--off" title={chosen.license}>
              ⚠ {t('new.ncBefore')}<b>{t('new.ncStrong')}</b>{t('new.ncAfter')}
            </p>
          ) : null}
          {!chosen && <p className="muted small">{t('new.pickLeft')}</p>}
          <div className="settings">
            <label>
              <span>{t('new.duration')}</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 20, 30, 45, 60, 90, 120, 180].map((d) => (
                  <option key={d} value={d}>
                    {t('new.seconds', { n: d })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('new.aspect')}</span>
              <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {ASPECTS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('new.language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.name}>
                    {l.native}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="chat__thread" ref={threadRef} aria-live="polite">
          {chosen && (
            <div className="bubble bubble--claude">
              {t('new.hello', { style: chosen.en })}
            </div>
          )}
          {chosen && !hasWish && examples(chosen.slug).length > 0 && (
            <div className="samples">
              <span className="muted small">{t('new.samples')}</span>
              {examples(chosen.slug).map((ex) => (
                <button key={ex} type="button" className="sample" onClick={() => send(ex)} disabled={thinking}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble bubble--${m.role}`}>
              {m.text}
            </div>
          ))}
          {thinking && (
            <div className="bubble bubble--claude bubble--wait">
              <span className="spinner" aria-hidden="true" /> {t('new.thinking')}
            </div>
          )}
          {brief && (
            <details className="plan">
              <summary>{ready ? t('new.planReady') : t('new.planDraft')}</summary>
              <p className="small">{brief}</p>
            </details>
          )}
        </div>

        <div className="chat__bottom">
          {chosen && (
            <details className="material">
              <summary>
                {t('new.material')}
                {chosen.inputs.fields.some((f) => f.required && !attached.includes(f.label)) && (
                  <span className="req">
                    {' · '}
                    {t('new.needs', { list: chosen.inputs.fields.filter((f) => f.required).map((f) => ts(f.label)).join(t('new.listSep')) })}
                  </span>
                )}
                <span className="muted small">
                  {' · '}
                  {attached.length ? t('new.attachedCount', { n: attached.length }) : t('new.materialHint')}
                </span>
              </summary>
              <SourceFields style={chosen} values={sources} onChange={setSources} />
            </details>
          )}
          <AttachTray files={pending} onRemove={(i) => setPending(pending.filter((_, j) => j !== i))} />
          <div className="composer composer--files">
            <button
              type="button"
              className="btn btn--ghost attach"
              aria-label={t('new.attach')}
              title={t('new.attachTitle')}
              disabled={!chosen}
              onClick={() => fileRef.current?.click()}
            >
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
              disabled={!chosen}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onPaste={(e) => {
                const f = pastedFiles(e);
                if (f.length) addFiles(f);
              }}
              aria-label={t('new.messageLabel')}
              placeholder={chosen ? t('new.placeholder') : t('new.pickStyleShort')}
            />
            <button
              type="button"
              className="btn btn--ghost send"
              onClick={() => send(draft)}
              disabled={(!draft.trim() && !pending.length) || !chosen || thinking}
            >
              {t('new.send')}
            </button>
          </div>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary btn--full" type="submit" disabled={busy || thinking || !hasWish}>
            {busy
              ? Object.values(sources.files).some((f) => f.length)
                ? t('new.uploading')
                : t('new.starting')
              : ready
                ? t('new.make')
                : hasWish
                  ? t('new.makeRest')
                  : t('new.make')}
          </button>
        </div>
      </aside>
    </form>
  );
}
