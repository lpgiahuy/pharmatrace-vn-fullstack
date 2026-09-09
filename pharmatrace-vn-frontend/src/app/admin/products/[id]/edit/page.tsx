'use client';

import { use } from 'react';
import ProductForm from '@/components/admin/ProductForm';

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const productId = Number(resolvedParams.id);

  return <ProductForm productId={productId} />;
}

