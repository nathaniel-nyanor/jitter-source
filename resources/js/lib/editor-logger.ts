type EditorLogPayload = Record<string, unknown>;

export type EditorLogEntry = {
    id: string;
    timestamp: string;
    event: string;
    payload: EditorLogPayload;
};

const storageKey = 'jitter-editor-logs';
const maxEntries = 500;

export function logEditorEvent(
    event: string,
    payload: EditorLogPayload = {},
): void {
    const entry: EditorLogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        event,
        payload: sanitizePayload(payload),
    };

    try {
        const logs = [...readEditorLogs(), entry].slice(-maxEntries);

        window.localStorage.setItem(storageKey, JSON.stringify(logs));
    } catch {
        // Keep logging to the console even if browser storage is unavailable.
    }

    console.info('[jitter-editor]', entry);
}

export function readEditorLogs(): EditorLogEntry[] {
    try {
        const rawLogs = window.localStorage.getItem(storageKey);

        if (!rawLogs) {
            return [];
        }

        const parsed = JSON.parse(rawLogs);

        return Array.isArray(parsed) ? (parsed as EditorLogEntry[]) : [];
    } catch {
        return [];
    }
}

export function clearEditorLogs(): void {
    try {
        window.localStorage.removeItem(storageKey);
    } catch {
        // Console logging still gives us a live trace when storage is blocked.
    }

    console.info('[jitter-editor]', {
        event: 'logs.cleared',
        timestamp: new Date().toISOString(),
    });
}

export function installEditorErrorLogging(): () => void {
    const handleError = (event: ErrorEvent) => {
        logEditorEvent('runtime.error', {
            message: event.message,
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: event.error instanceof Error ? event.error.stack : null,
        });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
        logEditorEvent('runtime.unhandled_rejection', {
            reason:
                event.reason instanceof Error
                    ? {
                          message: event.reason.message,
                          stack: event.reason.stack,
                      }
                    : event.reason,
        });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
        window.removeEventListener('error', handleError);
        window.removeEventListener('unhandledrejection', handleRejection);
    };
}

function sanitizePayload(payload: EditorLogPayload): EditorLogPayload {
    return JSON.parse(
        JSON.stringify(payload, (_key, value) => {
            if (value instanceof Error) {
                return {
                    message: value.message,
                    stack: value.stack,
                };
            }

            if (typeof value === 'function') {
                return '[function]';
            }

            return value;
        }),
    ) as EditorLogPayload;
}
