/** An error that carries the HTTP status the API should answer with. */
export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

/** 400 Bad Request. */
export class ValidationError extends HttpError {
  /** @param {string} message */
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}
