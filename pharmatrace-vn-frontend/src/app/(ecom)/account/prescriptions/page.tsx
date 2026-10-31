'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { App, Modal, Spin } from 'antd';
import { ChevronRight, FileImage, UploadCloud } from 'lucide-react';
import { useAuth } from '@/store/useAuthStore';
import { Prescription, prescriptionService, ReviewStatus } from '@/services/prescription.service';

const statusText: Record<ReviewStatus, string> = {
  PENDING_APPROVAL: 'Waiting for pharmacist review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const subscribeToClient = () => () => {};

export default function PrescriptionsPage() {
  const { message } = App.useApp();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isHydrated = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const filePreviewRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await prescriptionService.listMine();
      setPrescriptions(response.data);
    } catch {
      message.error('Could not load your prescriptions. Try again.');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    prescriptionService.listMine()
      .then((response) => { if (active) setPrescriptions(response.data); })
      .catch(() => { if (active) message.error('Could not load your prescriptions. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated, message]);

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => () => {
    if (filePreviewRef.current) URL.revokeObjectURL(filePreviewRef.current);
  }, []);

  function selectFile(selected: File | null) {
    if (filePreviewRef.current) URL.revokeObjectURL(filePreviewRef.current);
    filePreviewRef.current = selected ? URL.createObjectURL(selected) : null;
    setFile(selected);
    setFilePreview(filePreviewRef.current);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      await prescriptionService.upload(file);
      selectFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      message.success('Prescription uploaded. Select it when placing an order.');
      await load();
    } catch (error) {
      const detail = error as { message?: string };
      message.error(detail.message || 'Upload failed. Choose a clear image smaller than 8 MB.');
    } finally {
      setUploading(false);
    }
  }

  async function viewImage(id: number) {
    setImageLoading(true);
    try {
      const image = await prescriptionService.customerImage(id);
      setImageUrl(URL.createObjectURL(image));
    } catch {
      message.error('Could not open this prescription image.');
    } finally {
      setImageLoading(false);
    }
  }

  if (!isHydrated || authLoading || (isAuthenticated && loading)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="w-full pb-16">
        <div className="bg-white rounded-[6px] border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-xs">
          <h2 className="text-xl font-bold text-slate-900 mb-2 tracking-tight">Sign In Required</h2>
          <p className="text-slate-500 text-sm mb-6 leading-relaxed">
            Sign in to upload a prescription and follow its review.
          </p>
          <Link
            href="/login?redirect=/account/prescriptions"
            className="inline-flex items-center justify-center w-full py-2.5 px-5 bg-[#004996] hover:bg-[#003875] text-white text-sm font-semibold rounded-[6px] transition-colors shadow-xs"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full pb-16">
      <nav aria-label="Breadcrumb" className="mb-4">
        <div className="flex items-center text-xs sm:text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-900 transition-colors font-medium">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-400" />
          <span className="text-slate-900 font-semibold">Your Prescriptions</span>
        </div>
      </nav>

      <header className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Your Prescriptions
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Upload a clear prescription, then select it at checkout. The pharmacist will review it before delivery.
          </p>
        </div>
      </header>

      <div className="space-y-6">
        <section className="rounded-[6px] border border-slate-200 bg-white p-5 md:p-6 shadow-xs" aria-labelledby="upload-title">
          <div className="flex items-start gap-2.5">
            <UploadCloud className="h-5 w-5 text-[#004996] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 id="upload-title" className="text-base font-bold text-slate-900">
                Upload a Prescription
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                JPEG, PNG, or WebP. Maximum 8 MB. Make sure all text is readable.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="prescription-file">Prescription image</label>
            <input
              ref={fileInputRef}
              id="prescription-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => selectFile(event.target.files?.[0] || null)}
              className="h-9 block w-full max-w-md rounded-[6px] border border-slate-300 text-xs bg-white cursor-pointer file:cursor-pointer [&::-webkit-file-upload-button]:cursor-pointer file:h-full file:mr-3 file:rounded-l-[5px] file:rounded-r-none file:border-0 file:border-r file:border-slate-200 file:bg-blue-50 file:px-3 file:text-xs file:font-semibold file:text-[#004996] focus-visible:outline-2 focus-visible:outline-[#004996]"
            />
            <button
              type="button"
              onClick={upload}
              disabled={!file || uploading}
              className="h-9 rounded-[6px] bg-[#004996] hover:bg-[#003875] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-xs cursor-pointer shrink-0"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>

          {filePreview && (
            <div className="mt-4 rounded-[6px] border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">Image Preview</p>
              <Image
                src={filePreview}
                alt="Selected prescription preview"
                width={480}
                height={320}
                unoptimized
                className="max-h-64 max-w-full rounded-[4px] object-contain border border-slate-200"
              />
            </div>
          )}
        </section>

        <section aria-labelledby="history-title">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="history-title" className="text-lg font-bold text-slate-900">
              Uploaded Prescriptions
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              {prescriptions.length} {prescriptions.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          {prescriptions.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-xs">
              <FileImage className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 mb-1">No Prescriptions Yet</p>
              <p className="text-xs text-slate-500">
                Upload one above before checking out with prescription medicine.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {prescriptions.map((prescription) => (
                <div key={prescription.id} className="rounded-[6px] border border-slate-200 bg-white p-4 sm:p-5 shadow-xs hover:border-slate-300 transition-all">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <FileImage className="h-4 w-4 text-[#004996] shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <p className="font-bold text-slate-900 text-sm">Prescription #{prescription.id}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Uploaded {new Date(prescription.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => viewImage(prescription.id)}
                      disabled={imageLoading}
                      className="h-8 rounded-[6px] border border-slate-300 bg-white hover:bg-slate-50 px-3 text-xs font-semibold text-[#004996] transition-colors shadow-xs cursor-pointer"
                    >
                      View Image
                    </button>
                  </div>
                  {prescription.reviews.length === 0 ? (
                    <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      Not linked to an order yet.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                      {prescription.reviews.map((review) => (
                        <li key={review.id} className="text-xs text-slate-700">
                          <Link href="/account/orders" className="font-semibold !text-[#004996] underline-offset-2 hover:underline">
                            Order #{review.orderId}
                          </Link>
                          : {review.orderStatus === 'CANCELLED' && review.status === 'PENDING_APPROVAL' ? 'Order cancelled before review' : statusText[review.status]}
                          {review.note && <p className="mt-1 text-slate-600 pl-2 border-l-2 border-slate-200">{review.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Modal
        title="Prescription Image"
        open={Boolean(imageUrl)}
        onCancel={() => setImageUrl(null)}
        footer={null}
        width={900}
        destroyOnHidden
        className="[&_.ant-modal-content]:!rounded-[6px]"
      >
        {imageUrl && (
          <Image
            src={imageUrl}
            alt="Uploaded prescription"
            width={900}
            height={1200}
            unoptimized
            className="max-h-[75vh] w-full object-contain rounded-[4px]"
          />
        )}
      </Modal>
    </div>
  );
}
