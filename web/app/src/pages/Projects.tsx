import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Job, type ProjectCard } from '../api';
import { useT } from '../i18n';

/** My projects: one folder per project, plus a folder for films that belong to none. */
export function Projects() {
  const { t } = useT();
  const nav = useNavigate();
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [singles, setSingles] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([api.projects(), api.jobs()])
      .then(([p, j]) => {
        setProjects(p);
        setSingles(j.filter((x) => !x.project_id));
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('projects.loadError')));
  }, []);

  const empty = projects?.length === 0 && singles.length === 0;

  return (
    <div className="projects-page">
      <div className="page-head">
        <h1>{t('projects.title')}</h1>
        <div className="btn-row" style={{ margin: 0 }}>
          <button className="btn btn--ghost" type="button" onClick={() => setAdding(true)}>
            {t('projects.newProject')}
          </button>
          <Link className="btn btn--primary" to="/new">
            {t('projects.newVideo')}
          </Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {projects === null && !error && <p className="muted">{t('projects.loading')}</p>}
      {adding && <NewProjectForm onDone={(id) => (id ? nav(`/projects/${id}`) : setAdding(false))} />}
      {empty && !adding && (
        <div className="empty">
          <h2>{t('projects.emptyTitle')}</h2>
          <p className="muted">
            {t('projects.emptyBody')}
          </p>
          <button className="btn btn--primary" type="button" onClick={() => setAdding(true)}>
            {t('projects.emptyCta')}
          </button>
        </div>
      )}
      {projects && (projects.length > 0 || singles.length > 0) && (
        <ul className="folders">
          {projects.map((p) => (
            <li key={p.id}>
              <Link className="folder" to={`/projects/${p.id}`}>
                <span className="folder__cover">
                  {p.latest_job_id && p.latest_has_video ? (
                    <img src={api.thumbUrl(p.latest_job_id)} alt="" loading="lazy" />
                  ) : p.latest_style ? (
                    <img src={api.posterUrl(p.latest_style)} alt="" loading="lazy" />
                  ) : (
                    <span className="folder__icon" aria-hidden="true">
                      ▢
                    </span>
                  )}
                  <span className="folder__count">{t('projects.episodeCount', { n: p.episodes })}</span>
                </span>
                <b>{p.name}</b>
                <span className="muted small">
                  {p.description ? p.description.slice(0, 70) : t('projects.continueEpisode', { n: p.episodes + 1 })}
                </span>
              </Link>
            </li>
          ))}
          {singles.length > 0 && (
            <li>
              <Link className="folder folder--loose" to="/projects/single">
                <span className="folder__cover">
                  {singles[0].has_video ? (
                    <img src={api.thumbUrl(singles[0].id)} alt="" loading="lazy" />
                  ) : (
                    <img src={api.posterUrl(singles[0].style_slug)} alt="" loading="lazy" />
                  )}
                  <span className="folder__count">{t('projects.singleCount', { n: singles.length })}</span>
                </span>
                <b>{t('projects.singles')}</b>
                <span className="muted small">{t('projects.singlesHint')}</span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function NewProjectForm({ onDone }: { onDone: (id: string | null) => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t('projects.nameRequired'));
    setBusy(true);
    try {
      const p = await api.createProject(name, description);
      onDone(p.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.createError'));
      setBusy(false);
    }
  }

  return (
    <form className="newproject" onSubmit={submit}>
      <div className="field">
        <label htmlFor="pname">{t('projects.nameLabel')}</label>
        <input id="pname" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('projects.namePlaceholder')} />
      </div>
      <div className="field">
        <label htmlFor="pdesc">
          {t('projects.descLabel')} <span className="muted">{t('projects.optional')}</span>
        </label>
        <textarea
          id="pdesc"
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('projects.descPlaceholder')}
        />
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="btn-row" style={{ margin: 0 }}>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {t('projects.create')}
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => onDone(null)}>
          {t('projects.cancel')}
        </button>
      </div>
    </form>
  );
}
