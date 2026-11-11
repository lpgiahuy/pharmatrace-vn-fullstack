'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Spin,
  Modal,
  Rate,
  Input,
  App,
  Popconfirm,
  Select,
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
  ThumbsUp,
  CheckCircle2,
  UploadCloud,
  X,
  CornerDownRight,
  User,
  Camera,
  Info,
  Edit3,
  Trash2,
  Flag,
} from 'lucide-react';
import { reviewService, ReviewItem, ReviewStats } from '@/services/review.service';
import { productService } from '@/services/product.service';
import { wishlistService } from '@/services/wishlist.service';
import { useAuth } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { Product } from '@/types/product.types';
import { formatCurrency, formatDate, formatDateTime, cleanText, cn, compressImages } from '@/utils';

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
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Fallback to text
      }
      if (parsed !== undefined) {
        return <RenderSafeContent content={parsed} className={className} />;
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

  const { isAuthenticated, user } = useAuth();
  const addItem = useCartStore((state) => state.addItem);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [selectedPackagingId, setSelectedPackagingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('ingredients');
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const { message: messageApi, modal: modalApi } = App.useApp();

  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats>({
    totalReviews: 0,
    averageRating: 5.0,
    starCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewFilterRating, setReviewFilterRating] = useState<number | null>(null);
  const [reviewSort, setReviewSort] = useState<'newest' | 'oldest' | 'highest_rating' | 'lowest_rating' | 'most_helpful'>('newest');
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [votedHelpfulIds, setVotedHelpfulIds] = useState<Set<number>>(new Set());

  const mostHelpfulReviewId = React.useMemo(() => {
    let maxCount = 0;
    let topId: number | null = null;
    reviews.forEach((r) => {
      const count = r.helpfulCount || 0;
      if (count > maxCount) {
        maxCount = count;
        topId = r.id;
      }
    });
    return maxCount > 0 ? topId : null;
  }, [reviews]);

  const displayedReviews = React.useMemo(() => {
    if (!mostHelpfulReviewId) return reviews;
    const topReview = reviews.find((r) => r.id === mostHelpfulReviewId);
    if (!topReview) return reviews;
    const otherReviews = reviews.filter((r) => r.id !== mostHelpfulReviewId);
    return [topReview, ...otherReviews];
  }, [reviews, mostHelpfulReviewId]);

  // Report Review States
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportingReviewId, setReportingReviewId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState<string>('SPAM');
  const [reportDescription, setReportDescription] = useState<string>('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Restore voted helpful review IDs from localStorage on client mount
  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      try {
        const stored = localStorage.getItem('pharmatrace_helpful_reviews');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setVotedHelpfulIds(new Set(parsed));
          }
        }
      } catch {
        // Ignore localStorage read error
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const loadReviews = React.useCallback(
    async (
      id: number | string,
      ratingFilter?: number | null,
      sortOption?: string,
    ) => {
      setReviewsLoading(true);
      try {
        const res = await reviewService.getProductReviews(id, {
          rating: ratingFilter !== null && ratingFilter !== undefined ? ratingFilter : undefined,
          sort: (sortOption as any) || 'newest',
        });
        if (res?.data) {
          setReviews(res.data);
          if (res.stats) {
            setReviewStats(res.stats);
          }
        }
      } catch {
        // ignore
      } finally {
        setReviewsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
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
            loadReviews(res.data.id || productId);
          }
        })
        .catch(() => {
          messageApi.error('Failed to load product details');
        })
        .finally(() => {
          setLoading(false);
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [productId, messageApi, loadReviews]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(timer);
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

  const handleOpenReviewModal = async () => {
    if (!isAuthenticated) {
      messageApi.warning('Please log in to write a review for this product.');
      return;
    }
    if (!product) return;

    try {
      const checkRes = await reviewService.checkCanReview(product.id);
      if (!checkRes.data.canReview) {
        modalApi.info({
          title: 'Verified Purchase Required',
          content: (
            <div className="py-2 text-sm text-slate-600 space-y-2">
              <p>
                To ensure authenticity and transparency, PharmaTrace VN only allows customers who have <strong>purchased and received this product</strong> to submit a review.
              </p>
              <p className="text-xs text-slate-400">
                Please place an order for this medicine and come back to review after receiving your delivery!
              </p>
            </div>
          ),
          okText: 'Got it',
          okButtonProps: { style: { backgroundColor: '#004996' } },
        });
        return;
      }
      if (checkRes.data.alreadyReviewed) {
        messageApi.info('You have already submitted a review for this product.');
      }
      setIsReviewModalOpen(true);
    } catch {
      setIsReviewModalOpen(true);
    }
  };

  const handleUploadReviewImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (reviewImages.length + files.length > 4) {
      messageApi.warning('You can upload up to 4 photos in JPG, PNG, or JPEG format.');
      return;
    }

    setUploadingImage(true);
    try {
      // 1. Compress & resize images in browser before upload (reduces 5-10MB to ~150-250KB)
      const fileArray = Array.from(files);
      const compressedFiles = await compressImages(fileArray, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.82,
      });

      // 2. Upload compressed files in parallel for maximum speed
      const uploadPromises = compressedFiles.map((cFile: File) =>
        reviewService.uploadReviewImage(cFile),
      );
      const responses = await Promise.all(uploadPromises);

      const newUrls: string[] = [];
      responses.forEach((res: any) => {
        if (res?.data?.imageUrl) {
          newUrls.push(res.data.imageUrl);
        }
      });

      if (newUrls.length > 0) {
        setReviewImages((prev) => [...prev, ...newUrls].slice(0, 4));
        messageApi.success(
          newUrls.length === 1
            ? 'Image uploaded successfully'
            : `${newUrls.length} images uploaded successfully`,
        );
      }
    } catch {
      messageApi.error('Failed to upload image. Please try again.');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleVoteHelpful = async (reviewId: number) => {
    const isAlreadyVoted = votedHelpfulIds.has(reviewId);
    try {
      await reviewService.voteHelpful(reviewId, isAlreadyVoted);
      if (isAlreadyVoted) {
        setVotedHelpfulIds((prev) => {
          const next = new Set(prev);
          next.delete(reviewId);
          try {
            localStorage.setItem(
              'pharmatrace_helpful_reviews',
              JSON.stringify(Array.from(next)),
            );
          } catch { }
          return next;
        });
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? { ...r, helpfulCount: Math.max(0, (r.helpfulCount || 0) - 1) }
              : r,
          ),
        );
      } else {
        setVotedHelpfulIds((prev) => {
          const next = new Set([...prev, reviewId]);
          try {
            localStorage.setItem(
              'pharmatrace_helpful_reviews',
              JSON.stringify(Array.from(next)),
            );
          } catch { }
          return next;
        });
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, helpfulCount: (r.helpfulCount || 0) + 1 } : r,
          ),
        );
      }
    } catch {
      messageApi.error('Failed to update helpful vote');
    }
  };

  const handleOpenEditModal = (r: ReviewItem) => {
    setEditingReviewId(r.id);
    setReviewStars(r.ratingStars || 5);
    setReviewComment(r.comment || '');
    setReviewImages(r.images || []);
    setIsReviewModalOpen(true);
  };

  const handleDeleteReview = async (reviewId: number) => {
    try {
      await reviewService.deleteCustomerReview(reviewId);
      messageApi.success('Review deleted successfully');
      if (product) {
        loadReviews(product.id, reviewFilterRating, reviewSort);
      }
    } catch {
      messageApi.error('Failed to delete review');
    }
  };

  const handleOpenReportModal = (reviewId: number) => {
    if (!isAuthenticated) {
      messageApi.warning('Please log in to report a review.');
      return;
    }
    setReportingReviewId(reviewId);
    setReportReason('SPAM');
    setReportDescription('');
    setIsReportModalOpen(true);
  };

  const handleSubmitReport = async () => {
    if (!reportingReviewId) return;
    setSubmittingReport(true);
    try {
      await reviewService.reportReview(reportingReviewId, {
        reason: reportReason,
        description: reportDescription.trim() || undefined,
      });
      messageApi.success('Thank you. Your report has been submitted to moderators.');
      setIsReportModalOpen(false);
      setReportingReviewId(null);
      setReportDescription('');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit report';
      messageApi.error(msg);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!isAuthenticated) {
      messageApi.warning('Please log in to write a review.');
      return;
    }
    if (!reviewComment.trim()) {
      messageApi.warning('Please enter your review feedback.');
      return;
    }
    if (!product) return;

    setSubmittingReview(true);
    try {
      if (editingReviewId) {
        await reviewService.updateCustomerReview(editingReviewId, {
          ratingStars: reviewStars,
          comment: reviewComment.trim(),
          images: reviewImages,
        });
        messageApi.success('Review updated successfully!');
      } else {
        await reviewService.createProductReview(product.id, {
          ratingStars: reviewStars,
          comment: reviewComment.trim(),
          images: reviewImages,
        });
        messageApi.success('Review submitted successfully! Thank you for your feedback.');
      }
      setIsReviewModalOpen(false);
      setEditingReviewId(null);
      setReviewComment('');
      setReviewImages([]);
      setReviewStars(5);
      loadReviews(product.id, reviewFilterRating, reviewSort);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || 'Failed to submit review';
      messageApi.error(msg);
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleAddToCart = () => {
    if (!product) return;

    const activePackaging =
      product.packagingOptions?.find((p) => p.id === selectedPackagingId) ||
      product.packagingOptions?.[0];

    const currentStock = activePackaging && typeof (activePackaging as any).stock === 'number'
      ? (activePackaging as any).stock
      : Number(product.totalStock ?? 0);

    if (currentStock <= 0) {
      messageApi.warning('This medicine is currently out of stock.');
      return;
    }

    if (qty > currentStock) {
      messageApi.warning(`Only ${currentStock} item(s) available in stock.`);
      return;
    }

    const effectivePrice = activePackaging
      ? Number(activePackaging.price)
      : Number(product.promotionalPrice || product.unitPrice || 0);

    const originalPrice = activePackaging
      ? Number(activePackaging.originalPrice || activePackaging.price)
      : Number(product.unitPrice || effectivePrice);

    addItem(
      {
        id: `${product.id}-${activePackaging?.id || 'base'}`,
        productId: product.id,
        slug: product.slug || String(product.id),
        medicineName: product.medicineName,
        isPrescription: product.isPrescription,
        imageUrl: product.imageUrl,
        variantId: activePackaging?.id,
        unitName: activePackaging?.unitName || 'Box',
        price: effectivePrice,
        originalPrice: originalPrice,
        packagingOptions: product.packagingOptions?.map((p) => ({
          id: p.id,
          unitName: p.unitName,
          price: Number(p.price),
          originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        })),
      },
      qty,
    );

    messageApi.success('Added to cart!');
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

  const activeStock = activeOption && typeof (activeOption as any).stock === 'number'
    ? (activeOption as any).stock
    : Number(product.totalStock ?? 0);
  const isInStock = activeStock > 0;
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
  ];

  const renderReviews = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Header: Score Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-50/80 rounded-[6px] border border-slate-200/80">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {reviewStats.averageRating.toFixed(1)}
              </span>
              <span className="text-sm font-semibold text-slate-400">/ 5.0</span>
            </div>
            <div className="flex items-center gap-1 mt-1 text-amber-400">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={cn(
                    'w-4 h-4',
                    s <= Math.round(reviewStats.averageRating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-200',
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5 m-0 font-medium">
              Based on {reviewStats.totalReviews} verified customer reviews
            </p>
          </div>

          {/* Star bars */}
          <div className="hidden sm:flex flex-col gap-1 min-w-[200px] border-l border-slate-200/80 pl-5">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = reviewStats.starCounts[star] || 0;
              const pct = reviewStats.totalReviews > 0 ? (count / reviewStats.totalReviews) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-12 font-medium">{star} {star === 1 ? 'Star' : 'Stars'}</span>
                  <div className="w-28 sm:w-36 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums text-slate-400 font-mono text-[11px]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter & Sort Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-100">
        {/* Star Rating Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setReviewFilterRating(null);
              loadReviews(product.id, null, reviewSort);
            }}
            className={cn(
              'px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer',
              reviewFilterRating === null
                ? 'bg-[#004996] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            All ({reviewStats.totalReviews})
          </button>
          {[5, 4, 3, 2, 1].map((star) => {
            const isSelected = reviewFilterRating === star;
            const count = reviewStats.starCounts[star] || 0;
            return (
              <button
                key={star}
                type="button"
                onClick={() => {
                  const next = isSelected ? null : star;
                  setReviewFilterRating(next);
                  loadReviews(product.id, next, reviewSort);
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer',
                  isSelected
                    ? 'bg-[#004996] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                <span>{star} {star === 1 ? 'Star' : 'Stars'}</span>
                <span className="text-[10px] opacity-75">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Sort by:</span>
          <select
            value={reviewSort}
            onChange={(e) => {
              const nextSort = e.target.value as any;
              setReviewSort(nextSort);
              loadReviews(product.id, reviewFilterRating, nextSort);
            }}
            className="bg-slate-50 border border-slate-200 rounded-[6px] px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-[#004996] cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="highest_rating">Highest Rating</option>
            <option value="lowest_rating">Lowest Rating</option>
            <option value="most_helpful">Most Helpful</option>
          </select>
        </div>
      </div>

      {/* Reviews List */}
      {reviewsLoading ? (
        <div className="py-12 text-center text-slate-400">
          <Spin />
          <p className="text-xs mt-2">Loading reviews...</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="py-10 text-center text-slate-400">
          <FileCheck2 className="w-12 h-12 mx-auto text-slate-300 mb-2" />
          <p className="font-bold text-slate-700 m-0 text-base">
            {reviewFilterRating ? `No ${reviewFilterRating}-star reviews yet` : 'No reviews yet'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 space-y-6">
          {displayedReviews.map((r) => (
            <div key={r.id} className="pt-6 first:pt-0">
              <div className="relative">
                {/* Customer Header + Avatar */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-500 text-white flex items-center justify-center shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {r.customerName || 'Customer'}
                      </span>
                      {r.id === mostHelpfulReviewId ? (
                        <span className="px-2 py-0.5 bg-[#00A551] text-white text-[11px] font-semibold rounded-[4px]">
                          Most Helpful
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDateTime(r.createdAt)}
                    </div>
                    {/* Star rating */}
                    <div className="flex items-center gap-1 text-amber-400 mt-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={cn(
                            'w-3.5 h-3.5',
                            s <= r.ratingStars
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-200',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Customer Review Content */}
                <div className="pl-13 mt-2 space-y-2.5">
                  <p className="text-sm text-slate-800 m-0 leading-relaxed font-normal">
                    {r.comment}
                  </p>

                  {/* Uploaded Photos */}
                  {r.images && r.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.images.map((img, idx) => (
                        <a
                          key={idx}
                          href={img}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative block w-16 h-16 rounded-[6px] border border-slate-200 overflow-hidden group/img hover:border-[#004996] transition-colors"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img}
                            alt="Review attachment"
                            className="w-full h-full object-cover group-hover/img:scale-105 transition-transform"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Helpful Button & Owner Actions */}
                  <div className="pt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleVoteHelpful(r.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1 rounded-[6px] border text-xs font-semibold transition-colors cursor-pointer',
                        votedHelpfulIds.has(r.id)
                          ? 'bg-blue-50 border-blue-200 text-[#004996]'
                          : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                      )}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>Helpful</span>
                      {Boolean(r.helpfulCount) && (
                        <span className="tabular-nums">({r.helpfulCount})</span>
                      )}
                    </button>

                    {user && r.customerId === user.id ? (
                      <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-slate-600 hover:text-[#004996] hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer"
                          title="Edit your review"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <Popconfirm
                          title="Delete Review"
                          description="Are you sure you want to delete this review? You can write a new review after deleting."
                          okText="Yes, Delete"
                          cancelText="Cancel"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => handleDeleteReview(r.id)}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-100 transition-colors cursor-pointer"
                            title="Delete your review"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </Popconfirm>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenReportModal(r.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-slate-400 hover:text-amber-600 hover:bg-amber-50 border border-slate-200 transition-colors cursor-pointer"
                        title="Report this review"
                      >
                        <Flag className="w-3 h-3" />
                        <span>Report</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Pharmacist / Store Reply Thread (styled like Image 2) */}
                {r.adminReply && (
                  <div className="relative mt-4 pl-12 sm:pl-14">
                    {/* Curved connecting line: user avatar down to pharmacist avatar */}
                    <div
                      className="absolute left-5 top-[-14px] w-7 h-10 border-l border-b border-slate-300 rounded-bl-xl pointer-events-none"
                      aria-hidden="true"
                    />

                    {/* Pharmacist Header */}
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#004996] text-white flex flex-col items-center justify-center shrink-0 p-1 text-center shadow-xs">
                        <span className="text-[7px] font-bold uppercase tracking-tighter leading-tight opacity-90">
                          PHARMACY
                        </span>
                        <span className="text-[9px] font-black leading-tight">
                          PharmaTrace
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900">
                            {r.repliedByName || 'PharmaTrace'}
                          </span>
                          <span
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#0090FF] text-white shrink-0"
                            title="Verified Pharmacy Partner"
                          >
                            <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {formatDateTime(r.repliedAt || r.createdAt)}
                        </div>
                      </div>
                    </div>

                    {/* Reply Text Body */}
                    <div className="pl-13 mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line font-normal">
                      {r.adminReply}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full animate-fade-in space-y-6 sm:space-y-8 font-sans">

      {/* Breadcrumb with category navigation */}
      <nav className="flex items-center gap-2 text-sm mb-6 flex-wrap" aria-label="Breadcrumb">
        <Link href="/" className="text-gray-500 hover:text-black transition-colors font-medium">Home</Link>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <Link href="/products" className="text-gray-500 hover:text-black transition-colors font-medium">Products</Link>
        {product.category && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Link href={`/products?category=${product.category.id}`} className="text-gray-500 hover:text-black transition-colors font-medium">
              {product.category.categoryName}
            </Link>
          </>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-black font-semibold truncate max-w-md">{cleanText(product.medicineName)}</span>
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
              Origin: <span className="text-slate-700 font-semibold">{product.countryOfOrigin || ct.thong_tin_san_xuat?.xuat_xu || 'Not specified'}</span>
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
                <Star
                  key={s}
                  className={cn(
                    'w-4 h-4',
                    s <= Math.round(reviewStats.averageRating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-slate-200',
                  )}
                />
              ))}
            </div>
            <span className="text-sm text-slate-700 font-bold">{reviewStats.averageRating.toFixed(1)}</span>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('customer-reviews-section');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-xs text-[#004996] hover:underline font-semibold bg-transparent border-none cursor-pointer p-0"
            >
              {reviewStats.totalReviews} customer {reviewStats.totalReviews === 1 ? 'review' : 'reviews'}
            </button>
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
              * Price includes applicable taxes. Free delivery for orders from 500.000 ₫.
            </p>
          </div>
          {/* Stock & Category Metadata */}
          <div className="flex items-center gap-3 text-sm mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full shrink-0', isInStock ? 'bg-emerald-600' : 'bg-rose-600')} />
              <span className={cn('font-semibold', isInStock ? 'text-slate-800' : 'text-rose-600')}>
                {isInStock ? `In Stock (${activeStock} available)` : 'Out of Stock'}
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
                  value: ct.manufacturingInfo?.brand || 'Not specified',
                  icon: <Award className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Manufacturer',
                  value: product.manufacturer || ct.manufacturingInfo?.manufacturer || 'Not specified',
                  icon: <Building2 className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Country of Origin',
                  value: product.countryOfOrigin || ct.manufacturingInfo?.origin || 'Not specified',
                  icon: <Globe className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Packaging Specification',
                  value: ct.manufacturingInfo?.packaging || product.packaging?.unitName || 'Not specified',
                  icon: <Package className="w-6 h-6 text-slate-700" />,
                },
                {
                  label: 'Storage Instructions',
                  value: ct.manufacturingInfo?.storage || 'Not specified',
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

        return (
          <div id="product-description-section" className="mt-12 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
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

      {/* Standalone Section: Customer Reviews & Ratings */}
      <section
        id="customer-reviews-section"
        className="mt-8 sm:mt-12 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden"
      >
        <div className="p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-display font-bold text-slate-900 m-0">
              Customer Reviews & Ratings
            </h2>
            <p className="text-xs text-slate-500 m-0 mt-0.5">
              Authentic feedback from verified customers who purchased this medication
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenReviewModal}
            className="px-5 py-2.5 bg-[#004996] hover:bg-[#003875] text-white text-xs font-bold rounded-[6px] transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <span>Write a Review</span>
          </button>
        </div>

        <div className="p-5 sm:p-7 md:p-8">
          {renderReviews()}
        </div>
      </section>
      {/* Review Submission Modal */}
      <Modal
        title={
          <div className="text-xl font-bold text-black pb-1">
            {editingReviewId ? 'Edit Your Review' : 'Product Review'}
          </div>
        }
        open={isReviewModalOpen}
        onCancel={() => {
          setIsReviewModalOpen(false);
          setEditingReviewId(null);
          setReviewImages([]);
        }}
        footer={[
          <div key="actions" className="flex justify-end pt-2">
            <button
              key="submit"
              type="button"
              disabled={submittingReview}
              onClick={handleSubmitReview}
              className="px-6 py-2.5 bg-[#1856b6] hover:bg-[#12428c] text-white font-bold text-sm rounded-[6px] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {submittingReview && <Spin size="small" />}
              <span>{editingReviewId ? 'Update Review' : 'Submit Review'}</span>
            </button>
          </div>,
        ]}
        destroyOnHidden
        width={540}
      >
        <div className="space-y-4 pt-2">
          {/* Product Header Card */}
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-lg border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.imageUrl || '/favicon.ico'}
                alt={product.medicineName}
                className="max-w-full max-h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-black leading-snug line-clamp-2 m-0">
                {cleanText(product.medicineName)}
              </h4>
              <p className="text-xs text-[#6B7171] mt-1 m-0 font-medium">
                Packaging: {activeUnitName || product.packaging?.unitName || 'Standard unit'}
              </p>
            </div>
          </div>

          <div className="border-b border-slate-100" />

          {/* Large Golden Stars Centered */}
          <div className="py-1 flex justify-center">
            <Rate
              value={reviewStars}
              onChange={(val) => setReviewStars(val)}
              className="text-4xl text-amber-400"
            />
          </div>

          {/* Photo Upload Area */}
          <div className="space-y-2">
            <p className="text-xs text-[#6B7171] m-0 font-medium">
              You can add up to 4 photos in JPG, PNG, or JPEG format
            </p>

            {/* Uploaded Photos Preview */}
            {reviewImages.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 pb-1">
                {reviewImages.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    className="relative w-16 h-16 rounded-[6px] border border-slate-200 overflow-hidden group/thumb"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgUrl} alt="Review thumb" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setReviewImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 w-4 h-4 rounded-full bg-slate-900/80 text-white flex items-center justify-center opacity-0 group/thumb:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Big Upload Area */}
            {reviewImages.length < 4 && (
              <label className="w-full py-5 rounded-[6px] bg-[#EEF4FF] hover:bg-blue-100/70 transition-colors flex flex-col items-center justify-center cursor-pointer border border-blue-100 gap-2 text-[#0066CC]">
                {uploadingImage ? (
                  <Spin size="small" />
                ) : (
                  <>
                    <div className="w-9 h-9 rounded-full bg-[#0066CC] text-white flex items-center justify-center shadow-2xs">
                      <Camera className="w-5 h-5 fill-white text-white" />
                    </div>
                    <span className="text-xs font-semibold text-black">
                      Add Photos
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  multiple
                  disabled={uploadingImage}
                  onChange={handleUploadReviewImage}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Review Textarea Section */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-black block m-0">
              Write a Review
            </label>
            <Input.TextArea
              rows={4}
              maxLength={300}
              placeholder="Share your experience with this product..."
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              className="rounded-[6px] text-sm text-black border-slate-200 focus:border-[#004996] p-3"
            />
            <div className="flex items-center justify-between text-xs text-[#6B7171] pt-0.5">
              <span className="flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 inline" />
                <span>Up to 300 characters</span>
              </span>
              <span className="text-[11px] font-mono">{reviewComment.length}/300</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Customer Report Review Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Flag className="w-4 h-4 text-[#b45309]" />
            <span>Report Review</span>
          </div>
        }
        open={isReportModalOpen}
        onCancel={() => {
          setIsReportModalOpen(false);
          setReportingReviewId(null);
          setReportDescription('');
        }}
        onOk={handleSubmitReport}
        confirmLoading={submittingReport}
        okText="Submit Report"
        cancelText="Cancel"
        okButtonProps={{ style: { backgroundColor: '#004996' } }}
        destroyOnHidden
        width={480}
      >
        <div className="space-y-4 py-2 text-sm">
          <p className="text-sm text-gray-600 m-0 leading-relaxed">
            Please select the reason why you are reporting this review. Our moderation team will investigate promptly.
          </p>

          <div>
            <label className="text-sm font-semibold text-gray-800 block mb-1.5">
              Reason for Report *
            </label>
            <Select
              value={reportReason}
              onChange={(val) => setReportReason(val)}
              className="w-full"
              size="middle"
              options={[
                { value: 'SPAM', label: 'Spam, advertising, or commercial links' },
                { value: 'HARASSMENT', label: 'Harassment, hate speech, or profanity' },
                { value: 'MISINFORMATION', label: 'False or dangerous medical claims' },
                { value: 'INAPPROPRIATE', label: 'Inappropriate or irrelevant content' },
                { value: 'OTHER', label: 'Other policy violation' },
              ]}
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-800 block mb-1.5">
              Additional Details (Optional)
            </label>
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="Provide any additional details or context for moderators..."
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              showCount
              className="text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
