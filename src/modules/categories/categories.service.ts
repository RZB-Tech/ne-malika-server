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

const SERVICES_ROOT_SLUG = 'services';
const TREE_TTL_SEC = 3600;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly repository: CategoriesRepository,
    private readonly redis: RedisService,
  ) {}

  async getTree(): Promise<CategoryDto[]> {
    const cached = await this.redis.get<CategoryDto[]>(TREE_CACHE_KEY);
    if (cached) return cached;

    const tree = buildTree(await this.repository.findAll());
    await this.redis.set(TREE_CACHE_KEY, tree, TREE_TTL_SEC);
    return tree;
  }

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

  assertExists(categoryId: number | undefined): Promise<void> {
    return this.assertUsable(categoryId, true);
  }

  async describeForCheck(
    categoryId: number | null,
  ): Promise<{ label: string; isService: boolean } | null> {
    if (!categoryId) return null;

    const category = await this.repository.findById(categoryId);
    if (!category) return null;

    const root = await this.repository.findRootOf(categoryId);
    if (!root) return null;

    return {
      label:
        root.id === category.id
          ? root.nameRu
          : `${root.nameRu} · ${category.nameRu}`,
      isService: root.slug === SERVICES_ROOT_SLUG,
    };
  }

  findSubtreeIds(categoryId: number): Promise<number[]> {
    return this.repository.findSubtreeIds(categoryId);
  }

  findRootBySlug(slug: string) {
    return this.repository.findRootBySlug(slug);
  }
}

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

  for (const root of roots) inheritRestricted(root, root.restricted);

  return roots;
}

function inheritRestricted(node: CategoryDto, restricted: boolean): void {
  node.restricted = restricted;
  for (const child of node.children) {
    inheritRestricted(child, restricted || child.restricted);
  }
}
