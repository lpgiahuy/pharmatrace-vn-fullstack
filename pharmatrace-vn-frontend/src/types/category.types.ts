export interface Category {
  id: number;
  categoryName: string;
  slug?: string | null;
  description?: string | null;
  icon?: string | null;
  parentId?: number | null;
  displayOrder?: number;
  status?: string;
  totalMedicines?: number;
  children?: Category[];
}

export interface CategoryTreeItem extends Category {
  key: number;
  title: string;
  children?: CategoryTreeItem[];
}

export interface CategoryPayload {
  categoryName: string;
  slug?: string;
  description?: string;
  icon?: string;
  parentId?: number | null;
  displayOrder?: number;
  status?: string;
}

export interface CategoryResponse<T = any> {
  success: boolean;
  message?: string;
  data: T;
}
