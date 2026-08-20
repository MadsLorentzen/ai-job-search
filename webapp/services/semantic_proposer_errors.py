# webapp/services/semantic_proposer_errors.py
class SemanticProposerProviderError(RuntimeError):
    """Raised when the hosted semantic proposer fails or returns malformed output.

    Never caught to produce a silent empty-proposal fallback — the caller
    (webapp.services.pipeline) must leave the previous successful Job Fit
    result visible and report the stage as failed, per the frozen design's
    failure-handling rule: no fabricated analysis, ever. On any failure the
    caller receives THIS exception, never a default value.
    """
