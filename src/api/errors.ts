// The backend answers every error as { title, message, code }. Screens show one ApiError, whatever went wrong.

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;

  constructor(status: number, title: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
  }

  /** The browser couldn't reach the backend: offline, wrong address, or refused by CORS. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const FALLBACK: Record<number, [string, string]> = {
  400: ['Invalid request', 'Check what you entered and try again.'],
  401: ['Not signed in', 'Your session has ended. Sign in again.'],
  403: ['Not allowed', "Your role can't do this."],
  404: ['Not found', "This record doesn't exist, or was removed."],
  409: ['Conflict', 'This changed since you opened it. Reload and try again.'],
  423: ['Account locked', 'Too many attempts. Try again later.'],
  429: ['Too many requests', 'Wait a few minutes, then try again.']
};

/** Builds an ApiError from a failed response, using the backend's own wording when it sent some. */
export async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: fall back to the status
  }
  const b = (body && typeof body === 'object' ? body : {}) as { title?: unknown; message?: unknown };
  const [title, message] = FALLBACK[res.status] ?? ['Something went wrong', `The GP API answered ${res.status}. Try again.`];
  return new ApiError(
    res.status,
    typeof b.title === 'string' && b.title ? b.title : title,
    typeof b.message === 'string' && b.message ? b.message : message
  );
}

export function networkError(): ApiError {
  return new ApiError(0, "Can't reach the GP API", 'Check your connection. If it keeps happening, the GP API may be down.');
}

/** A message for any thrown value, for toasts and inline errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Try again.';
}
