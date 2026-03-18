export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await globalThis.fetch(url, options);

  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const text = await response.clone().text();
      if (text) {
        const body = JSON.parse(text);
        if (body.message) {
          message = body.message;
        }
        if (body.code) {
          code = body.code;
        }
      }
    } catch {
      // body not parseable, use statusText
    }
    throw new ApiError(response.status, message, code);
  }

  return response.json() as Promise<T>;
}
