/** Ошибка Postgres «нарушено уникальное ограничение». */
const UNIQUE_VIOLATION = '23505';

/**
 * Уникальный индекс не пустил запись.
 *
 * Ловим ошибку вместо предварительной проверки: между «посмотрели, что свободно»
 * и вставкой помещается второй такой же запрос, и гонку разрешает только сама
 * база. Раньше эта проверка была написана дважды — в магазинах с именем
 * ограничения, в отзывах без него, — и расходились они молча.
 *
 * `constraint` — имя индекса, когда таблицу защищает не один: без него отказ по
 * чужому ограничению превратился бы в неверное сообщение пользователю.
 */
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
