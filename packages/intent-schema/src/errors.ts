/** Thrown when a policy is structurally valid but semantically unusable. */
export class SemanticValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Policy failed semantic validation: ${issues.join('; ')}`);
    this.name = 'SemanticValidationError';
    this.issues = issues;
  }
}

/** Thrown when a compiler produced output that does not match the schema. */
export class SchemaValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Compiler output failed schema validation: ${issues.join('; ')}`);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}
