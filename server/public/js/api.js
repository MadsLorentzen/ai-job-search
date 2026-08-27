/**
 * Auth state and the network layer.
 *
 * The token is an opaque server-issued session token, not the user's password,
 * and it travels in the Authorization header only. It is never appended to a
 * URL: doing so put the credential into browser history, access logs and
 * Referer headers.
 */

const SESSION_KEY = 'jobsearch_auth_session';
const LEGACY_KEY = 'jobsearch_auth_token';

export const auth = {
  token: '',
  expiresAt: 0,

  load() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
          this.token = parsed.token;
          this.expiresAt = parsed.expiresAt;
          return this.token;
        }
      }
    } catch { /* fall through to clear */ }
    this.clear();
    return '';
  },

  set(token, expiresAt) {
    this.token = token;
    this.expiresAt = expiresAt;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
  },

  // Clears both keys. Clearing only one left a stale token that the other
  // restored on the next page load.
  clear() {
    this.token = '';
    this.expiresAt = 0;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_KEY);
  }
};

/** Fired when the server rejects the session, so the shell can re-lock. */
export const onUnauthorized = { handler: () => {} };

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || [];
  }
}

export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    auth.clear();
    onUnauthorized.handler();
    throw new ApiError('Session expired. Please unlock again.', 401);
  }
  return res;
}

/** Parse a response as JSON, turning a non-JSON body into a useful message. */
export async function readJson(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(
      res.ok ? 'The server returned an unexpected response.' : `Server error ${res.status}.`,
      res.status
    );
  }
  if (!res.ok && data && data.success === false) {
    throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.details);
  }
  return data;
}

export const api = {
  get: (url) => authFetch(url).then(readJson),

  post: (url, body) => authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(readJson),

  patch: (url, body) => authFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(readJson),

  del: (url) => authFetch(url, { method: 'DELETE' }).then(readJson),

  form: (url, formData) => authFetch(url, { method: 'POST', body: formData }).then(readJson),

  /** Unauthenticated: used before a session exists. */
  public: (url, options) => fetch(url, options).then(readJson)
};

/**
 * Stream a Server-Sent Events response from a POST.
 *
 * EventSource cannot POST, so the body is read manually. Used by document
 * generation, which regularly runs past a minute and previously reported
 * nothing until it finished.
 */
export async function postEventStream(url, body, handlers = {}) {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body)
  });

  if (!res.ok || !res.body) {
    throw new ApiError(`Could not start the stream (${res.status}).`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line.
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;           // heartbeat
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      let payload;
      try {
        payload = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }
      handlers[event]?.(payload);
    }
  }
}

/**
 * Download through fetch so the token stays in a header.
 * A plain link would need ?token=... in the URL.
 */
export async function downloadFile(url, fallbackName) {
  const res = await authFetch(url);
  if (!res.ok) {
    const data = await readJson(res).catch(() => ({}));
    throw new ApiError(data.error || 'Download failed.', res.status);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;

  const blobUrl = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
