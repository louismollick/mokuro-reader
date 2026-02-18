const YOMITAN_DEBUG_QUERY_PARAM = 'debugYomitan';
const YOMITAN_DEBUG_STORAGE_KEY = 'mokuro:debug:yomitan';
const YOMITAN_DEBUG_EVENT_LIMIT = 200;

type YomitanDebugScope = 'reader' | 'drawer' | 'core';

interface YomitanDebugEvent {
  ts: string;
  scope: YomitanDebugScope;
  message: string;
  details?: Record<string, unknown>;
}

type YomitanDebugWindow = Window &
  typeof globalThis & {
    __mokuroYomitanDebugEvents?: YomitanDebugEvent[];
  };

export function isYomitanDebugEnabled() {
  if (typeof window === 'undefined') return false;

  const queryValue = new URLSearchParams(window.location.search).get(YOMITAN_DEBUG_QUERY_PARAM);
  if (queryValue === '1' || queryValue === 'true') {
    return true;
  }

  try {
    const storedValue = window.localStorage.getItem(YOMITAN_DEBUG_STORAGE_KEY);
    return storedValue === '1' || storedValue === 'true';
  } catch {
    return false;
  }
}

function appendYomitanDebugEvent(event: YomitanDebugEvent) {
  if (typeof window === 'undefined') return;

  const debugWindow = window as YomitanDebugWindow;
  const events = debugWindow.__mokuroYomitanDebugEvents ?? [];
  events.push(event);
  if (events.length > YOMITAN_DEBUG_EVENT_LIMIT) {
    events.splice(0, events.length - YOMITAN_DEBUG_EVENT_LIMIT);
  }
  debugWindow.__mokuroYomitanDebugEvents = events;
}

export function logYomitanDebug(
  scope: YomitanDebugScope,
  message: string,
  details?: Record<string, unknown>
) {
  if (!isYomitanDebugEnabled()) return;

  const event: YomitanDebugEvent = {
    ts: new Date().toISOString(),
    scope,
    message,
    details
  };
  appendYomitanDebugEvent(event);
  console.info(`[YomitanDebug][${scope}]`, message, details ?? {});
}

export function getCodePointPreview(value: string, limit = 32) {
  return Array.from(value.slice(0, limit)).map((char) =>
    `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`
  );
}

export function getRecentYomitanDebugEvents(limit = 100): YomitanDebugEvent[] {
  if (typeof window === 'undefined') return [];

  const debugWindow = window as YomitanDebugWindow;
  const events = debugWindow.__mokuroYomitanDebugEvents ?? [];
  if (limit <= 0) return [];
  return events.slice(-limit);
}

export function buildYomitanDebugSnapshot(extra?: Record<string, unknown>) {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    debugEnabled: isYomitanDebugEnabled(),
    location:
      typeof window === 'undefined'
        ? null
        : {
            href: window.location.href,
            userAgent: navigator.userAgent,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight
            }
          },
    extra: extra ?? {},
    events: getRecentYomitanDebugEvents()
  };

  return JSON.stringify(snapshot, null, 2);
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard not available');
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
}
