import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LangProvider } from './i18n';
import { Projects } from './pages/Projects';
import { ProjectPage } from './pages/ProjectPage';
import { NewFilm } from './pages/NewFilm';
import { FilmPage } from './pages/FilmPage';
import { Shell } from './Shell';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <LangProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/new" element={<NewFilm />} />
            <Route path="/films/:id" element={<FilmPage />} />
          </Route>
          {/* Old sign-in links land on the projects page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </LangProvider>
    </BrowserRouter>
  </StrictMode>,
);
