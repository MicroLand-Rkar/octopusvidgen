// Thin client for the Rust API. No accounts: the server runs on this computer for one person.
// Every call carries X-OVG-Client, which the server requires on anything that changes data.

export type User = { id: string; email: string; name: string; created_at: string };

export type Style = {
  slug: string;
  num: string;
  en: string;
  cn: string;
  category_en: string;
  film: string;
  line: string;
  uses: string[];
  dur: number;
  has_poster: boolean;
  needs_image_gen: boolean;
  needs: string[];
  inputs: StyleInputs;
  examples: string[];
  image_tool: string;
  /** licence terms that limit use, e.g. noncommercial only */
  license?: string;
};

export type InputField = {
  key: string;
  label: string;
  kind: 'files' | 'text' | 'url';
  accept: string;
  max_files: number | null;
  required: boolean;
  hint: string;
  common: boolean;
  label_my: string;
  hint_my: string;
};

export type StyleInputs = {
  material: 'none' | 'optional' | 'required';
  agent_can_source: boolean;
  fields: InputField[];
  note: string;
  note_my: string;
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type Job = {
  id: string;
  style_slug: string;
  prompt: string;
  duration_s: number;
  aspect: string;
  language: string;
  status: JobStatus;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  has_video: boolean;
  inputs: Record<string, { text?: string; files?: string[] }>;
  project_id: string | null;
};

export type NewJob = {
  style_slug: string;
  prompt: string;
  duration_s: number;
  aspect: string;
  language: string;
  /** text and link fields by key */
  inputs: Record<string, string>;
  project_id?: string | null;
  /** More styles to blend in; style_slug leads. */
  mix?: string[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init.body instanceof FormData
      ? { 'X-OVG-Client': '1', ...(init.headers ?? {}) }
      : { 'Content-Type': 'application/json', 'X-OVG-Client': '1', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: () => call<User>('/auth/me'),
  styles: () => call<Style[]>('/styles'),
  jobs: () => call<Job[]>('/jobs'),
  projects: () => call<ProjectCard[]>('/projects'),
  project: (id: string) => call<ProjectDetail>(`/projects/${id}`),
  createProject: (name: string, description = '') =>
    call<Project>('/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
  updateProject: (id: string, name: string, description: string) =>
    call<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) }),
  projectMedia: (id: string) => call<ProjectMedia>(`/projects/${id}/media`),
  addRefs: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('file', f, f.name));
    return call<string[]>(`/projects/${id}/refs`, { method: 'POST', body: fd });
  },
  removeRef: (id: string, name: string) => call<void>(`/projects/${id}/refs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** A file in a project's refs/ or assets/ folder, by its path inside the project. */
  projectFileUrl: (id: string, path: string) => `/api/projects/${id}/file/${path.split('/').map(encodeURIComponent).join('/')}`,
  moveJob: (id: string, project_id: string | null) =>
    call<Job>(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ project_id }) }),
  job: (id: string) => call<Job>(`/jobs/${id}`),
  /** Multipart: the meta JSON first, then each file as `file:<field key>`. */
  createJob: (b: NewJob, files: Record<string, File[]>) => {
    const fd = new FormData();
    fd.append('meta', JSON.stringify(b));
    for (const [key, list] of Object.entries(files)) for (const f of list) fd.append(`file:${key}`, f, f.name);
    return call<Job>('/jobs', { method: 'POST', body: fd });
  },
  cancelJob: (id: string) => post<Job>(`/jobs/${id}/cancel`),
  jobLog: (id: string) => call<string[]>(`/jobs/${id}/log`),
  suggestStyles: (b: { text: string; refs: string[]; project_id?: string | null; chat_lang?: string }) =>
    call<{ suggestions: { slug: string; why: string }[] }>('/plan/suggest', { method: 'POST', body: JSON.stringify(b) }),
  plan: (b: PlanReq) => call<PlanRes>('/plan', { method: 'POST', body: JSON.stringify(b) }),
  jobProgress: (id: string) => call<JobProgress>(`/jobs/${id}/progress`),
  jobChat: (id: string) => call<JobChat>(`/jobs/${id}/chat`),
  sendChat: (id: string, text: string, files: File[]) => {
    const fd = new FormData();
    fd.append('text', text);
    files.forEach((f) => fd.append('file', f, f.name));
    return call<JobChat>(`/jobs/${id}/chat`, { method: 'POST', body: fd });
  },
  jobFiles: (id: string) => call<{ name: string; size: number }[]>(`/jobs/${id}/files`),
  fileUrl: (id: string, name: string) => `/api/jobs/${id}/files/${encodeURIComponent(name)}`,
  jobBrief: (id: string) => call<string>(`/jobs/${id}/brief`),
  posterUrl: (slug: string) => `/api/styles/${slug}/poster`,
  videoUrl: (id: string) => `/api/jobs/${id}/video`,
  thumbUrl: (id: string) => `/api/jobs/${id}/thumb`,
};

export type MediaKind = 'image' | 'video' | 'audio' | 'doc' | 'other';
export type MediaItem = { path: string; name: string; kind: MediaKind; size: number; modified: string };
/** A project's references (added by the client) and the pictures, clips and sound Claude made for it. */
export type ProjectMedia = { refs: MediaItem[]; assets: MediaItem[] };

export type ChatMsg = { role: 'client' | 'claude'; text: string };
export type PlanReq = {
  style_slug: string;
  duration_s: number;
  aspect: string;
  language: string;
  material: string[];
  messages: ChatMsg[];
  project_id?: string | null;
  chat_lang?: string;
  make_label?: string;
};
export type PlanRes = { reply: string; ready: boolean; brief: string };

export type JobProgress = {
  stages: { key: string; state: 'done' | 'active' | 'todo' }[];
  percent: number;
  elapsed_s: number;
  images: number;
  steps: number;
  doing: string;
};

/** A short title for a film: the client's first chat message if there was a chat, else the first line. */
export function filmTitle(prompt: string) {
  const m = prompt.match(/^Client: (.+)$/m);
  const t = (m ? m[1] : prompt.split('\n')[0]).trim();
  return t.length > 90 ? t.slice(0, 90) + '…' : t;
}

export type JobChatMsg = {
  role: 'client' | 'claude';
  kind: 'plan' | 'update' | 'question' | 'note' | 'answer' | 'reply';
  text: string;
  files?: string[];
};
export type JobChat = { messages: JobChatMsg[]; question: string | null };

export type Project = { id: string; name: string; description: string; created_at: string };
export type ProjectCard = Project & {
  episodes: number;
  latest_job_id: string | null;
  latest_style: string | null;
  latest_has_video: boolean;
  updated_at: string;
};
export type ProjectDetail = Project & { bible: string; assets: string[] };

