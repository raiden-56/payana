import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageQuery, type Paginated } from '@payana/contracts';

export class PageQueryDto implements PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export interface PageWindow {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export function pageWindow(q: PageQuery): PageWindow {
  const page = q.page ?? 1;
  const pageSize = Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(items: T[], total: number, w: PageWindow): Paginated<T> {
  return { items, page: w.page, pageSize: w.pageSize, total };
}
