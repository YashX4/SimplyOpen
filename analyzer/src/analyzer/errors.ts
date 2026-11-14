/**
 * @file Error hierarchy for the Analyzer.
 *
 * Every error the Analyzer throws on purpose extends {@link AnalyzerError},
 * so callers (e.g. an HTTP handler) can tell "an Analyzer failure" apart
 * from an unexpected bug with one `instanceof` check, and pick a response
 * per subclass without knowing anything about the Analyzer's internals.
 *
 * This file deliberately imports nothing: it depends only on the built-in
 * `Error` type and the standard `ErrorOptions` (`{ cause }`) chaining.
 */

/**
 * Base class for every error the Analyzer throws deliberately.
 *
 * Not thrown directly — throw one of the subclasses. Catch this type to
 * handle any Analyzer failure.
 */
export class AnalyzerError extends Error {
  /**
   * @param message Human-readable description. Must not contain secrets or raw model output.
   * @param options Standard error options; pass `{ cause }` to chain the underlying error.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Use the concrete subclass name (e.g. "UnzipError") in stack traces and logs.
    this.name = new.target.name;
  }
}

/**
 * Thrown when the uploaded archive cannot be extracted safely: it is not a
 * zip, is corrupt, uses an unsupported feature (e.g. encryption), contains
 * a path that would escape the extraction folder, exceeds a size limit, or
 * contains no files.
 */
export class UnzipError extends AnalyzerError {}

/**
 * Thrown when the model's answer still fails validation after the one
 * allowed retry, so no manifest can be returned. The Analyzer never returns
 * an unvalidated manifest instead. Typically chained with the last
 * {@link SchemaValidationError} as its `cause`.
 */
export class AnalysisFailedError extends AnalyzerError {}

/**
 * Thrown when a candidate manifest does not conform to
 * `src/manifest/schema.json` (or the contract's other rules). Inside the
 * Analyzer this usually triggers the retry; once retries are exhausted it
 * becomes the `cause` of an {@link AnalysisFailedError}.
 */
export class SchemaValidationError extends AnalyzerError {}

/**
 * Thrown when the call to the Claude API fails: network or API error,
 * timeout, cancellation through an `AbortSignal`, or the model declining
 * the request. Chain the SDK's original error as `cause`.
 */
export class ClaudeApiError extends AnalyzerError {}
