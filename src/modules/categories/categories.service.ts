import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CategoriesRepository } from './categories.repository';
import { RedisService } from '../redis/redis.service';
import { CategoryDto } from './dto/category.dto';
import type { Category } from '../../db/schema';

const TREE_CACHE_KEY = 'categories:tree';
/** Дерево меняется вручную и редко, а читается на каждой странице каталога. */
const TREE_TTL_SEC = 3600;

@Injectable()
export class CategoriesService {
  /**
   * Дерево меняется миграциями, а они катятся при деплое — то есть ровно тогда,
   * когда поднимается процесс. Поэтому первый запрос после старта идёт мимо
   * кэша и перезаписывает его: иначе новые категории ждали бы конца часового
   * TTL, и каталог после деплоя выглядел бы неизменившимся.
   *
   * Сброс именно здесь, а не в onModuleInit: на старте соединение с Redis ещё
   * не поднято, а клиент живёт без офлайн-очереди — команда просто потерялась бы.
   */
  private cacheStale = true;

  constructor(
    private readonly repository: CategoriesRepository,
    private readonly redis: RedisService,
  ) {}

  async getTree(): Promise<CategoryDto[]> {
    if (!this.cacheStale) {
      const cached = await this.redis.get<CategoryDto[]>(TREE_CACHE_KEY);
      if (cached) return cached;
    }

    const tree = buildTree(await this.repository.findAll());
    await this.redis.set(TREE_CACHE_KEY, tree, TREE_TTL_SEC);
    this.cacheStale = false;
    return tree;
  }

  /**
   * Проверка категории при сохранении товара. Пустое значение допустимо:
   * товары, заведённые до появления каталога, категории не имеют.
   *
   * `allowRestricted` — есть ли у магазина разрешение на закрытые разделы.
   * Запрос лишний раз не делаем: у магазина с разрешением ответ один и тот же
   * для любой категории, а таких запросов — по одному на каждое сохранение.
   */
  async assertUsable(
    categoryId: number | undefined,
    allowRestricted: boolean,
  ): Promise<void> {
    if (categoryId === undefined) return;
    if (!(await this.repository.findById(categoryId))) {
      throw new BadRequestException('Категория не найдена');
    }
    if (allowRestricted) return;
    if (await this.repository.isRestricted(categoryId)) {
      throw new ForbiddenException(
        'Этот раздел каталога закрыт: выкладывать в него товары можно только с разрешения администратора',
      );
    }
  }

  /**
   * Категория существует — без проверки доступа. Для админских операций: админ
   * и есть тот, кто выдаёт разрешение, запрещать ему нечем.
   */
  assertExists(categoryId: number | undefined): Promise<void> {
    return this.assertUsable(categoryId, true);
  }

  /** Ветка каталога целиком — фильтр по «Ноутбукам» обязан включать «Игровые». */
  findSubtreeIds(categoryId: number): Promise<number[]> {
    return this.repository.findSubtreeIds(categoryId);
  }

  findRootBySlug(slug: string) {
    return this.repository.findRootBySlug(slug);
  }
}

/**
 * Плоский список в дерево за один проход: сортировку задал запрос, поэтому
 * порядок детей сохраняется сам собой.
 */
function buildTree(rows: Category[]): CategoryDto[] {
  const byId = new Map<number, CategoryDto>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: {
        ru: row.nameRu,
        'uz-Latn': row.nameUzLatn,
        'uz-Cyrl': row.nameUzCyrl,
      },
      icon: row.icon,
      restricted: row.restricted,
      children: [],
    });
  }

  const roots: CategoryDto[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  /**
   * Запрет наследуется сверху вниз отдельным проходом, а не в цикле выше:
   * порядок строк задан позицией, и ребёнок вполне может встретиться раньше
   * родителя — тогда наследовать было бы ещё нечего.
   */
  for (const root of roots) inheritRestricted(root, root.restricted);

  return roots;
}

function inheritRestricted(node: CategoryDto, restricted: boolean): void {
  node.restricted = restricted;
  for (const child of node.children) {
    inheritRestricted(child, restricted || child.restricted);
  }
}
