/**
 * @file Automatic checks run on the project after every change.
 *
 * The chat doesn't know what a "check" is; it hands the changed project (as
 * a zip) to a {@link ProjectChecker} and gets back passed / failed /
 * unavailable plus a short summary. That keeps it independent of whatever
 * does the checking. For SimplyOpen, {@link HttpProjectChecker} posts the zip
 * to a URL such as the Analyzer's `POST /analyze`, whose answer (for example
 * the new manifest, for the live preview) is passed through untouched.
 */

/** The outcome of checking one version of the project. */
export interface CheckResult {
  /**
   * - `passed`: the checks ran and the project is fine.
   * - `failed`: the checks ran and found a problem with the project itself.
   * - `unavailable`: the checks couldn't run (service down, timed out), which says nothing about the project.
   */
  status: "passed" | "failed" | "unavailable";
  /** One short sentence: what was found, or why the checks couldn't run. */
  summary: string;
  /** Whatever the checker returned, passed through for the app (e.g. the Analyzer's manifest). Never shown to Claude. */
  report?: unknown;
}

/** Anything that can check a version of the project. */
export interface ProjectChecker {
  /**
   * @param zip The whole project, as a zip.
   * @param signal Cancels the check.
   * @returns Never throws: a check that can't run is `unavailable`.
   */
  check(zip: Uint8Array, signal: AbortSignal): Promise<CheckResult>;
}

/**
 * Checks a project by posting it as `multipart/form-data` (field `file`) to
 * a URL. A 2xx answer means passed (its JSON body becomes `report`); a 4xx
 * answer means the project has a problem (its `error.message`, if any,
 * becomes the summary); anything else, or no answer, means unavailable.
 */
export class HttpProjectChecker implements ProjectChecker {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async check(zip: Uint8Array, signal: AbortSignal): Promise<CheckResult> {
    const form = new FormData();
    form.append("file", new Blob([zip], { type: "application/zip" }), "project.zip");
    let response: Response;
    try {
      response = await fetch(this.url, { method: "POST", body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) });
    } catch {
      return { status: "unavailable", summary: "The automatic checks couldn't be reached." };
    }
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null ? (body as { error?: { message?: unknown } }).error?.message : undefined;
    if (response.ok) return { status: "passed", summary: "The automatic checks passed.", report: body };
    if (response.status >= 400 && response.status < 500) {
      return { status: "failed", summary: typeof message === "string" ? message : `The automatic checks failed (${response.status}).`, report: body };
    }
    return { status: "unavailable", summary: `The automatic checks couldn't run (${response.status}).` };
  }
}
