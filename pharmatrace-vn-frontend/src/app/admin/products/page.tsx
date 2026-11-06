'use client';

import { useHydrated } from '@/hooks/useHydrated';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Table,
  Button as AButton,
  Input,
  Popconfirm,
  Tag,
  Grid,
  Select,
  Modal,
  Pagination,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { productService } from '@/services/product.service';
import { categoryService } from '@/services/category.service';
import { formatCurrency, cn } from '@/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { Product } from '@/types/product.types';
import { Category } from '@/types/category.types';

const { useBreakpoint } = Grid;

export default function AdminProductsPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const [messageApi, contextHolder] = message.useMessage();
  const mounted = useHydrated();

  const [data, setData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);

  // Filters State
  const [searchVal, setSearchVal] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [prescriptionFilter, setPrescriptionFilter] = useState<boolean | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);

  const screens = useBreakpoint();
  const isMobile = screens.md === false;

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  useEffect(() => {
    categoryService.getCategories().then((res) => {
      if (res?.data) setCategories(res.data);
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let sortBy: 'id' | 'price' | 'name' | 'createdAt' = 'id';
      let sortOrder: 'asc' | 'desc' = 'desc';

      if (sort === 'newest') {
        sortBy = 'id';
        sortOrder = 'desc';
      } else if (sort === 'oldest') {
        sortBy = 'id';
        sortOrder = 'asc';
      } else if (sort === 'price_asc') {
        sortBy = 'price';
        sortOrder = 'asc';
      } else if (sort === 'price_desc') {
        sortBy = 'price';
        sortOrder = 'desc';
      } else if (sort === 'name_asc') {
        sortBy = 'name';
        sortOrder = 'asc';
      } else if (sort === 'name_desc') {
        sortBy = 'name';
        sortOrder = 'desc';
      }

      const res = await productService.getProducts({
        page,
        limit: 20,
        search: searchVal.trim() || undefined,
        categoryId: categoryFilter,
        isPrescription: prescriptionFilter,
        status: statusFilter,
        sortBy,
        sortOrder,
      });

      if (res && res.data) {
        setData(res.data);
        setTotal(res.pagination.total);
      }
    } catch {
      messageApi.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [page, searchVal, categoryFilter, prescriptionFilter, statusFilter, sort, messageApi]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      if (mounted && isAuthenticated) {
        fetchData();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [mounted, isAuthenticated, fetchData]);

  const handleResetFilters = () => {
    setSearchVal('');
    setCategoryFilter(undefined);
    setPrescriptionFilter(undefined);
    setStatusFilter(undefined);
    setSort('newest');
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await productService.deleteProduct(id);
      if (res?.message?.includes('INACTIVE') || res?.message?.includes('inactive')) {
        messageApi.info(res.message || 'Product has been set to Hidden status to preserve data history.');
      } else {
        messageApi.success(res?.message || 'Product deleted permanently.');
      }
      fetchData();
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to delete product.');
    }
  };

  const handleToggleStatus = async (item: Product) => {
    try {
      const newStatus = (item.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await productService.updateProduct(item.id, { status: newStatus });
      messageApi.success(newStatus === 'ACTIVE' ? 'Product is now Visible' : 'Product is now Hidden');
      fetchData();
    } catch {
      messageApi.error('Failed to update status');
    }
  };

  const openDetailModal = (prod: Product) => {
    setViewingProduct(prod);
    setDetailModalOpen(true);
  };

  // table columns
  const columns = [
    {
      title: 'Product',
      dataIndex: 'medicineName',
      key: 'name',
      render: (name: string, row: Product) => (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.imageUrl || '/favicon.ico'}
            alt={name}
            className="w-9 h-9 rounded-[6px] object-contain bg-slate-50 border border-slate-100 p-1 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[13px] sm:text-[14px] leading-tight text-slate-900 line-clamp-1">
                {name}
              </span>
              {row.isPrescription && (
                <span className="px-1.5 py-0.2 rounded-[6px] text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  Rx
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate m-0 mt-0.5">
              {row.manufacturer || row.activeIngredients || 'Pharma Product'}
            </p>
          </div>
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      responsive: ['sm'] as any,
      width: 170,
      render: (_: any, row: Product) => (
        <Tag className="text-[11px] font-medium px-2 py-0.5 rounded-[6px] border-slate-200 bg-slate-50 text-slate-700 m-0">
          {row.category?.categoryName || 'General'}
        </Tag>
      ),
    },
    {
      title: 'Price',
      dataIndex: 'unitPrice',
      key: 'price',
      responsive: ['sm'] as any,
      width: 150,
      align: 'right' as const,
      render: (v: number, row: Product) => {
        const hasPromo = row.promotionalPrice && row.promotionalPrice < v;
        return (
          <div className="text-right">
            <span className="text-[13px] font-semibold text-slate-800 whitespace-nowrap block">
              {formatCurrency(hasPromo ? row.promotionalPrice! : v)}
            </span>
            {hasPromo && (
              <span className="text-[10px] text-slate-400 line-through whitespace-nowrap block">
                {formatCurrency(v)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Action',
      key: 'action',
      responsive: ['sm'] as any,
      width: 100,
      align: 'center' as const,
      render: (_: any, row: Product) => (
        <AButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            openDetailModal(row);
          }}
          className="font-medium text-xs rounded-[6px] bg-slate-50 hover:bg-[#1e4287] hover:text-white border-slate-200 text-slate-700 h-7 px-3"
        >
          Detail
        </AButton>
      ),
    },
  ];

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  return (
    <>
      {contextHolder}

      <div className="space-y-5 animate-fade-in font-sans w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">
              Medicines & Products
            </h1>
            <p className="text-slate-500 text-xs m-0 mt-0.5">
              Directory of pharmaceutical products, pricing, and active catalog ({total} total)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ReloadOutlined className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
            <Link href="/admin/products/new">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-[#1e4287] hover:bg-[#163266] text-white text-xs font-medium transition-colors cursor-pointer border-none shadow-xs"
              >
                <PlusOutlined />
                Add Product
              </button>
            </Link>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-3 sm:p-3.5 rounded-[6px] border border-slate-200/80 shadow-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-2.5">
            <Input
              placeholder="Search name, ingredients, SDK..."
              prefix={<SearchOutlined className="text-slate-400 text-xs" />}
              value={searchVal}
              onChange={(e) => {
                setSearchVal(e.target.value);
                setPage(1);
              }}
              allowClear
              className="col-span-2 sm:col-span-3 md:col-span-2 rounded-[6px] text-xs h-9 sm:h-auto w-full"
            />

            <Select
              placeholder="Category"
              value={categoryFilter}
              onChange={(v) => {
                setCategoryFilter(v);
                setPage(1);
              }}
              options={categories.map((c) => ({ value: c.id, label: c.categoryName }))}
              allowClear
              showSearch
              className="col-span-1 text-xs h-9 sm:h-auto w-full"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />

            <Select
              placeholder="Prescription"
              value={prescriptionFilter}
              onChange={(v) => {
                setPrescriptionFilter(v);
                setPage(1);
              }}
              options={[
                { value: true, label: 'Rx (Prescription)' },
                { value: false, label: 'OTC (Non-Rx)' },
              ]}
              allowClear
              className="col-span-1 text-xs h-9 sm:h-auto w-full"
            />

            <Select
              placeholder="Status"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Hidden' },
              ]}
              allowClear
              className="col-span-1 text-xs h-9 sm:h-auto w-full"
            />

            <div className="col-span-1 sm:col-span-2 md:col-span-1 flex gap-1.5">
              <Select
                value={sort}
                onChange={(v) => {
                  setSort(v);
                  setPage(1);
                }}
                className="flex-1 text-xs h-9 sm:h-auto"
                options={[
                  { label: 'Newest', value: 'newest' },
                  { label: 'Oldest', value: 'oldest' },
                  { label: 'Price: Low-High', value: 'price_asc' },
                  { label: 'Price: High-Low', value: 'price_desc' },
                  { label: 'Name: A-Z', value: 'name_asc' },
                ]}
              />
              <button
                type="button"
                onClick={handleResetFilters}
                title="Reset Filters"
                className="px-2.5 py-1.5 border border-slate-200 rounded-[6px] text-slate-500 hover:bg-slate-50 text-xs transition-colors bg-white cursor-pointer h-9 sm:h-auto flex items-center justify-center"
              >
                <ReloadOutlined />
              </button>
            </div>
          </div>
        </div>

        {/* Table View */}
        <div className="bg-white rounded-[6px] border border-slate-200/80 shadow-xs overflow-hidden">
          <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="middle"
            onRow={(record) => ({
              onClick: () => openDetailModal(record),
              className: 'cursor-pointer hover:bg-slate-50/80 transition-colors',
            })}
          />

          {/* Pagination Footer */}
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              Showing {total > 0 ? (page - 1) * 20 + 1 : 0} -{' '}
              {Math.min(page * 20, total)} of {total} products
            </span>
            <Pagination
              className="ml-auto"
              current={page}
              pageSize={20}
              total={total}
              onChange={(p) => setPage(p)}
              showSizeChanger={false}
              size="small"
              itemRender={(_page, type, originalElement) => {
                if (type === 'prev') {
                  return <span className="px-1 text-slate-600 text-xs font-medium">&lt; Previous</span>;
                }
                if (type === 'next') {
                  return <span className="px-1 text-[#1e4287] text-xs font-medium">Next &gt;</span>;
                }
                return originalElement;
              }}
            />
          </div>
        </div>

        {/* Product Detail Modal */}
        <Modal
          title={
            <div className="flex items-center justify-between pr-6 pb-2 border-b border-slate-100">
              <span className="text-base font-semibold text-slate-900">Product Specifications</span>
              {viewingProduct && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        (viewingProduct.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                          ? 'bg-emerald-500'
                          : 'bg-slate-300',
                      )}
                    />
                    {(viewingProduct.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'Active' : 'Hidden'}
                  </span>

                  {viewingProduct.isPrescription && (
                    <span className="px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      Rx
                    </span>
                  )}
                </div>
              )}
            </div>
          }
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          centered
          width={640}
          footer={
            viewingProduct ? (
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 flex-wrap gap-2">
                <div>
                  <Popconfirm
                    title="Delete product?"
                    description={`Are you sure you want to delete "${viewingProduct.medicineName}"?`}
                    onConfirm={async () => {
                      await handleDelete(viewingProduct.id);
                      setDetailModalOpen(false);
                    }}
                    okText="Delete"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                  >
                    <AButton danger icon={<DeleteOutlined />} className="rounded-[6px] font-medium text-xs">
                      Delete
                    </AButton>
                  </Popconfirm>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/admin/products/${viewingProduct.id}/edit`}>
                    <AButton
                      type="primary"
                      icon={<EditOutlined />}
                      className="rounded-[6px] font-medium text-xs bg-[#1e4287] !shadow-none"
                    >
                      Edit Product Specifications
                    </AButton>
                  </Link>
                </div>
              </div>
            ) : null
          }
        >
          {viewingProduct && (() => {
            const dt = (typeof viewingProduct.details === 'object' && viewingProduct.details !== null)
              ? viewingProduct.details
              : {};
            const indications = Array.isArray(dt.indications) ? dt.indications : [];
            const contraindications = Array.isArray(dt.contraindications) ? dt.contraindications : [];
            const warnings = Array.isArray(dt.warningsAndPrecautions) ? dt.warningsAndPrecautions : [];
            const sideEffects = Array.isArray(dt.sideEffects) ? dt.sideEffects : [];

            const usage = dt.usageInstructions || {};

            const sp = dt.specialPatientGroups || {};
            const pregnancy = sp.pregnancy;
            const lactation = sp.lactation;
            const pediatric = sp.pediatric || sp.pediatricUse;
            const geriatric = sp.geriatric || sp.elderly;

            const mfg = dt.manufacturingInfo || {};
            const manufacturer = viewingProduct.manufacturer || mfg.manufacturer;
            const origin = viewingProduct.countryOfOrigin || mfg.origin || 'Vietnam';
            const storage = mfg.storage;
            const packagingFormat = viewingProduct.packaging?.unitName || mfg.packaging;

            const activeIng = dt.detailedIngredients?.activeIngredients ||
              viewingProduct.activeIngredients ||
              (Array.isArray(dt.ingredients) ? dt.ingredients.join(', ') : 'Standard formulation');

            const generalDesc = dt.generalDescription || viewingProduct.shortDescription;

            return (
              <div className="py-2 space-y-3.5 max-h-[75vh] overflow-y-auto pr-1">
                {/* Top Banner: Product Thumbnail + Title + Categories */}
                <div className="flex items-start gap-3.5 p-3.5 bg-slate-50/70 rounded-[6px] border border-slate-200/70">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewingProduct.imageUrl || '/favicon.ico'}
                    alt={viewingProduct.medicineName}
                    className="w-14 h-14 rounded-[6px] object-contain bg-white border border-slate-200 p-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-slate-900 m-0 leading-snug">
                      {viewingProduct.medicineName}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {viewingProduct.categories && viewingProduct.categories.length > 0 ? (
                        viewingProduct.categories.map((c: any) => (
                          <span
                            key={c.id}
                            className={cn(
                              'text-xs font-medium px-2 py-0.5 rounded-[6px] border',
                              c.isPrimary
                                ? 'bg-slate-100 text-slate-800 border-slate-300'
                                : 'bg-white text-slate-600 border-slate-200',
                            )}
                          >
                            {c.categoryName} {c.isPrimary && ' (Primary)'}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500 font-medium bg-white px-2 py-0.5 rounded-[6px] border border-slate-200">
                          {viewingProduct.category?.categoryName || 'General'}
                        </span>
                      )}
                      {viewingProduct.registrationNumber && (
                        <span className="text-xs font-mono text-slate-500 bg-white px-2 py-0.5 rounded-[6px] border border-slate-200">
                          Visa: {viewingProduct.registrationNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pricing, Packaging & Inventory */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 bg-slate-50/50 rounded-[6px] border border-slate-200/70">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block mb-0.5">
                      Retail Price
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {formatCurrency(viewingProduct.unitPrice)}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50/50 rounded-[6px] border border-slate-200/70">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block mb-0.5">
                      Promo Price
                    </span>
                    <span className="text-sm font-semibold text-emerald-600">
                      {viewingProduct.promotionalPrice
                        ? formatCurrency(viewingProduct.promotionalPrice)
                        : 'None'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50/50 rounded-[6px] border border-slate-200/70">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block mb-0.5">
                      Packaging
                    </span>
                    <span className="text-xs font-mono font-medium text-slate-700">
                      {packagingFormat || 'Box'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50/50 rounded-[6px] border border-slate-200/70">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block mb-0.5">
                      System Stock
                    </span>
                    <span className="text-xs font-medium text-slate-800">
                      {(viewingProduct.totalStock ?? 0).toLocaleString()} in stock
                    </span>
                  </div>
                </div>

                {/* Clinical & Pharmacology Details */}
                <div className="bg-white p-4 rounded-[6px] border border-slate-200 divide-y divide-slate-100 space-y-4">
                  {/* 1. Ingredients */}
                  <div className="space-y-1.5 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">1.</span>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        Active Formulation & Ingredients
                      </p>
                    </div>
                    <div className="pl-4 space-y-1">
                      <p className="text-sm text-slate-700 m-0 leading-relaxed">
                        {activeIng}
                      </p>
                      {generalDesc && (
                        <p className="text-sm text-slate-700 m-0 leading-relaxed pt-0.5">
                          {generalDesc}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 2. Indications */}
                  <div className="space-y-1.5 pt-4 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">2.</span>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        Indications & Approved Uses
                      </p>
                    </div>
                    <div className="pl-4">
                      {indications.length > 0 ? (
                        <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1 m-0 leading-relaxed">
                          {indications.map((ind: string, i: number) => (
                            <li key={i}>{ind}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-400 italic m-0">No indications specified.</p>
                      )}
                    </div>
                  </div>

                  {/* 3. Directions for Use */}
                  <div className="space-y-1.5 pt-4 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">3.</span>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        Directions for Use & Administration
                      </p>
                    </div>
                    <div className="pl-4 space-y-1.5 text-sm text-slate-700 leading-relaxed">
                      {usage.administration && (
                        <p className="m-0">
                          <span className="font-bold text-slate-900">Administration: </span>
                          {usage.administration}
                        </p>
                      )}
                      {(usage.dosage || viewingProduct.dosage) && (
                        <p className="m-0">
                          <span className="font-bold text-slate-900">Dosage: </span>
                          {usage.dosage || viewingProduct.dosage}
                        </p>
                      )}
                      {!usage.administration && !usage.dosage && !viewingProduct.dosage && (
                        <p className="text-slate-400 italic m-0">Standard clinical dosing as directed by physician.</p>
                      )}
                      {usage.missedDose && (
                        <p className="m-0 text-slate-700">
                          <span className="font-bold text-slate-900">Missed dose: </span>
                          {usage.missedDose}
                        </p>
                      )}
                      {usage.overdoseManagement && (
                        <p className="m-0 text-slate-700">
                          <span className="font-bold text-slate-900">Overdose: </span>
                          {usage.overdoseManagement}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 4. Precautions & Safety Warnings */}
                  <div className="space-y-1.5 pt-4 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">4.</span>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        Precautions, Contraindications & Safety
                      </p>
                    </div>
                    <div className="pl-4 space-y-3 text-sm">
                      {contraindications.length > 0 && (
                        <div>
                          <span className="font-bold text-slate-900 block mb-1 text-sm">Contraindications:</span>
                          <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                            {contraindications.map((c: string, i: number) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {warnings.length > 0 && (
                        <div>
                          <span className="font-bold text-slate-900 block mb-1 text-sm">Warnings & Precautions:</span>
                          <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                            {warnings.map((w: string, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {sideEffects.length > 0 && (
                        <div>
                          <span className="font-bold text-slate-900 block mb-1 text-sm">Side Effects:</span>
                          <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                            {sideEffects.map((s: string, i: number) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(pregnancy || lactation || pediatric || geriatric) && (
                        <div className="bg-slate-50 p-3.5 rounded-[6px] border border-slate-200/80 text-slate-700 space-y-1.5 text-sm">
                          <span className="font-bold text-slate-900 block text-sm">Special Patient Considerations:</span>
                          {pregnancy && (
                            <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Pregnancy: </span>{pregnancy}</p>
                          )}
                          {lactation && (
                            <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Lactation: </span>{lactation}</p>
                          )}
                          {pediatric && (
                            <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Pediatric Use: </span>{pediatric}</p>
                          )}
                          {geriatric && (
                            <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Geriatric Use: </span>{geriatric}</p>
                          )}
                        </div>
                      )}
                      {contraindications.length === 0 && warnings.length === 0 && sideEffects.length === 0 && !pregnancy && !lactation && !pediatric && !geriatric && (
                        <p className="text-slate-400 italic m-0">No special contraindications recorded.</p>
                      )}
                    </div>
                  </div>

                  {/* 5. Manufacturing Info */}
                  <div className="space-y-1.5 pt-4 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">5.</span>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        Manufacturing & Storage Information
                      </p>
                    </div>
                    <div className="pl-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-700 pt-1">
                      <div>
                        <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Manufacturer</span>
                        <span className="font-medium text-slate-900">{manufacturer || 'Not specified'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Origin</span>
                        <span className="font-medium text-slate-900">{origin}</span>
                      </div>
                      {storage && (
                        <div className="sm:col-span-2">
                          <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Storage Conditions</span>
                          <span className="text-slate-800">{storage}</span>
                        </div>
                      )}
                      {packagingFormat && (
                        <div className="sm:col-span-2">
                          <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Packaging Format</span>
                          <span className="text-slate-800">{packagingFormat}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </Modal>
      </div>
    </>
  );
}
