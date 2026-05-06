/**
 * Structured error hierarchy for opentui-glyphfit.
 *
 * All errors thrown by the public API extend `GlyphFitError`, so callers can
 * branch with a single `instanceof` check or filter logs without coupling to
 * specific subclasses.
 */

export class GlyphFitError extends Error {
  override readonly name: string = "GlyphFitError"
  constructor(message: string) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the source intensity field has an invalid shape or contents. */
export class InvalidFieldError extends GlyphFitError {
  override readonly name = "InvalidFieldError"
}

/** Thrown when a charset is empty or malformed. */
export class InvalidCharsetError extends GlyphFitError {
  override readonly name = "InvalidCharsetError"
}

/** Thrown when `DrawGlyphFitOptions` contains invalid values (gamma, threshold, dims). */
export class InvalidOptionsError extends GlyphFitError {
  override readonly name = "InvalidOptionsError"
}
