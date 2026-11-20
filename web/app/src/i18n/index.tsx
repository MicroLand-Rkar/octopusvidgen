import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';

/** The interface languages. `name` is the English name, which is also what Claude is told to write in. */
export const LANGS = [
  { code: 'en', native: 'English', name: 'English' },
  { code: 'zh', native: '中文', name: 'Chinese (Simplified)' },
  { code: 'my', native: 'မြန်မာ', name: 'Burmese' },
  { code: 'th', native: 'ไทย', name: 'Thai' },
  { code: 'es', native: 'Español', name: 'Spanish' },
  { code: 'hi', native: 'हिन्दी', name: 'Hindi' },
  { code: 'ar', native: 'العربية', name: 'Arabic', rtl: true },
  { code: 'pt', native: 'Português', name: 'Portuguese' },
  { code: 'fr', native: 'Français', name: 'French' },
  { code: 'de', native: 'Deutsch', name: 'German' },
  { code: 'ru', native: 'Русский', name: 'Russian' },
  { code: 'ja', native: '日本語', name: 'Japanese' },
  { code: 'ko', native: '한국어', name: 'Korean' },
  { code: 'vi', native: 'Tiếng Việt', name: 'Vietnamese' },
  { code: 'id', native: 'Bahasa Indonesia', name: 'Indonesian' },
] as const;

export type LangCode = (typeof LANGS)[number]['code'];

/** One language's text: the interface (`ui`), the styles' own words keyed by their English text
 *  (`style`), and three sample wishes per style (`examples`). */
type Locale = { ui: Record<string, string>; style?: Record<string, string>; examples?: Record<string, string[]> };

const loaders = import.meta.glob<Locale>('./locales/*.json', { import: 'default' });
const KEY = 'ovg.lang';

function initial(): LangCode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved as LangCode;
  } catch {
    /* storage off */
  }
  for (const n of navigator.languages ?? [navigator.language]) {
    const c = n.toLowerCase().split('-')[0];
    if (LANGS.some((l) => l.code === c)) return c as LangCode;
  }
  return 'en';
}

type Ctx = {
  lang: LangCode;
  setLang: (c: LangCode) => void;
  /** Interface text by key, with {name} placeholders filled from `vars`. Falls back to English. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** A style's own English words (title line, field label, hint) in the chosen language. */
  ts: (english: string) => string;
  /** Sample wishes for a style. */
  examples: (slug: string) => string[];
  /** The chosen language's English name ("Thai"), for telling Claude which language to write in. */
  langName: string;
};

const I18n = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(initial);
  const [loc, setLoc] = useState<Locale>(en as Locale);

  useEffect(() => {
    let live = true;
    const load = loaders[`./locales/${lang}.json`];
    (load ? load() : Promise.resolve(en as Locale)).then((l) => live && setLoc(l)).catch(() => live && setLoc(en as Locale));
    const meta = LANGS.find((l) => l.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = meta && 'rtl' in meta ? 'rtl' : 'ltr';
    return () => {
      live = false;
    };
  }, [lang]);

  const setLang = useCallback((c: LangCode) => {
    setLangState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* storage off */
    }
  }, []);

  const value = useMemo<Ctx>(() => {
    const base = (en as Locale).ui;
    return {
      lang,
      setLang,
      t: (key, vars) => {
        let s = loc.ui[key] ?? base[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
        return s;
      },
      ts: (english) => (english && loc.style?.[english]) || english,
      examples: (slug) => loc.examples?.[slug] ?? (en as Locale).examples?.[slug] ?? [],
      langName: LANGS.find((l) => l.code === lang)?.name ?? 'English',
    };
  }, [lang, loc, setLang]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT() {
  const c = useContext(I18n);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}

/** The language picker in the top bar. */
export function LangPicker() {
  const { lang, setLang, t } = useT();
  return (
    <label className="langpick">
      <span className="sr-only">{t('lang.label')}</span>
      <span aria-hidden="true">🌐</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as LangCode)} aria-label={t('lang.label')}>
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </label>
  );
}
