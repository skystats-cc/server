export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(404, 'not_found', `${what} not found`);
  }
}

export class UpstreamError extends AppError {
  constructor(
    public readonly upstreamStatus: number,
    path: string,
  ) {
    super(502, 'upstream_error', `Upstream returned ${upstreamStatus} for ${path}`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in required') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(code = 'forbidden', message = 'Not allowed') {
    super(403, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class UnavailableError extends AppError {
  constructor(message: string) {
    super(503, 'unavailable', message);
  }
}
