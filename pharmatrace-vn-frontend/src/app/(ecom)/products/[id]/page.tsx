'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Spin,
  message,
} from 'antd';
import {
  ShoppingCart,
  Shield,
  Truck,
  RotateCcw,
  Plus,
  Minus,
  ChevronRight,
  ChevronDown,
  Award,
  Building2,
  Globe,
  Package,
  Thermometer,
  Star,
  FileCheck2,
  Heart,
} from 'lucide-react';
import { productService } from '@/services/product.service';
import { wishlistService } from '@/services/wishlist.service';
import { useAuth } from '@/store/useAuthStore';
import { Product } from '@/types/product.types';
import { formatCurrency, cleanText, cn } from '@/utils';

const KEY_LABEL_MAP: Record<string, string> = {
  // English keys mapping
  indications: 'INDICATIONS & USAGE',
  contraindications: 'CONTRAINDICATIONS / DO NOT USE IF',
  sideEffects: 'POTENTIAL SIDE EFFECTS',
  warningsAndPrecautions: 'WARNINGS & PRECAUTIONS',
  usageInstructions: 'USAGE INSTRUCTIONS',
  detailedIngredients: 'DETAILED INGREDIENTS',
  pharmacodynamics: 'PHARMACODYNAMICS',
  pharmacokinetics: 'PHARMACOKINETICS',
  drugInteractions: 'DRUG INTERACTIONS',
  specialPatientGroups: 'SPECIAL PATIENT CONSIDERATIONS',
  effectsOnDriving: 'EFFECTS ON DRIVING & MACHINERY',
  manufacturingInfo: 'MANUFACTURING INFORMATION',
  administration: 'HOW TO USE / ADMINISTRATION',
  dosage: 'DOSAGE & ADMINISTRATION',
  missedDose: 'MISSED DOSE ADVICE',
  overdoseManagement: 'OVERDOSE MANAGEMENT',
  activeIngredients: 'ACTIVE INGREDIENTS',
  excipients: 'EXCIPIENTS / OTHER INGREDIENTS',
  mechanismOfAction: 'MECHANISM OF ACTION',
  pharmacologicalEffects: 'PHARMACOLOGICAL EFFECTS',
  pharmacologicalClass: 'PHARMACOLOGICAL CLASS',
  absorption: 'ABSORPTION',
  distribution: 'DISTRIBUTION',
  metabolism: 'METABOLISM',
  elimination: 'ELIMINATION',
  pregnancy: 'PREGNANCY CONSIDERATIONS',
  lactation: 'LACTATION CONSIDERATIONS',
  pediatric: 'PEDIATRIC USE',
  pediatricUse: 'PEDIATRIC USE',
  elderly: 'SENIOR PATIENTS',
  geriatric: 'GERIATRIC USE',
  geriatricUse: 'GERIATRIC USE',
  storage: 'STORAGE CONDITIONS',
  manufacturer: 'MANUFACTURER',
  brand: 'BRAND / TRADEMARK',
  origin: 'COUNTRY OF ORIGIN',
  generalDescription: 'THERAPEUTIC OVERVIEW',
  adverseReactionManagement: 'ADVERSE REACTION MANAGEMENT',
};

function getEnglishLabel(key: string): string {
  if (KEY_LABEL_MAP[key]) return KEY_LABEL_MAP[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toUpperCase();
}

function hasValidContent(val: any): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const t = val.trim();
    return t !== '' && t !== '[object Object]';
  }
  if (Array.isArray(val)) {
    return val.length > 0 && val.some(hasValidContent);
  }
  if (typeof val === 'object') {
    return Object.values(val).some(hasValidContent);
  }
  return true;
}

