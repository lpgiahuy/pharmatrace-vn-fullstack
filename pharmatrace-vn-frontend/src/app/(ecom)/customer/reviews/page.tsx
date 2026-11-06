'use client';

import { useHydrated } from '@/hooks/useHydrated';
import React, { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spin, Rate, Modal, Input, App, Tag, Popconfirm } from 'antd';
import {
  Star,
  MessageSquare,
  PackageCheck,
  ChevronRight,
  UploadCloud,
  X,
  CornerDownRight,
  ShoppingBag,
  Camera,
  Edit3,
  Trash2,
  Info,
} from 'lucide-react';
import { reviewService, ReviewItem } from '@/services/review.service';
import { useAuth } from '@/store/useAuthStore';
import { formatCurrency, formatDateTime, cleanText, cn, compressImages } from '@/utils';

function CustomerReviewsContent() {
  const { message } = App.useApp();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const mounted = useHydrated();
  const [activeTab, setActiveTab] = useState<'my_reviews' | 'pending'>('my_reviews');
  const [myReviews, setMyReviews] = useState<ReviewItem[]>([]);
  const [pendingProducts, setPendingProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Review Modal State
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchCustomerReviews = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [myRes, pendingRes] = await Promise.all([
        reviewService.getCustomerMyReviews({ page: 1, limit: 50 }),
        reviewService.getCustomerPendingReviews(),
      ]);
      if (myRes?.data) setMyReviews(myRes.data);
      if (pendingRes?.data) setPendingProducts(pendingRes.data);
    } catch {
      message.error('Failed to load customer reviews history');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      if (mounted && !authLoading) {
        fetchCustomerReviews();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [mounted, authLoading, fetchCustomerReviews]);

  const handleOpenReviewModal = (product: any) => {
    setEditingReviewId(null);
    setSelectedProduct(product);
    setReviewStars(5);
    setReviewComment('');
    setReviewImages([]);
    setReviewModalOpen(true);
  };

  const handleOpenEditModal = (r: ReviewItem) => {
    setEditingReviewId(r.id);
    setSelectedProduct({
      id: r.productId,
      medicineName: r.productName,
      imageUrl: r.productImage,
    });
    setReviewStars(r.ratingStars || 5);
    setReviewComment(r.comment || '');
    setReviewImages(r.images || []);
    setReviewModalOpen(true);
  };

  const handleDeleteReview = async (reviewId: number) => {
    try {
      await reviewService.deleteCustomerReview(reviewId);
      message.success('Review deleted successfully. You can now write a new review.');
      setMyReviews((prev) => prev.filter((r) => r.id !== reviewId));
      fetchCustomerReviews();
    } catch {
      message.error('Failed to delete review');
    }
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (reviewImages.length + files.length > 4) {
      message.warning('You can upload up to 4 photos in JPG, PNG, or JPEG format.');
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
        message.success(
          newUrls.length === 1
            ? 'Image uploaded successfully'
            : `${newUrls.length} images uploaded successfully`,
        );
      }
    } catch {
      message.error('Failed to upload image. Please try again.');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedProduct && !editingReviewId) return;
    if (!reviewComment.trim()) {
      message.warning('Please enter your review feedback');
      return;
    }

    setSubmittingReview(true);
    try {
      if (editingReviewId) {
        await reviewService.updateCustomerReview(editingReviewId, {
          ratingStars: reviewStars,
          comment: reviewComment.trim(),
          images: reviewImages,
        });
        message.success('Review updated successfully!');
      } else {
        await reviewService.createProductReview(selectedProduct.id, {
          ratingStars: reviewStars,
          comment: reviewComment.trim(),
          images: reviewImages,
        });
        message.success('Review submitted successfully! Thank you for your feedback.');
      }
      setReviewModalOpen(false);
      setSelectedProduct(null);
      setEditingReviewId(null);
      fetchCustomerReviews();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to submit review';
      message.error(msg);
    } finally {
      setSubmittingReview(false);
    }
  };

  if (!mounted || authLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 text-center">
        <div className="w-16 h-16 bg-blue-50 text-[#004996] rounded-full flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Log in to view your reviews</h2>
        <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
          View all your previous reviews and pending delivered orders waiting for your feedback.
        </p>
        <Link
          href="/login?redirect=/customer/reviews"
          className="inline-flex items-center gap-2 bg-[#004996] text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#003875] transition-colors"
        >
          Log in Now
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6">
        <Link href="/" className="hover:text-[#004996] transition-colors">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-800 font-semibold">My Reviews</span>
      </nav>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 mb-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-blue-50 text-[#004996] rounded-xl flex items-center justify-center shrink-0">
            <Star className="w-6 h-6 fill-amber-400 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 m-0">Reviews & Feedback Center</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 m-0">
              Manage your ratings, comments, and pharmacist consultation replies for medicines purchased on PharmaTrace VN.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('my_reviews')}
          className={cn(
            'px-5 py-3 text-sm font-bold transition-all relative border-none bg-transparent cursor-pointer flex items-center gap-2',
            activeTab === 'my_reviews'
              ? 'text-[#004996]'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          <span>Reviewed Products</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 font-semibold">
            {myReviews.length}
          </span>
          {activeTab === 'my_reviews' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#004996]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={cn(
            'px-5 py-3 text-sm font-bold transition-all relative border-none bg-transparent cursor-pointer flex items-center gap-2',
            activeTab === 'pending'
              ? 'text-[#004996]'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          <span>Waiting for Review</span>
          {pendingProducts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 font-semibold">
              {pendingProducts.length}
            </span>
          )}
          {activeTab === 'pending' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#004996]" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-24 text-center">
          <Spin size="large" />
        </div>
      ) : activeTab === 'my_reviews' ? (
        myReviews.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
            <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">No reviews submitted yet</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
              Medicines you review will be saved here along with professional guidance and replies from our pharmacists.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-[#004996] text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#003875] transition-colors"
            >
              <ShoppingBag className="w-4 h-4" />
              Explore Medicines Catalog
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {myReviews.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4"
              >
                {/* Product Meta */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <Link
                    href={`/products/${r.productSlug || r.productId}`}
                    className="flex items-center gap-3 group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.productImage || '/favicon.ico'}
                      alt=""
                      className="w-12 h-12 rounded-xl object-contain border border-slate-100 bg-slate-50 p-1"
                    />
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#004996] transition-colors m-0">
                        {r.productName || 'PharmaTrace Medicine'}
                      </h4>
                      <span className="text-xs text-slate-400 font-mono">
                        Reviewed on {new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2">
                    {r.status === 'APPROVED' ? (
                      <Tag color="success">Approved</Tag>
                    ) : (
                      <Tag color="warning">Pending Moderation</Tag>
                    )}

                    <div className="flex items-center gap-1.5 ml-1 border-l border-slate-200 pl-2.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-[6px] text-slate-700 hover:text-[#004996] hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer"
                        title="Edit your review"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
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
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>

                {/* Rating & Comment */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-amber-400">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={cn(
                          'w-4 h-4',
                          s <= r.ratingStars
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-200',
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-slate-700 m-0 leading-relaxed">{r.comment}</p>

                  {/* Images */}
                  {r.images && r.images.length > 0 && (
                    <div className="flex gap-2 pt-2">
                      {r.images.map((img, i) => (
                        <a
                          key={i}
                          href={img}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-16 h-16 rounded-[6px] border border-slate-200 overflow-hidden"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Pharmacist Reply */}
                  {r.adminReply && (
                    <div className="relative mt-4 pl-12 sm:pl-14 pt-2 border-t border-slate-100">
                      {/* Curved connecting line */}
                      <div
                        className="absolute left-5 top-[-10px] w-7 h-10 border-l border-b border-slate-300 rounded-bl-xl pointer-events-none"
                        aria-hidden="true"
                      />

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

                      <div className="pl-13 mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line font-normal">
                        {r.adminReply}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : pendingProducts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <PackageCheck className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">No products waiting for review</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            All items from your delivered orders have already been reviewed. Thank you for your feedback!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {pendingProducts.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all"
            >
              <div className="flex gap-3 mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.imageUrl || '/favicon.ico'}
                  alt=""
                  className="w-16 h-16 rounded-xl object-contain border border-slate-100 bg-slate-50 p-1.5 shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug m-0">
                    {cleanText(p.medicineName)}
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold mt-1 tabular-nums">
                    {formatCurrency(Number(p.unitPrice))}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleOpenReviewModal(p)}
                className="w-full py-2.5 bg-[#004996] hover:bg-[#003875] text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Star className="w-3.5 h-3.5 fill-white" />
                <span>Review this Product</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Review Submission Modal */}
      <Modal
        title={
          <div className="text-xl font-bold text-black pb-1">
            {editingReviewId ? 'Edit Your Review' : 'Product Review'}
          </div>
        }
        open={reviewModalOpen}
        onCancel={() => {
          setReviewModalOpen(false);
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
        {selectedProduct && (
          <div className="space-y-4 pt-2">
            {/* Product Header Card */}
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-lg border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedProduct.imageUrl || '/favicon.ico'}
                  alt=""
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-black leading-snug line-clamp-2 m-0">
                  {cleanText(selectedProduct.medicineName)}
                </h4>
                <p className="text-xs text-[#6B7171] mt-1 m-0 font-medium">
                  Packaging: {selectedProduct.unitName || selectedProduct.packaging?.unitName || 'Standard unit'}
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
                    onChange={handleUploadImage}
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
        )}
      </Modal>
    </div>
  );
}

export default function CustomerReviewsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <CustomerReviewsContent />
    </Suspense>
  );
}
