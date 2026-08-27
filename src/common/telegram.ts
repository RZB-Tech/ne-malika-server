export function buildFullname(
  firstName: string | undefined,
  lastName: string | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'Без имени';
}
