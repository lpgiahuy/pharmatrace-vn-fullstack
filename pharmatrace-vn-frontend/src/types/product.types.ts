export interface PackagingSpecification {
  id: number;
  unitName: string;
  description?: string | null;
}

export interface ProductReview {
  id: number;
  rating: number;
  content: string;
  images?: string[];
  createdAt?: string;
  customerName: string;
}

export interface Product {
  id: number;
  medicineName: string;
  categoryId?: number | null;
  packagingId?: number | null;
  registrationNumber?: string | null;
  activeIngredients?: string | null;
  dosage?: string | null;
  manufacturer?: string | null;
  countryOfOrigin?: string | null;
  unitPrice: number;
  promotionalPrice?: number | null;
  discountPercent?: number | null;
  imageUrl?: string | null;
  shortDescription?: string | null;
  details?: Record<string, any>;
  isPrescription: boolean;
  status?: string;
  totalStock?: number;
  createdAt?: string;
  category?: {
    id: number;
    categoryName: string;
    description?: string | null;
    icon?: string | null;
  } | null;
  categories?: {
    id: number;
    categoryName: string;
    icon?: string | null;
    isPrimary?: boolean;
  }[];
  slug?: string | null;
  packaging?: {
    id: number;
    unitName: string;
    description?: string | null;
  } | null;
  packagingOptions?: {
    id: number;
    unitName: string;
    price: number;
    originalPrice?: number | null;
    discountPercent?: number;
    saleStartDate?: string | null;
    saleEndDate?: string | null;
  }[];
  totalReviews?: number;
  reviewsList?: ProductReview[];
}

export interface ProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: number | string;
  packagingId?: number;
  minPrice?: number;
  maxPrice?: number;
  manufacturer?: string;
  countryOfOrigin?: string;
  isPrescription?: boolean;
  status?: string;
  sortBy?: 'id' | 'price' | 'name' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedProductsResponse {
  success: boolean;
  message?: string;
  data: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ProductPayload {
  medicineName: string;
  primaryCategoryId?: number;
  categoryIds?: number[];
  categoryId?: number;
  registrationNumber?: string;
  activeIngredients?: string;
  dosage?: string;
  manufacturer?: string;
  countryOfOrigin?: string;
  unitPrice: number;
  promotionalPrice?: number;
  imageUrl?: string;
  shortDescription?: string;
  details?: Record<string, any>;
  isPrescription?: boolean;
  status?: string;
  packagingVariants?: {
    unitName: string;
    price: number;
    originalPrice?: number;
    discountPercent?: number;
    isBaseUnit?: boolean;
    saleStartDate?: string | Date;
    saleEndDate?: string | Date;
  }[];
}
