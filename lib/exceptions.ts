/** Exceptions for the LGHorizon API (port of exceptions.py). */

export class LGHorizonApiError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'LGHorizonApiError';
  }
}

export class LGHorizonApiConnectionError extends LGHorizonApiError {
  constructor(message?: string) {
    super(message);
    this.name = 'LGHorizonApiConnectionError';
  }
}

export class LGHorizonApiUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'LGHorizonApiUnauthorizedError';
  }
}

export class LGHorizonApiLockedError extends LGHorizonApiUnauthorizedError {
  constructor(message?: string) {
    super(message);
    this.name = 'LGHorizonApiLockedError';
  }
}
