const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, constraint: actual } = error as {
    code?: string;
    constraint?: string;
  };
  if (code !== UNIQUE_VIOLATION) return false;

  return constraint === undefined || actual === constraint;
}
