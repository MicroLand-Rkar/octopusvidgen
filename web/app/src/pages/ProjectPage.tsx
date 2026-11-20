import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, filmTitle, type ChatMsg, type Job, type MediaItem, type ProjectDetail, type ProjectMedia, type Style } from '../api';
import { LANGS, useT } from '../i18n';
import { DropOverlay, checkFiles, pastedFiles, useDropZone } from './Attachments';
import { StatusChip } from './StatusChip';

type Filter = 'all' | 'films' | 'refs' | 'made';
const ASPECTS = ['16:9', '9:16', '1:1', '4:5'];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180];

/** One project, laid out like a media board: the films (episodes), the references the client collected
 *  and what Claude made for the series, all in one grid; a prompt bar at the bottom makes the next film
 *  from a few lines and the references picked on the board. The id "single" lists films with no project. */
export function ProjectPage() {
  const { t, langName, ts } = useT();
  const nav = useNavigate();
  const { id = '' } = useParams();
  const single = id === 'single';
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [films, setFilms] = useState<Job[] | null>(null);
  const [media, setMedia] = useState<ProjectMedia>({ refs: [], assets: [] });
  const [styles, setStyles] = useState<Style[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [showBible, setShowBible] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.styles().then(setStyles).catch(() => {});
  }, []);

  const loadMedia = useCallback(() => {
    if (!single) api.projectMedia(id).then(setMedia).catch(() => {});
  }, [id, single]);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const [p, all] = await Promise.all([single ? Promise.resolve(null) : api.project(id), api.jobs()]);
        if (stop) return;
        setProject(p);
        // Newest first on the board, like a feed of takes.
        const mine = all.filter((j) => (single ? !j.project_id : j.project_id === id));
        setFilms(mine);
        if (mine.some((j) => j.status === 'queued' || j.status === 'running')) {
          timer = window.setTimeout(() => {
            load();
            loadMedia();
          }, 5000);
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : t('projects.loadError'));
      }
    };
    load();
    loadMedia();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id, single, loadMedia]);

  const byStyle = useMemo(() => Object.fromEntries(styles.map((s) => [s.slug, s])), [styles]);

  async function upload(list: File[]) {
    if (single) return;
    const { ok, error: e } = checkFiles(list, t);
    setError(e);
    if (!ok.length) return;
    setUploading((n) => n + ok.length);
    try {
      const names = await api.addRefs(id, ok);
      // New references are picked for the next film straight away.
      setPicked((p) => [...p, ...names.map((n) => `refs/${n}`)]);
      loadMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('board.uploadError'));
    } finally {
      setUploading((n) => n - ok.length);
    }
  }
  const drop = useDropZone(upload, !single);

  async function removeRef(m: MediaItem) {
    if (!window.confirm(t('board.deleteConfirm', { name: m.name }))) return;
    try {
      await api.removeRef(id, m.name);
      setPicked((p) => p.filter((x) => x !== m.path));
      setOpen(null);
      loadMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('board.deleteError'));
    }
  }

  function toggle(path: string) {
    setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));
  }

  async function save() {
    if (!project) return;
    try {
      const p = await api.updateProject(project.id, name, desc);
      setProject({ ...project, ...p });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('projects.saveError'));
    }
  }

  const all = [...media.refs, ...media.assets];
  const pickedItems = picked.map((p) => all.find((m) => m.path === p)).filter((m): m is MediaItem => !!m);
  const showFilms = filter === 'all' || filter === 'films';
  const showRefs = filter === 'all' || filter === 'refs';
  const showMade = filter === 'all' || filter === 'made';
  const lastStyle = films?.[0]?.style_slug ?? null;
  const counts = { films: films?.length ?? 0, refs: media.refs.length, made: media.assets.length };
  const empty = films !== null && counts.films + counts.refs + counts.made === 0;

  return (
    <div className={`projlayout ${single ? 'is-single' : ''}`}>
    <div className={`board ${drop.over ? 'is-dropping' : ''}`} {...drop.zone}>
      <DropOverlay show={drop.over} text={t('board.dropHere')} />
      <div className="board__head">
        <div className="board__title">
          <Link className="small muted" to="/">
            {t('projects.back')}
          </Link>
          {editing && project ? (
            <div className="newproject">
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label={t('projects.nameLabel')} />
              <textarea rows={2} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label={t('projects.descLabel')} />
              <div className="btn-row" style={{ margin: 0 }}>
                <button className="btn btn--primary btn--sm" type="button" onClick={save}>
                  {t('projects.save')}
                </button>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(false)}>
                  {t('projects.cancelEdit')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1>{single ? t('projects.singles') : project?.name ?? '…'}</h1>
              {project?.description && (
                <p className={`muted small board__desc ${more ? 'is-open' : ''}`} onClick={() => setMore(!more)} title={more ? '' : project.description}>
                  {project.description}
                </p>
              )}
            </>
          )}
        </div>
        <div className="board__tools">
          {project && !editing && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setName(project.name);
                setDesc(project.description);
                setEditing(true);
              }}
            >
              {t('projects.edit')}
            </button>
          )}
          {project && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowBible(!showBible)} aria-expanded={showBible}>
              {t('projects.bibleTitle')}
            </button>
          )}
          {single && (
            <Link className="btn btn--primary btn--sm" to="/new">
              {t('projects.newVideo')}
            </Link>
          )}
        </div>
      </div>

      {showBible && project && (
        <div className="board__bible">
          <p className="muted small">{t('projects.bibleHint')}</p>
          {project.bible ? <p className="pre small">{project.bible}</p> : <p className="muted small">{t('projects.bibleEmpty')}</p>}
        </div>
      )}

      {!single && (
        <div className="board__filters" role="tablist" aria-label={t('board.filterLabel')}>
          {(['all', 'films', 'refs', 'made'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
              {t(`board.filter.${f}`)}
              {f !== 'all' && <span className="muted"> {counts[f]}</span>}
            </button>
          ))}
          <span className="board__hint muted small">{t('board.hint')}</span>
        </div>
      )}

      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {films === null && !error && <p className="muted">{t('projects.loading')}</p>}

      {empty && (
        <div className="empty board__empty">
          <h2>{single ? t('projects.noEpisodesTitle') : t('board.emptyTitle')}</h2>
          <p className="muted">{single ? t('projects.noEpisodesBody') : t('board.emptyBody')}</p>
        </div>
      )}

      <ul className="board__grid">
        {!single && showRefs && (
          <li>
            <label className="tile tile--add">
              <input type="file" multiple hidden onChange={(e) => {
                upload(Array.from(e.target.files ?? []));
                e.target.value = '';
              }} />
              <span aria-hidden="true">＋</span>
              <b>{t('board.addRefs')}</b>
              <span className="muted small">{uploading ? t('board.uploading', { n: uploading }) : t('board.addHint')}</span>
            </label>
          </li>
        )}
        {showFilms &&
          films?.map((j, i) => {
            const s = byStyle[j.style_slug];
            const live = j.status === 'queued' || j.status === 'running';
            return (
              <li key={j.id}>
                <Link className="tile tile--film" to={`/films/${j.id}`}>
                  <span className="tile__media">
                    {j.has_video ? (
                      <img src={api.thumbUrl(j.id)} alt="" loading="lazy" />
                    ) : s?.has_poster ? (
                      <img src={api.posterUrl(j.style_slug)} alt="" loading="lazy" className={live ? 'is-dim' : ''} />
                    ) : null}
                    {j.has_video && <span className="tile__play" aria-hidden="true">▶</span>}
                    {live && <span className="tile__spin spinner" aria-hidden="true" />}
                  </span>
                  <span className="tile__body">
                    <b>{filmTitle(j.prompt)}</b>
                    <span className="muted small">
                      {single ? '' : `${t('projects.episodeN', { n: films.length - i })} · `}
                      {s?.en ?? j.style_slug} · {t('projects.seconds', { n: j.duration_s })}
                    </span>
                  </span>
                  <span className="tile__chip">
                    <StatusChip status={j.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        {showRefs &&
          media.refs.map((m) => (
            <MediaTile key={m.path} m={m} pid={id} picked={picked.includes(m.path)} onPick={() => toggle(m.path)} onOpen={() => setOpen(m)} label={t('board.ref')} />
          ))}
        {showMade &&
          media.assets.map((m) => (
            <MediaTile key={m.path} m={m} pid={id} picked={picked.includes(m.path)} onPick={() => toggle(m.path)} onOpen={() => setOpen(m)} label={t('board.made')} />
          ))}
      </ul>


      {open && (
        <Lightbox
          m={open}
          pid={id}
          picked={picked.includes(open.path)}
          onPick={() => toggle(open.path)}
          onDelete={open.path.startsWith('refs/') ? () => removeRef(open) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
      {!single && project && (
        <ProjectChat
          pid={id}
          styles={styles}
          initialStyle={lastStyle}
          usedStyles={[...new Set((films ?? []).map((j) => j.style_slug))].slice(0, 4)}
          nextEpisode={(films?.length ?? 0) + 1}
          picked={pickedItems}
          onUnpick={(p) => setPicked(picked.filter((x) => x !== p))}
          onFiles={upload}
          onMade={(job) => {
            setPicked([]);
            setFilms((f) => [job, ...(f ?? [])]);
            nav(`/films/${job.id}`);
          }}
          langName={langName}
          ts={ts}
        />
      )}
    </div>
  );
}

function MediaTile({ m, pid, picked, onPick, onOpen, label }: { m: MediaItem; pid: string; picked: boolean; onPick: () => void; onOpen: () => void; label: string }) {
  const { t } = useT();
  const url = api.projectFileUrl(pid, m.path);
  const vid = useRef<HTMLVideoElement>(null);
  return (
    <li>
      <div className={`tile tile--media ${picked ? 'is-picked' : ''}`}>
        <button type="button" className="tile__media" onClick={onOpen} aria-label={t('board.open', { name: m.name })}
          onMouseEnter={() => vid.current?.play().catch(() => {})}
          onMouseLeave={() => {
            if (vid.current) {
              vid.current.pause();
              vid.current.currentTime = 0;
            }
          }}
        >
          {m.kind === 'image' && <img src={url} alt="" loading="lazy" />}
          {m.kind === 'video' && <video ref={vid} src={`${url}#t=0.5`} muted loop playsInline preload="metadata" />}
          {m.kind !== 'image' && m.kind !== 'video' && <span className="tile__icon" aria-hidden="true">{m.kind === 'audio' ? '🎵' : '📄'}</span>}
          {m.kind === 'video' && <span className="tile__play" aria-hidden="true">▶</span>}
        </button>
        <button type="button" className={`tile__pick ${picked ? 'is-on' : ''}`} onClick={onPick} aria-pressed={picked} title={picked ? t('board.unpick') : t('board.pick')}>
          {picked ? '✓' : '+'}
        </button>
        <span className="tile__body">
          <b title={m.name}>{m.name}</b>
          <span className="muted small">{label}</span>
        </span>
      </div>
    </li>
  );
}

function Lightbox({ m, pid, picked, onPick, onDelete, onClose }: { m: MediaItem; pid: string; picked: boolean; onPick: () => void; onDelete?: () => void; onClose: () => void }) {
  const { t } = useT();
  const url = api.projectFileUrl(pid, m.path);
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={m.name} onClick={onClose}>
      <div className="lightbox__in" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox__media">
          {m.kind === 'image' && <img src={url} alt={m.name} />}
          {m.kind === 'video' && <video src={url} controls autoPlay playsInline />}
          {m.kind === 'audio' && <audio src={url} controls autoPlay />}
          {(m.kind === 'doc' || m.kind === 'other') && <span className="tile__icon">📄</span>}
        </div>
        <div className="lightbox__bar">
          <b className="lightbox__name">{m.name}</b>
          <button type="button" className={`btn btn--sm ${picked ? 'btn--primary' : 'btn--ghost'}`} onClick={onPick}>
            {picked ? `✓ ${t('board.picked')}` : t('board.pick')}
          </button>
          <a className="btn btn--ghost btn--sm" href={url} download={m.name}>
            {t('board.download')}
          </a>
          {onDelete && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDelete}>
              {t('board.delete')}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label={t('board.close')}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/** The chat beside the board: pick one or more styles (the first leads, the others are blended in),
 *  talk the film through with Claude in the client's language (it asks what is unclear), then make it
 *  with the references picked on the board. Claude also suggests styles from what the client writes. */
function ProjectChat(props: {
  pid: string;
  styles: Style[];
  initialStyle: string | null;
  usedStyles: string[];
  nextEpisode: number;
  picked: MediaItem[];
  onUnpick: (path: string) => void;
  onFiles: (files: File[]) => void;
  onMade: (job: Job) => void;
  langName: string;
  ts: (s: string) => string;
}) {
  const { t } = useT();
  const { pid, styles, picked } = props;
  const [draft, setDraft] = useState('');
  const [slugs, setSlugs] = useState<string[]>([]);
  const [duration, setDuration] = useState(30);
  const [aspect, setAspect] = useState('16:9');
  const [voice, setVoice] = useState(props.langName);
  const [choosing, setChoosing] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [brief, setBrief] = useState('');
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<{ slug: string; why: string }[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const asked = useRef('');
  const seq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!slugs.length && props.initialStyle) setSlugs([props.initialStyle]);
  }, [props.initialStyle]);
  useEffect(() => setVoice(props.langName), [props.langName]);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const bySlug = useMemo(() => Object.fromEntries(styles.map((s) => [s.slug, s])), [styles]);
  const chosen = slugs.map((s) => bySlug[s]).filter((s): s is Style => !!s);
  const hasWish = messages.some((m) => m.role === 'client');

  // Style ideas from what the client has said so far (the draft, or the chat).
  const topic = (draft.trim() || messages.filter((m) => m.role === 'client').map((m) => m.text).join('\n')).trim();
  async function suggest(force = false) {
    if (topic.length < 4 || (!force && topic === asked.current)) return;
    asked.current = topic;
    const n = ++seq.current;
    setSuggesting(true);
    try {
      const r = await api.suggestStyles({ text: topic, refs: picked.map((m) => `${m.name} (${m.kind})`), project_id: pid, chat_lang: props.langName });
      if (n === seq.current) setIdeas(r.suggestions);
    } catch {
      /* suggestions are a nicety */
    } finally {
      if (n === seq.current) setSuggesting(false);
    }
  }
  useEffect(() => {
    if (draft.trim().length < 15 || hasWish) return;
    const h = window.setTimeout(() => suggest(), 1600);
    return () => window.clearTimeout(h);
  }, [draft]);

  function add(slug: string) {
    setSlugs((s) => (s.includes(slug) ? s : s.length >= 5 ? s : [...s, slug]));
    if (slug === 'hf-vertical') setAspect('9:16');
  }

  const refsLine = () =>
    picked.length ? `References the client picked for this film, in the project folder: ${picked.map((m) => `${m.path} (${m.kind})`).join(', ')}. Use them.` : '';

  async function send(text: string) {
    const msg = text.trim();
    const main = slugs[0];
    if (!msg || thinking) return;
    if (!main) return setChoosing(true);
    const next: ChatMsg[] = [...messages, { role: 'client', text: msg }];
    setMessages(next);
    setDraft('');
    setError(null);
    setThinking(true);
    try {
      const r = await api.plan({
        style_slug: main,
        duration_s: duration,
        aspect,
        language: voice,
        material: [
          ...picked.map((m) => `project reference ${m.name} (${m.kind})`),
          ...chosen.slice(1).map((s) => `blend in the ${s.en} style`),
        ],
        messages: next,
        project_id: pid,
        chat_lang: props.langName,
        make_label: t('board.make'),
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

  async function make() {
    const [main, ...mix] = slugs;
    if (!main) return setChoosing(true);
    if (!hasWish) return setError(t('new.tellFirst'));
    setError(null);
    setBusy(true);
    const chat = messages.map((m) => `${m.role === 'client' ? 'Client' : 'Claude'}: ${m.text}`).join('\n\n');
    const head = brief.trim()
      ? `Agreed brief (written with the client in the chat below${ready ? '' : '; a few points were still open, decide them yourself'}):\n${brief.trim()}\n\nThe planning chat:\n${chat}`
      : `The planning chat:\n${chat}`;
    const refs = refsLine();
    const prompt = `${head}${refs ? `\n\n${refs}` : ''}\n\nChat language: ${props.langName}`;
    try {
      const job = await api.createJob({ style_slug: main, mix, prompt, duration_s: duration, aspect, language: voice, inputs: {}, project_id: pid }, {});
      setMessages([]);
      setBrief('');
      setReady(false);
      setIdeas([]);
      asked.current = '';
      props.onMade(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('board.makeError'));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  // Before Claude has suggested anything, offer the styles this project already uses.
  const shownIdeas = (ideas.length ? ideas : props.usedStyles.map((slug) => ({ slug, why: t('board.usedBefore') })))
    .filter((i) => bySlug[i.slug] && !slugs.includes(i.slug));

  return (
    <aside className="chat projchat" aria-label={t('board.chatTitle')}>
      <div className="chat__top">
        <h2>{t('board.chatTitle', { n: props.nextEpisode })}</h2>
        <div className="dock__styles">
          {chosen.map((s, i) => (
            <span key={s.slug} className={`stylechip ${i === 0 ? 'is-main' : ''}`} title={i === 0 ? t('board.mainStyle') : t('board.blendStyle')}>
              {s.has_poster && <img src={api.posterUrl(s.slug)} alt="" />}
              <span>{i === 0 ? '★ ' : '+ '}{s.en}</span>
              <button type="button" onClick={() => setSlugs(slugs.filter((x) => x !== s.slug))} aria-label={t('board.removeStyle', { name: s.en })}>
                ×
              </button>
            </span>
          ))}
          <button type="button" className="stylechip stylechip--add" onClick={() => setChoosing(true)} disabled={slugs.length >= 5}>
            {slugs.length ? t('board.addStyle') : t('board.pickStyle')}
          </button>
        </div>
        {(shownIdeas.length > 0 || suggesting) && (
          <div className="dock__ideas" aria-live="polite">
            <span className="dock__ideas-label">
              {suggesting ? <span className="spinner" aria-hidden="true" /> : '✦'} {ideas.length ? t('board.suggested') : t('board.inProject')}
            </span>
            {shownIdeas.slice(0, 4).map((i) => {
              const s = bySlug[i.slug];
              return (
                <button key={i.slug} type="button" className="idea" onClick={() => add(i.slug)} title={i.why}>
                  {s.has_poster && <img src={api.posterUrl(s.slug)} alt="" />}
                  <span>
                    <b>{s.en}</b>
                    <small>{i.why}</small>
                  </span>
                </button>
              );
            })}
            {topic.length >= 4 && !suggesting && (
              <button type="button" className="linkbtn small" onClick={() => suggest(true)}>
                {t('board.suggestAgain')}
              </button>
            )}
          </div>
        )}
        <div className="dock__opts">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label={t('board.length')}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {t('projects.seconds', { n: d })}
              </option>
            ))}
          </select>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label={t('board.aspect')}>
            {ASPECTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={t('board.voice')}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.name}>
                {l.native}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <button type="button" className="linkbtn small dock__plan" onClick={() => { setMessages([]); setBrief(''); setReady(false); }}>
              {t('board.newChat')}
            </button>
          )}
        </div>
      </div>

      <div className="chat__thread" ref={threadRef} aria-live="polite">
        <div className="bubble bubble--claude">{chosen[0] ? t('new.hello', { style: chosen.map((s) => s.en).join(' + ') }) : t('board.helloNoStyle')}</div>
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
        {picked.length > 0 && (
          <ul className="dock__refs" aria-label={t('board.pickedLabel')}>
            {picked.map((m) => (
              <li key={m.path} title={m.name}>
                {m.kind === 'image' ? <img src={api.projectFileUrl(pid, m.path)} alt="" /> : <span aria-hidden="true">{m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '📄'}</span>}
                <button type="button" onClick={() => props.onUnpick(m.path)} aria-label={t('board.unpickName', { name: m.name })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer composer--files">
          <button type="button" className="btn btn--ghost attach" onClick={() => fileRef.current?.click()} aria-label={t('board.addRefs')} title={t('board.addRefs')}>
            📎
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => {
            props.onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }} />
          <textarea
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const f = pastedFiles(e);
              if (f.length) props.onFiles(f);
            }}
            placeholder={hasWish ? t('board.replyPlaceholder') : t('board.placeholder', { n: props.nextEpisode })}
            aria-label={t('board.promptLabel')}
          />
          <button type="button" className="btn btn--ghost send" onClick={() => send(draft)} disabled={!draft.trim() || thinking}>
            {t('new.send')}
          </button>
        </div>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary btn--full" type="button" onClick={make} disabled={busy || thinking || !hasWish}>
          {busy ? t('board.starting') : ready || !hasWish ? t('board.make') : t('new.makeRest')}
        </button>
      </div>

      {choosing && (
        <StylePicker
          styles={styles}
          chosen={slugs}
          ts={props.ts}
          onToggle={(slug) => (slugs.includes(slug) ? setSlugs(slugs.filter((x) => x !== slug)) : add(slug))}
          onClose={() => setChoosing(false)}
        />
      )}
    </aside>
  );
}

function StylePicker({ styles, chosen, ts, onToggle, onClose }: { styles: Style[]; chosen: string[]; ts: (s: string) => string; onToggle: (slug: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const shown = styles.filter((s) => {
    const w = q.trim().toLowerCase();
    return !w || [s.en, s.slug, s.category_en, ts(s.line), ts(s.category_en)].some((x) => x.toLowerCase().includes(w));
  });
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('board.pickStyle')} onClick={onClose}>
      <div className="lightbox__in picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker__head">
          <b>{t('board.pickStyles')}</b>
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('board.searchStyles')} aria-label={t('board.searchStyles')} />
          <span className="muted small">{t('board.pickHint')}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
            {t('board.done', { n: chosen.length })}
          </button>
        </div>
        <ul className="picker__grid">
          {shown.map((s) => {
            const i = chosen.indexOf(s.slug);
            return (
              <li key={s.slug}>
                <button type="button" className={`style ${i >= 0 ? 'is-on' : ''}`} onClick={() => onToggle(s.slug)} aria-pressed={i >= 0} title={ts(s.line)}>
                  <span className="style__img">
                    {s.has_poster ? <img src={api.posterUrl(s.slug)} alt="" loading="lazy" /> : <span>{s.en}</span>}
                    {i >= 0 && <span className="picker__n">{i === 0 ? '★' : i + 1}</span>}
                  </span>
                  <b>{s.en}</b>
                  <span className="muted small">{ts(s.category_en)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
