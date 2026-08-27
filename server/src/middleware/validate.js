/**
 * Schema validation middleware.
 *
 * Replaces per-route hand-written checks and a hand-maintained field
 * whitelist. Parsed output replaces the raw input, so downstream code only
 * ever sees values the schema allowed: unknown keys are gone by the time a
 * handler runs, not merely ignored by it.
 */

function formatIssues(error) {
  return error.issues.map(issue => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function make(source) {
  return (schema) => (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = formatIssues(result.error);
      return res.status(400).json({
        success: false,
        error: details[0] || 'Invalid request.',
        details
      });
    }
    // Express 5 exposes req.query as a getter, so assigning to it throws.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
}

export const validateBody = make('body');
export const validateQuery = make('query');
export const validateParams = make('params');
