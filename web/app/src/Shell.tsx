import { NavLink, Outlet } from 'react-router-dom';
import { LangPicker, useT } from './i18n';

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 21.5V12a9.5 9.5 0 0 1 19 0v9.5h-6V12a3.5 3.5 0 0 0-7 0v9.5z" fill="currentColor" />
    </svg>
  );
}

export function Shell() {
  const { t } = useT();
  return (
    <>
      <header className="bar">
        <div className="wrap bar__in">
          <a className="logo" href="/">
            <Mark />
            OctopusVidGen
          </a>
          <nav className="bar__links" aria-label={t('nav.label')}>
            <NavLink to="/" className={({ isActive }) => (isActive || location.pathname.startsWith('/app/projects') ? 'active' : '')} end>
              {t('nav.projects')}
            </NavLink>
            <NavLink to="/new">{t('nav.new')}</NavLink>
          </nav>
          <div className="bar__me">
            <LangPicker />
          </div>
        </div>
      </header>
      <main className="wrap main">
        <Outlet />
      </main>
    </>
  );
}