function RenderSafeContent({
  content,
  className = 'text-base text-slate-700 leading-relaxed font-normal',
}: {
  content: any;
  className?: string;
}) {
  if (!hasValidContent(content)) return null;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed === '[object Object]' || trimmed === '') return null;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return <RenderSafeContent content={parsed} className={className} />;
      } catch {
        // Fallback to text
      }
    }
    return <p className={`${className} whitespace-pre-line m-0`}>{cleanText(content)}</p>;
  }

  if (Array.isArray(content)) {
    const validItems = content.filter(hasValidContent);
    if (validItems.length === 0) return null;
    return (
      <ul className={`list-disc pl-5 space-y-2 marker:text-black ${className}`}>
        {validItems.map((item: any, i: number) => (
          <li key={i} className="leading-relaxed">
            {typeof item === 'object' && item !== null ? (
              <RenderSafeContent content={item} className="mt-1" />
            ) : (
              cleanText(String(item))
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof content === 'object' && content !== null) {
    const entries = Object.entries(content).filter(([, val]) => hasValidContent(val));
    if (entries.length === 0) return null;

    return (
      <div className={`space-y-4 ${className}`}>
        {entries.map(([key, val]) => {
          const label = getEnglishLabel(key);

          return (
            <div key={key}>
              <h4 className="text-base font-bold text-slate-900 mb-1">
                {label}
              </h4>
              <RenderSafeContent content={val} className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal" />
            </div>
          );
        })}
      </div>
    );
  }

  const str = String(content);
  if (str === '[object Object]') return null;
  return <div className={className}>{cleanText(str)}</div>;
}

function TabCustomAttributesSection({
  attributes,
  title = 'Additional Specifications',
}: {
  attributes: { key: string; value: any }[];
  title?: string;
}) {
  if (!attributes || attributes.length === 0) return null;

  return (
    <section className="pt-5 mt-5 border-t border-slate-100">
      <h3 className="text-base font-bold text-slate-900 mb-2">
        {title}
      </h3>
      <div className="overflow-hidden rounded-xl border border-slate-200/80 shadow-2xs">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50/80">
            <tr>
              <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-900 uppercase tracking-wider w-1/3">
                Specification / Property
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-900 uppercase tracking-wider">
                Value / Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {attributes.map((attr, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40 hover:bg-blue-50/30 transition-colors'}>
                <td className="px-6 py-4 text-base font-bold text-slate-900 capitalize align-top">
                  {getEnglishLabel(attr.key)}
                </td>
                <td className="px-6 py-4 text-slate-700 font-normal leading-relaxed align-top text-[15px]">
                  <RenderSafeContent content={attr.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const productId = resolvedParams.id;

  const { isAuthenticated } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [selectedPackagingId, setSelectedPackagingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('ingredients');
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    productService
      .getProductById(productId)
      .then((res) => {
        if (res && res.data) {
          setProduct(res.data);
          if (res.data.packagingOptions && res.data.packagingOptions.length > 0) {
            setSelectedPackagingId(res.data.packagingOptions[0].id);
          }
          if (res.data.medicineName) {
            document.title = `${cleanText(res.data.medicineName)} | PharmaTrace VN`;
          }
        }
      })
      .catch(() => {
        messageApi.error('Failed to load product details');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [productId, messageApi]);

  useEffect(() => {
    if (!product?.id || !isAuthenticated) {
      setIsWishlisted(false);
      return;
    }
    wishlistService
      .checkIsWishlisted(product.id)
      .then((res) => {
        if (res?.data) {
          setIsWishlisted(Boolean(res.data.isWishlisted));
        }
      })
      .catch(() => { });
  }, [product?.id, isAuthenticated]);

  const handleToggleWishlist = async () => {
    if (!product) return;
    if (!isAuthenticated) {
      messageApi.warning('Please sign in to save items to your wishlist');
      return;
    }
    const nextStatus = !isWishlisted;
    setIsWishlisted(nextStatus);
    setWishlistLoading(true);
    try {
      if (!nextStatus) {
        await wishlistService.removeFromWishlist(product.id);
        messageApi.success('Removed from wishlist');
      } else {
        await wishlistService.addToWishlist(product.id);
        messageApi.success('Added to wishlist');
      }
    } catch (err: any) {
      setIsWishlisted(!nextStatus);
      const errMsg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to update wishlist';
      messageApi.error(errMsg);
    } finally {
      setWishlistLoading(false);
    }
  };

  const handleAddToCart = () => {
    messageApi.info('Cart feature is coming soon.');
  };

  if (loading) {
    return (
      <div className="py-32 text-center">
        <Spin size="large" />
        <p className="mt-4 text-slate-400 text-sm">Loading product details...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="py-24 text-center space-y-4">
        <Package className="w-16 h-16 text-slate-300 mx-auto" />
        <h2 className="text-xl font-bold text-slate-700">Product Not Found</h2>
        <Link href="/products" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#004996] text-white font-bold text-sm">
          Return to Products Catalog
        </Link>
      </div>
    );
  }

  const packagingOptions =
    product.packagingOptions && product.packagingOptions.length > 0
      ? product.packagingOptions
      : [
        {
          id: product.packaging?.id || 1,
          unitName: product.packaging?.unitName || 'Box',
          price: product.promotionalPrice || product.unitPrice,
          originalPrice: product.promotionalPrice ? product.unitPrice : null,
          discountPercent:
            product.promotionalPrice && product.unitPrice
              ? Math.round(
                ((product.unitPrice - Number(product.promotionalPrice)) /
                  product.unitPrice) *
                100,
              )
              : 0,
        },
      ];

  const activeOption =
    packagingOptions.find((opt) => opt.id === selectedPackagingId) ||
    packagingOptions[0];

  const activePrice = activeOption ? activeOption.price : (product.promotionalPrice || product.unitPrice);
  const activeOriginalPrice =
    activeOption && activeOption.originalPrice
      ? activeOption.originalPrice
      : product.promotionalPrice
        ? product.unitPrice
        : null;

  const activeUnitName = activeOption ? activeOption.unitName : (product.packaging?.unitName || 'Box');
  const discount =
    activeOriginalPrice && activePrice < activeOriginalPrice
      ? Math.round(((activeOriginalPrice - activePrice) / activeOriginalPrice) * 100)
      : 0;

  const isInStock = product.totalStock !== undefined ? product.totalStock > 0 : true;
  const ct: any = product.details || {};

  function categorizeCustomAttribute(key: string, explicitSection?: string): 'composition' | 'indications' | 'usage' | 'safety' | 'manufacturing' {
    if (explicitSection) {
      if (explicitSection === 'composition' || explicitSection === 'ingredients') return 'composition';
      if (explicitSection === 'indications' || explicitSection === 'pharmacology') return 'indications';
      if (explicitSection === 'usage' || explicitSection === 'dosage') return 'usage';
      if (explicitSection === 'safety' || explicitSection === 'precautions' || explicitSection === 'interactions') return 'safety';
      if (explicitSection === 'manufacturing' || explicitSection === 'origin') return 'manufacturing';
    }

    const k = key.toLowerCase();
    if (
      k.includes('duoc_luc') || k.includes('duoc_dong') ||
      k.includes('pharmacodynamic') || k.includes('pharmacokinetic') ||
      k.includes('co_che') || k.includes('mechanism') ||
      k.includes('absorption') || k.includes('metabolism') || k.includes('elimination') ||
      k.includes('chi_dinh') || k.includes('indication') || k.includes('cong_dung')
    ) {
      return 'indications';
    }

    if (
      k.includes('tac_dung') || k.includes('adverse') || k.includes('side_effect') ||
      k.includes('canh_bao') || k.includes('than_trong') || k.includes('chong_chi_dinh') ||
      k.includes('warning') || k.includes('precaution') || k.includes('tuong_tac') ||
      k.includes('interaction') || k.includes('lai_xe') || k.includes('driving') ||
      k.includes('xu_tri') || k.includes('contraindication') || k.includes('pregnancy') ||
      k.includes('lactation') || k.includes('pediatric') || k.includes('geriatric')
    ) {
      return 'safety';
    }

    if (
      k.includes('lieu') || k.includes('dose') || k.includes('dosage') ||
      k.includes('uong') || k.includes('cach_dung') || k.includes('usage') ||
      k.includes('admin') || k.includes('overdose') || k.includes('qua_lieu') ||
      k.includes('quen_lieu') || k.includes('missed_dose')
    ) {
      return 'usage';
    }

    if (
      k.includes('san_xuat') || k.includes('origin') || k.includes('mfg') ||
      k.includes('manufacturer') || k.includes('bao_quan') || k.includes('storage') ||
      k.includes('quy_cach') || k.includes('package') || k.includes('brand') ||
      k.includes('thuong_hieu') || k.includes('xuat_xu')
    ) {
      return 'manufacturing';
    }

    return 'composition';
  }

  const standardKeys = new Set([
    'ingredients', 'contraindications', 'manufacturingInfo', 'usageInstructions',
    'detailedIngredients', 'specialPatientGroups', 'warningsAndPrecautions',
    'indications', 'sideEffects', 'drugInteractions', 'generalDescription',
    'effectsOnDriving', 'thong_tin_san_xuat', 'huong_dan_su_dung', 'thanh_phan_chi_tiet',
    'nhom_benh_nhan_dac_biet', 'mo_ta_chung', 'chi_dinh', 'chong_chi_dinh',
    'tac_dung_phu', 'canh_bao_than_trong', 'anh_huong_lai_xe', 'duoc_luc_hoc',
    'duoc_dong_hoc', 'tuong_tac_thuoc', 'custom_fields', 'customFields',
    'extra_fields', 'extraFields', 'xu_tri_tac_dung_phu', 'pharmacodynamics', 'pharmacokinetics'
  ]);

  const customAttributesBySection = (() => {
    const grouped: Record<string, { key: string; value: any }[]> = {
      composition: [],
      indications: [],
      usage: [],
      safety: [],
      manufacturing: [],
    };

    if (ct.extra_fields && typeof ct.extra_fields === 'object') {
      Object.entries(ct.extra_fields).forEach(([sec, list]: [string, any]) => {
        if (Array.isArray(list)) {
          const targetSec = categorizeCustomAttribute('', sec);
          list.forEach((item: any) => {
            if (item?.key && !grouped[targetSec].some((x) => x.key === item.key)) {
              grouped[targetSec].push({ key: item.key, value: item.value });
            }
          });
        }
      });
    }

    const legacyFields: { key: string; value: any; section?: string }[] = [];
    if (Array.isArray(ct.custom_fields)) {
      legacyFields.push(...ct.custom_fields);
    } else if (Array.isArray(ct.customFields)) {
      legacyFields.push(...ct.customFields);
    } else if (ct.customFields && typeof ct.customFields === 'object') {
      Object.entries(ct.customFields).forEach(([k, v]) => {
        legacyFields.push({ key: k, value: v });
      });
    }

    Object.entries(ct).forEach(([k, v]) => {
      if (!standardKeys.has(k) && v !== null && v !== undefined && v !== '') {
        legacyFields.push({ key: k, value: v });
      }
    });

    legacyFields.forEach((item) => {
      if (!item?.key) return;
      const sec = categorizeCustomAttribute(item.key, item.section);
      if (!grouped[sec].some((x) => x.key === item.key)) {
        grouped[sec].push({ key: item.key, value: item.value });
      }
    });

    return grouped;
  })();

  const TABS = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'indications', label: 'Usage & Indications' },
    { id: 'usage', label: 'How to Use' },
    { id: 'precautions', label: 'Precautions' },
    { id: 'manufacturing', label: 'Manufacturing' },
    { id: 'reviews', label: 'Reviews' },
  ];

  return (
    <div className="w-full animate-fade-in space-y-6 sm:space-y-8 font-sans">
      {contextHolder}

      {/* Breadcrumb with category navigation */}
      <nav className="flex items-center gap-2 text-sm !text-black mb-6 flex-wrap" aria-label="Breadcrumb">
        <Link href="/products" className="!text-black hover:opacity-75 font-medium">Home</Link>
        <ChevronRight className="w-4 h-4 !text-black" />
        <Link href="/products" className="!text-black hover:opacity-75 font-medium">Products</Link>
        {product.category && (
          <>
            <ChevronRight className="w-4 h-4 !text-black" />
            <Link href={`/products?category=${product.category.id}`} className="!text-black hover:opacity-75 font-medium">
              {product.category.categoryName}
            </Link>
          </>
        )}
        <ChevronRight className="w-4 h-4 !text-black" />
        <span className="!text-black font-semibold truncate max-w-md">{cleanText(product.medicineName)}</span>
      </nav>

      {/* Product Hero 2 Columns */}
      <div className="grid md:grid-cols-2 gap-10 mb-12">
        {/* Left Column: Image Container + Trust Cards + Batch Info */}
        <div className="space-y-4">
          <div className="aspect-[1.25/1] rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center p-6 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.imageUrl || '/favicon.ico'}
              alt={product.medicineName}
              className="max-w-full max-h-full object-contain hover:scale-105 transition-transform duration-500"
            />

            <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 z-10">
              {discount > 0 && (
                <span className="bg-[#ed1c24] text-white text-xs font-black px-2.5 py-0.5 rounded-full shadow-xs w-fit">
                  -{discount}%
                </span>
              )}
              {product.isPrescription ? (
                <span className="bg-rose-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-xs w-fit">
                  Prescription Required (Rx)
                </span>
              ) : (
                <span className="bg-[#00A551] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-xs w-fit">
                  OTC Medicine
                </span>
              )}
            </div>

            <div className="absolute top-3 right-3 z-10">
              <div className="bg-[#004996] text-white flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full shadow-xs">
                <div className="w-4 h-4 rounded-full bg-[#00A551] flex items-center justify-center font-black text-[9px] text-white shrink-0">
                  P
                </div>
                <span className="text-[10px] font-black leading-none uppercase tracking-tight">
                  PharmaTrace VN
                </span>
              </div>
            </div>
          </div>

          {/* Batch info (Left Column) */}
          <div className="text-sm text-slate-500 space-y-1 pt-1">
            <p className="m-0">
              Registration No: <span className="font-mono text-slate-700 font-semibold">{product.registrationNumber || 'VD-28491-17'}</span>
            </p>
            <p className="m-0">
              Origin: <span className="text-slate-700 font-semibold">{product.countryOfOrigin || ct.thong_tin_san_xuat?.xuat_xu || 'Vietnam'}</span>
            </p>
          </div>
        </div>

        {/* Right Column: Info & Add to Cart */}
        <div>
          <p className="text-sm text-[#004996] font-bold uppercase tracking-wide mb-1">
            {cleanText(
              product.manufacturer ||
              ct.thong_tin_san_xuat?.nha_san_xuat ||
              ct.thong_tin_san_xuat?.thuong_hieu ||
              'Certified Pharma Partner',
            )}
          </p>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-slate-900 mb-2 leading-tight">
            {cleanText(product.medicineName)}
          </h1>

          {/* Multi-Category Badges */}
          {product.categories && product.categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">
                Categories:
              </span>
              {product.categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/products?category=${c.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[#004996] border border-blue-200 hover:bg-blue-100 transition-colors shadow-2xs"
                >
                  <span>{c.categoryName}</span>
                  {c.isPrimary && <span className="text-[10px] text-blue-500 font-medium ml-0.5">(Main)</span>}
                </Link>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-1 text-amber-400">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} className="w-4 h-4 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <span className="text-sm text-slate-500 font-bold">5.0</span>
            <span className="text-slate-300">|</span>
            <span className="text-sm text-slate-500">Sold 128 items</span>
          </div>

          {/* Packaging Unit Switcher */}
          <div className="mb-6">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
              Packaging Options
            </p>
            <div className="flex flex-wrap gap-2.5">
              {packagingOptions.map((opt) => {
                const isSelected =
                  selectedPackagingId === opt.id ||
                  (!selectedPackagingId && opt.id === packagingOptions[0]?.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedPackagingId(opt.id)}
                    className={cn(
                      'flex flex-col items-start px-4 py-2.5 rounded-xl border-2 transition-all cursor-pointer text-left min-w-[120px]',
                      isSelected
                        ? 'border-[#004996] bg-blue-50/60 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs font-black uppercase tracking-tight',
                        isSelected ? 'text-[#004996]' : 'text-slate-700',
                      )}
                    >
                      {opt.unitName}
                    </span>
                    <span
                      className={cn(
                        'text-base font-black mt-1',
                        isSelected ? 'text-[#004996]' : 'text-slate-900',
                      )}
                    >
                      {formatCurrency(opt.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price & Discount Box */}
          <div className="bg-slate-50/70 p-4 sm:p-5 rounded-2xl border border-slate-100 mb-6">
            {activeOriginalPrice && activePrice < activeOriginalPrice && (
              <div className="inline-flex items-center bg-[#ed1c24] text-white text-xs font-bold px-2.5 py-0.5 rounded-md mb-2 shadow-xs uppercase tracking-tight">
                SAVE {formatCurrency(activeOriginalPrice - activePrice)}
              </div>
            )}

            <div className="flex items-baseline gap-3">
              <span className="text-2xl sm:text-3xl font-display font-bold text-[#004996]">
                {formatCurrency(activePrice)}
                <span className="text-base font-medium text-slate-500 ml-1.5">
                  /{activeUnitName}
                </span>
              </span>

              {activeOriginalPrice && activePrice < activeOriginalPrice && (
                <span className="text-base text-slate-400 line-through">
                  {formatCurrency(activeOriginalPrice)}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-2 leading-relaxed italic m-0">
              * Price includes applicable taxes. Free delivery for orders over 300.000 ₫.
            </p>
          </div>
          {/* Stock & Category Metadata */}
          <div className="flex items-center gap-3 text-sm mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full shrink-0', isInStock ? 'bg-emerald-600' : 'bg-rose-600')} />
              <span className={cn('font-semibold', isInStock ? 'text-slate-800' : 'text-rose-600')}>
                {isInStock ? `In Stock (${product.totalStock || 50} available)` : 'Out of Stock'}
              </span>
            </div>
          </div>

          {/* Quantity + Add to Cart Button */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-2 border border-slate-200 rounded-xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="p-3 hover:bg-slate-100 transition-colors cursor-pointer text-slate-600"
                aria-label="Decrease quantity"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-12 text-center font-bold text-base text-slate-800">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                className="p-3 hover:bg-slate-100 transition-colors cursor-pointer text-slate-600"
                aria-label="Increase quantity"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!isInStock}
              className="flex-1 bg-[#004996] hover:bg-[#003875] text-white py-3.5 px-6 rounded-xl font-bold flex items-center justify-center gap-2.5 shadow-md shadow-blue-900/10 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-base"
            >
              <ShoppingCart className="w-5 h-5" />
              {isInStock ? 'Add to Cart' : 'Out of Stock'}
            </button>

            <button
              type="button"
              onClick={handleToggleWishlist}
              disabled={wishlistLoading}
              title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
              aria-label="Wishlist toggle"
              className={cn(
                'group/wishlist w-[52px] h-[52px] rounded-xl border bg-transparent hover:bg-transparent flex items-center justify-center transition-all cursor-pointer shrink-0 active:scale-95',
                isWishlisted
                  ? 'border-rose-600 text-rose-600 hover:border-rose-700'
                  : 'border-slate-300 text-slate-400 hover:border-rose-500 hover:text-rose-500',
              )}
            >
              <Heart
                className={cn(
                  'w-5 h-5 transition-all duration-200',
                  isWishlisted
                    ? 'fill-rose-600 text-rose-600 scale-110'
                    : 'text-slate-500 group-hover/wishlist:fill-rose-500 group-hover/wishlist:text-rose-500 group-hover/wishlist:scale-110',
                  wishlistLoading && 'animate-pulse',
                )}
              />
            </button>
          </div>

          {/* Guarantee Badges */}
          <div className="grid grid-cols-3 gap-3 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <Shield className="w-5 h-5 text-slate-700 shrink-0" />
              <span className="font-semibold">100% Genuine</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <Truck className="w-5 h-5 text-slate-700 shrink-0" />
              <span className="font-semibold">Fast Shipping</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-slate-600">
              <RotateCcw className="w-5 h-5 text-slate-700 shrink-0" />
              <span className="font-semibold">30-Day Return</span>
            </div>
          </div>
        </div>
      </div>

      {/* Product Details Section */}
      {(() => {
        const renderIngredients = () => (
          <div className="space-y-5">
            {hasValidContent(ct.detailedIngredients?.activeIngredients) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Active Ingredients
                </h3>
                <RenderSafeContent
                  content={ct.detailedIngredients.activeIngredients}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}
            {hasValidContent(ct.detailedIngredients?.excipients) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Excipients / Other Ingredients
                </h3>
                <RenderSafeContent
                  content={ct.detailedIngredients.excipients}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}
            {hasValidContent(ct.ingredients || product.activeIngredients) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Ingredient List
                </h3>
                <RenderSafeContent
                  content={ct.ingredients || product.activeIngredients}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}
            <TabCustomAttributesSection
              attributes={customAttributesBySection.composition}
              title="Additional Composition Details"
            />
          </div>
        );

        const renderIndications = () => (
          <div className="space-y-5">
            {hasValidContent(
              ct.indications ||
              ct.generalDescription ||
              product.shortDescription
            ) && (
                <section>
                  <h3 className="text-base font-bold text-slate-900 mb-1.5">
                    Approved Indications & Therapeutic Use
                  </h3>
                  <RenderSafeContent
                    content={
                      ct.indications ||
                      ct.generalDescription ||
                      product.shortDescription
                    }
                    className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                  />
                </section>
              )}

            {/* Clinical Pharmacology: Pharmacodynamics & Pharmacokinetics */}
            {(hasValidContent(ct.pharmacodynamics) || hasValidContent(ct.pharmacokinetics)) && (
              <section className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Clinical Pharmacology
                </h3>
                <div className="space-y-3">
                  {hasValidContent(ct.pharmacodynamics) && (
                    <div>
                      <h4 className="text-base font-bold text-slate-900 mb-1">
                        Pharmacodynamics
                      </h4>
                      <RenderSafeContent content={ct.pharmacodynamics} className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal" />
                    </div>
                  )}
                  {hasValidContent(ct.pharmacokinetics) && (
                    <div>
                      <h4 className="text-base font-bold text-slate-900 mb-1">
                        Pharmacokinetics
                      </h4>
                      <RenderSafeContent content={ct.pharmacokinetics} className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal" />
                    </div>
                  )}
                </div>
              </section>
            )}

            <TabCustomAttributesSection
              attributes={customAttributesBySection.indications}
              title="Additional Indications & Clinical Properties"
            />
          </div>
        );

        const renderUsage = () => (
          <div className="space-y-5">
            {hasValidContent(ct.usageInstructions?.administration) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Administration Method
                </h3>
                <RenderSafeContent
                  content={ct.usageInstructions.administration}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {hasValidContent(ct.usageInstructions?.dosage) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Dosage & Schedule
                </h3>
                <RenderSafeContent
                  content={ct.usageInstructions.dosage}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {/* Overdose advice */}
            {hasValidContent(ct.usageInstructions?.overdoseManagement) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Overdose Management
                </h3>
                <RenderSafeContent
                  content={ct.usageInstructions.overdoseManagement}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {/* Missed dose advice */}
            {hasValidContent(ct.usageInstructions?.missedDose) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Missed Dose Advice
                </h3>
                <RenderSafeContent
                  content={ct.usageInstructions.missedDose}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {!hasValidContent(ct.usageInstructions) && (
              <div>
                <RenderSafeContent
                  content="Use as directed by your physician or according to the packaged instruction leaflet."
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </div>
            )}

            <TabCustomAttributesSection
              attributes={customAttributesBySection.usage}
              title="Additional Usage & Administration Instructions"
            />
          </div>
        );

        const renderPrecautions = () => (
          <div className="space-y-5">
            {hasValidContent(ct.contraindications) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Contraindications / Do Not Use If
                </h3>
                <RenderSafeContent
                  content={ct.contraindications}
                  className="text-[15px] sm:text-base leading-relaxed text-slate-700 font-normal"
                />
              </section>
            )}

            {hasValidContent(ct.warningsAndPrecautions) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">Warnings & Precautions</h3>
                <RenderSafeContent
                  content={ct.warningsAndPrecautions}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {hasValidContent(ct.sideEffects) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">Potential Side Effects</h3>
                <RenderSafeContent
                  content={ct.sideEffects}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {/* Adverse Event Management */}
            {hasValidContent(ct.adverseReactionManagement || ct.adverseEventManagement) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Management of Adverse Reactions
                </h3>
                <RenderSafeContent
                  content={ct.adverseReactionManagement || ct.adverseEventManagement}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {/* Effects on Driving */}
            {hasValidContent(ct.effectsOnDriving) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Effects on Driving & Operating Machinery
                </h3>
                <RenderSafeContent
                  content={ct.effectsOnDriving}
                  className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal"
                />
              </section>
            )}

            {hasValidContent(ct.drugInteractions) && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-2">Drug Interactions</h3>
                {Array.isArray(ct.drugInteractions) ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-2xs">
                    <table className="min-w-full text-base text-left border-collapse">
                      <thead className="bg-slate-50/80 text-slate-900 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-4 w-1/3 font-bold text-slate-900 text-xs uppercase tracking-wider">Interacting Substance</th>
                          <th className="px-6 py-4 font-bold text-slate-900 text-xs uppercase tracking-wider">Potential Effect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {ct.drugInteractions.map((item: any, i: number) => {
                          const substance =
                            item.drug || item.substance || item.item || item.name || Object.values(item)[0] || '';
                          const effect =
                            item.effect || item.description || Object.values(item)[1] || '';
                          return (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-slate-900 align-top text-base">
                                {String(substance)}
                              </td>
                              <td className="px-6 py-4 text-slate-700 leading-relaxed align-top text-[15px] font-normal">
                                {typeof effect === 'object' ? <RenderSafeContent content={effect} /> : String(effect)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : typeof ct.drugInteractions === 'object' ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200/80 shadow-2xs">
                    <table className="min-w-full text-base text-left border-collapse">
                      <thead className="bg-slate-50/80 text-slate-900 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-4 w-1/3 font-bold text-slate-900 text-xs uppercase tracking-wider">Interacting Substance</th>
                          <th className="px-6 py-4 font-bold text-slate-900 text-xs uppercase tracking-wider">Potential Effect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {Object.entries(ct.drugInteractions).map(([substance, effect], i) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900 align-top text-base">
                              {substance}
                            </td>
                            <td className="px-6 py-4 text-slate-700 leading-relaxed align-top text-[15px] font-normal">
                              {typeof effect === 'object' ? <RenderSafeContent content={effect} /> : String(effect)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-slate-700 leading-relaxed font-normal text-[15px]">
                    {String(ct.drugInteractions)}
                  </div>
                )}
              </section>
            )}

            {ct.specialPatientGroups && (
              <section>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Special Patient Groups
                </h3>
                {typeof ct.specialPatientGroups === 'object' && !Array.isArray(ct.specialPatientGroups) ? (
                  <div className="space-y-3">
                    {Object.entries(ct.specialPatientGroups)
                      .filter(([_, val]) => val && String(val).trim() !== '')
                      .map(([key, val]) => {
                        const label = getEnglishLabel(key);
                        return (
                          <div key={key}>
                            <h4 className="text-base font-bold text-slate-900 mb-1">
                              {label}
                            </h4>
                            <RenderSafeContent content={val} className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal" />
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <RenderSafeContent content={ct.specialPatientGroups} className="text-[15px] sm:text-base text-slate-700 leading-relaxed font-normal" />
                )}
              </section>
            )}

            <TabCustomAttributesSection
              attributes={customAttributesBySection.safety}
              title="Additional Safety & Precaution Notes"
            />
          </div>
        );

        const renderManufacturing = () => (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  label: 'Brand / Trademark',
                  value: product.manufacturer || ct.manufacturingInfo?.brand,
                  icon: <Award className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Manufacturer',
                  value: product.manufacturer || ct.manufacturingInfo?.manufacturer,
                  icon: <Building2 className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Country of Origin',
                  value: product.countryOfOrigin || ct.manufacturingInfo?.origin || 'Vietnam',
                  icon: <Globe className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Packaging Specification',
                  value: ct.manufacturingInfo?.packaging || `${product.packaging?.unitName || 'Box'} standard unit`,
                  icon: <Package className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Storage Instructions',
                  value: ct.manufacturingInfo?.storage || 'Store below 30°C in dry conditions protected from light.',
                  icon: <Thermometer className="w-6 h-6 text-slate-700" />,
                },
              ]
                .filter((i) => i.value)
                .map((item) => (
                  <div
                    key={item.label}
                    className="p-4.5 bg-white rounded-xl border border-slate-200 flex items-start gap-4"
                  >
                    <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                        {item.label}
                      </p>
                      <p className="text-sm font-normal text-slate-600 mt-1 m-0 leading-relaxed">
                        {cleanText(item.value)}
                      </p>
                    </div>
                  </div>
                ))}
            </div>

            <TabCustomAttributesSection
              attributes={customAttributesBySection.manufacturing}
              title="Additional Manufacturing Specifications"
            />
          </div>
        );

        const renderReviews = () => (
          <div className="py-8 text-center text-slate-400 text-base">
            <FileCheck2 className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="font-bold text-slate-700 m-0 text-lg">No customer reviews yet</p>
            <p className="text-sm text-slate-400 mt-1">Be the first to leave feedback for this medication!</p>
          </div>
        );

        return (
          <div className="mt-12 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-xl sm:text-2xl font-display font-bold text-slate-900 m-0">
                Product Description
              </h2>
            </div>

            {/* Desktop View: Tabbed Navigation */}
            <div className="hidden md:block">
              {/* Tab Headers */}
              <div className="flex border-b border-slate-200 overflow-x-auto" role="tablist">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 sm:px-7 py-3.5 sm:py-4.5 text-base sm:text-lg font-bold whitespace-nowrap transition-all relative cursor-pointer border-none bg-transparent ${activeTab === tab.id
                      ? 'text-slate-900'
                      : 'text-slate-500 hover:text-slate-900'
                      }`}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab Panels */}
              <div className="p-7 md:p-9 animate-fade-in">
                {activeTab === 'ingredients' && renderIngredients()}
                {activeTab === 'indications' && renderIndications()}
                {activeTab === 'usage' && renderUsage()}
                {activeTab === 'precautions' && renderPrecautions()}
                {activeTab === 'manufacturing' && renderManufacturing()}
                {activeTab === 'reviews' && renderReviews()}
              </div>
            </div>

            {/* Mobile View: Continuous Stream with Show More / Collapse */}
            <div className="md:hidden">
              <div
                className={cn(
                  'p-5 space-y-8 relative transition-all duration-300',
                  !isMobileExpanded && 'max-h-[460px] overflow-hidden'
                )}
              >
                {/* 1. Ingredients */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    1. Ingredients & Composition
                  </h3>
                  {renderIngredients()}
                </div>

                {/* 2. Indications */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    2. Usage & Indications
                  </h3>
                  {renderIndications()}
                </div>

                {/* 3. How to Use */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    3. How to Use & Dosage
                  </h3>
                  {renderUsage()}
                </div>

                {/* 4. Precautions */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    4. Precautions & Safety
                  </h3>
                  {renderPrecautions()}
                </div>

                {/* 5. Manufacturing */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    5. Manufacturing & Origin
                  </h3>
                  {renderManufacturing()}
                </div>

                {/* 6. Reviews */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 pb-2 mb-4 border-b border-slate-100 uppercase tracking-wide">
                    6. Customer Reviews
                  </h3>
                  {renderReviews()}
                </div>

                {!isMobileExpanded && (
                  <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-white via-white/85 to-transparent pointer-events-none" />
                )}
              </div>

              {/* Show more / Collapse button on Mobile */}
              <div className="py-3 text-center bg-transparent">
                <button
                  type="button"
                  onClick={() => setIsMobileExpanded(!isMobileExpanded)}
                  className="inline-flex items-center justify-center gap-1 bg-transparent border-0 text-[#004996] font-bold text-sm hover:underline cursor-pointer p-0"
                >
                  <span>{isMobileExpanded ? 'Show less' : 'Show more'}</span>
                  <ChevronDown
                    className={cn('w-4 h-4 transition-transform duration-200', isMobileExpanded && 'rotate-180')}
                  />
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
