export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export function parsePage(page?: unknown, pageSize?: unknown, defaultSize = 24, maxSize = 100): PageRequest {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const s = Math.min(maxSize, Math.max(1, Math.floor(Number(pageSize) || defaultSize)));
  return { page: p, pageSize: s };
}

export function paginate<T>(items: T[], req: PageRequest, total: number): Paginated<T> {
  return { items, page: req.page, pageSize: req.pageSize, total };
}
