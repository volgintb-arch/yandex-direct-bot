export class ApiError extends Error {
  constructor(
    message: string,
    public readonly service: string,
    public readonly code?: string | number,
    public readonly detail?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
