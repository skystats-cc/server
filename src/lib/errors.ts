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
  constructor(status: number, path: string) {
    super(502, 'upstream_error', `Upstream returned ${status} for ${path}`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in required') {
    super(401, 'unauthorized', message);
  }
}
