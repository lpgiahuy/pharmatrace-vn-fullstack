'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button as AButton,
  Card,
  Upload,
  Divider,
  Tabs,
  AutoComplete,
  DatePicker,
  Spin,
  message,
} from 'antd';
import {
  UploadOutlined,
  SaveOutlined,
  PlusOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  EditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { productService } from '@/services/product.service';
import { categoryService } from '@/services/category.service';
import { Category } from '@/types/category.types';
import { ProductPayload, PackagingSpecification } from '@/types/product.types';

const { TextArea } = Input;

function safeExtractFormString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') {
    const t = val.trim();
    return t === '[object Object]' ? '' : t;
  }
  if (Array.isArray(val)) {
    return val.map(safeExtractFormString).filter(Boolean).join('\n');
  }
  if (typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .filter(Boolean)
      .join('\n');
  }
  return String(val);
}

const SectionCustomFields = ({
  name,
  sectionLabel,
}: {
  name: (string | number)[];
  sectionLabel: string;
}) => (
  <div className="pt-4 mt-2 border-t border-slate-200/80">
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-black text-black-600 uppercase tracking-wider flex items-center gap-1.5">
        Custom Attributes for {sectionLabel}
      </span>
    </div>
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div className="space-y-3">
          {fields.map(({ key, name: fieldName }) => (
            <div
              key={key}
              className="flex items-center gap-2 p-2.5 bg-slate-50/80 border border-slate-200 rounded-[6px] hover:border-slate-300 transition-colors"
            >
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Form.Item
                  name={[fieldName, 'key']}
                  className="mb-0 sm:col-span-1"
                  rules={[{ required: true, message: 'Name is required' }]}
                >
                  <Input placeholder="Attribute Name (e.g. Storage Temp)" />
                </Form.Item>
                <Form.Item
                  name={[fieldName, 'value']}
                  className="mb-0 sm:col-span-2"
                  rules={[{ required: true, message: 'Value is required' }]}
                >
                  <Input placeholder="Value / Clinical detail" />
                </Form.Item>
              </div>
              <AButton
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => remove(fieldName)}
                className="shrink-0"
              />
            </div>
          ))}
          <AButton
            type="dashed"
            onClick={() => add()}
            icon={<PlusOutlined />}
            block
            className="h-9 rounded-[6px] border-dashed border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400 text-xs font-semibold"
          >
            Add Attribute to {sectionLabel}
          </AButton>
        </div>
      )}
    </Form.List>
  </div>
);

function detectSectionFromKey(key: string): 'composition' | 'indications' | 'safety' | 'usage' | 'pharmacology' | 'interactions' | 'manufacturing' {
  const k = key.toLowerCase();
  if (k.includes('pharmacodynamic') || k.includes('pharmacokinetic') || k.includes('mechanism') || k.includes('absorption') || k.includes('metabolism') || k.includes('elimination')) {
    return 'pharmacology';
  }
  if (k.includes('interaction')) {
    return 'interactions';
  }
  if (k.includes('adverse') || k.includes('side_effect') || k.includes('warning') || k.includes('precaution') || k.includes('driving') || k.includes('contraindication') || k.includes('safety') || k.includes('pregnancy') || k.includes('lactation') || k.includes('pediatric') || k.includes('geriatric')) {
    return 'safety';
  }
  if (k.includes('dose') || k.includes('dosage') || k.includes('usage') || k.includes('admin') || k.includes('overdose') || k.includes('missed_dose')) {
    return 'usage';
  }
  if (k.includes('indication') || k.includes('benefit')) {
    return 'indications';
  }
  if (k.includes('origin') || k.includes('mfg') || k.includes('manufacturer') || k.includes('storage') || k.includes('package') || k.includes('brand')) {
    return 'manufacturing';
  }
  return 'composition';
}

const buildProductDetails = (dt: any = {}) => {
  if (!dt || typeof dt !== 'object') return undefined;
  const result: any = {};

  ['generalDescription', 'effectsOnDriving', 'adverseReactionManagement'].forEach((k) => {
    if (typeof dt[k] === 'string' && dt[k].trim()) {
      result[k] = dt[k].trim();
    }
  });

  ['indications', 'contraindications', 'sideEffects', 'warningsAndPrecautions', 'ingredients'].forEach((k) => {
    const raw = dt[k];
    if (Array.isArray(raw)) {
      const arr = raw
        .map((v: any) => (typeof v === 'string' ? v.trim() : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v || '').trim()))
        .filter(Boolean);
      if (arr.length) result[k] = arr;
    } else if (typeof raw === 'string' && raw.trim()) {
      const lines = raw.split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (lines.length > 0) {
        result[k] = lines;
      }
    }
  });

  const detailedIngredients = dt.detailedIngredients || {};
  if (typeof detailedIngredients === 'object' && detailedIngredients !== null) {
    const active = detailedIngredients.activeIngredients?.trim?.();
    const excipients = detailedIngredients.excipients?.trim?.();
    if (active || excipients) {
      result.detailedIngredients = {};
      if (active) result.detailedIngredients.activeIngredients = active;
      if (excipients) result.detailedIngredients.excipients = excipients;
    }
  }

  const pd = dt.pharmacodynamics || {};
  if (typeof pd === 'object' && pd !== null) {
    if (pd.pharmacologicalClass?.trim?.() || pd.mechanismOfAction?.trim?.()) {
      result.pharmacodynamics = {};
      if (pd.pharmacologicalClass?.trim?.()) result.pharmacodynamics.pharmacologicalClass = pd.pharmacologicalClass.trim();
      if (pd.mechanismOfAction?.trim?.()) result.pharmacodynamics.mechanismOfAction = pd.mechanismOfAction.trim();
    }
  }

  const pk = dt.pharmacokinetics || {};
  if (typeof pk === 'object' && pk !== null && Object.values(pk).some((v: any) => (typeof v === 'string' ? v?.trim?.() : v))) {
    result.pharmacokinetics = {};
    ['absorption', 'metabolism', 'elimination'].forEach((k) => {
      if (pk[k] && String(pk[k]).trim()) result.pharmacokinetics[k] = String(pk[k]).trim();
    });
  }

  const usage = dt.usageInstructions || {};
  if (typeof usage === 'object' && usage !== null && Object.values(usage).some((v: any) => (typeof v === 'string' ? v?.trim?.() : v))) {
    result.usageInstructions = {};
    ['administration', 'dosage', 'missedDose', 'overdoseManagement'].forEach((k) => {
      if (usage[k] && String(usage[k]).trim()) result.usageInstructions[k] = String(usage[k]).trim();
    });
  }

  const mfg = dt.manufacturingInfo || {};
  if (typeof mfg === 'object' && mfg !== null && Object.values(mfg).some((v: any) => (typeof v === 'string' ? v?.trim?.() : v))) {
    result.manufacturingInfo = {};
    ['brand', 'manufacturer', 'origin', 'storage', 'packaging'].forEach((k) => {
      if (mfg[k] && String(mfg[k]).trim()) result.manufacturingInfo[k] = String(mfg[k]).trim();
    });
  }

  const sp = dt.specialPatientGroups || {};
  if (typeof sp === 'object' && sp !== null && (sp.pregnancy?.trim?.() || sp.lactation?.trim?.() || sp.pediatric?.trim?.() || sp.geriatric?.trim?.())) {
    result.specialPatientGroups = {};
    if (sp.pregnancy?.trim?.()) result.specialPatientGroups.pregnancy = sp.pregnancy.trim();
    if (sp.lactation?.trim?.()) result.specialPatientGroups.lactation = sp.lactation.trim();
    if (sp.pediatric?.trim?.()) result.specialPatientGroups.pediatric = sp.pediatric.trim();
    if (sp.geriatric?.trim?.()) result.specialPatientGroups.geriatric = sp.geriatric.trim();
  }

  if (Array.isArray(dt.drugInteractions)) {
    const diArr = dt.drugInteractions.filter((v: any) => v?.drug?.trim?.() || v?.effect?.trim?.());
    if (diArr.length) result.drugInteractions = diArr;
  }

  // Handle section-based extra fields
  const extra = dt.extra_fields || {};
  const customFieldsCombined: { key: string; value: string; section: string }[] = [];

  if (typeof extra === 'object' && extra !== null) {
    result.extra_fields = {};
    Object.entries(extra).forEach(([sec, list]: [string, any]) => {
      if (Array.isArray(list)) {
        const valid = list.filter((item: any) => item?.key && String(item.key).trim());
        if (valid.length) {
          result.extra_fields[sec] = valid.map((f: any) => ({
            key: String(f.key).trim(),
            value: String(f.value || '').trim(),
          }));
          valid.forEach((f: any) => {
            customFieldsCombined.push({
              key: String(f.key).trim(),
              value: String(f.value || '').trim(),
              section: sec,
            });
          });
        }
      }
    });
  }

  if (customFieldsCombined.length > 0) {
    result.custom_fields = customFieldsCombined;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

export default function ProductForm({ productId }: { productId?: number }) {
  const router = useRouter();
  const isEdit = Boolean(productId);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(isEdit);
  const [editDetailsMode, setEditDetailsMode] = useState(!isEdit);
  const [productDetailsData, setProductDetailsData] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [, setPackagings] = useState<PackagingSpecification[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    categoryService.getCategories().then((res) => {
      if (res?.data) setCategories(res.data);
    });
    productService.getPackagings().then((res) => {
      if (res?.data) setPackagings(res.data);
    });

    if (!isEdit || !productId) {
      setInitLoading(false);
      return;
    }

    productService
      .getProductById(productId)
      .then((res) => {
        const p = res?.data;
        if (!p) return;
        const ct = p.details || {};
        setImageUrl(p.imageUrl || '');

        const packagingVariants =
          p.packagingOptions && p.packagingOptions.length > 0
            ? p.packagingOptions.map((opt, idx) => {
              const discountPct =
                opt.discountPercent !== undefined &&
                  opt.discountPercent !== null &&
                  opt.discountPercent > 0
                  ? opt.discountPercent
                  : opt.originalPrice &&
                    opt.price &&
                    Number(opt.originalPrice) > Number(opt.price)
                    ? Math.round(
                      ((Number(opt.originalPrice) - Number(opt.price)) /
                        Number(opt.originalPrice)) *
                      100,
                    )
                    : 0;

              return {
                unitName: opt.unitName,
                price: opt.price,
                originalPrice: opt.originalPrice || null,
                discountPercent: discountPct,
                saleStartDate: opt.saleStartDate ? dayjs(opt.saleStartDate) : null,
                saleEndDate: opt.saleEndDate ? dayjs(opt.saleEndDate) : null,
                isBaseUnit: idx === 0,
              };
            })
            : [
              {
                unitName: p.packaging?.unitName || 'Box',
                price: p.promotionalPrice || p.unitPrice,
                originalPrice: p.promotionalPrice ? p.unitPrice : null,
                discountPercent:
                  p.promotionalPrice && p.promotionalPrice < p.unitPrice
                    ? Math.round(((p.unitPrice - p.promotionalPrice) / p.unitPrice) * 100)
                    : 0,
                saleStartDate: null,
                saleEndDate: null,
                isBaseUnit: true,
              },
            ];

        const rawIndications = ct.indications || ct.chi_dinh || ct.cong_dung || '';
        const rawContraindications = ct.contraindications || ct.chong_chi_dinh || '';
        const rawSideEffects = ct.sideEffects || ct.tac_dung_phu || '';
        const rawWarnings = ct.warningsAndPrecautions || ct.canh_bao_than_trong || ct.than_trong || '';

        const parseList = (raw: any): string[] => {
          if (Array.isArray(raw)) {
            return raw.map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v || '').trim())).filter(Boolean);
          }
          if (typeof raw === 'string' && raw.trim()) {
            return raw.split('\n').map((s) => s.trim()).filter(Boolean);
          }
          return [];
        };

        const mappedDetails = {
          generalDescription: ct.generalDescription || ct.mo_ta_chung || '',
          indications: parseList(rawIndications),
          contraindications: parseList(rawContraindications),
          sideEffects: parseList(rawSideEffects),
          warningsAndPrecautions: parseList(rawWarnings),
          effectsOnDriving: ct.effectsOnDriving || ct.anh_huong_lai_xe || ct.lai_xe_van_hanh_may_moc || '',
          adverseReactionManagement: ct.adverseReactionManagement || ct.xu_tri_tac_dung_phu || '',
          detailedIngredients: {
            activeIngredients: safeExtractFormString(
              ct.detailedIngredients?.activeIngredients ||
              ct.thanh_phan_chi_tiet?.hoat_chat ||
              ct.hoat_chat ||
              (Array.isArray(ct.ingredients) ? ct.ingredients.join(', ') : typeof ct.ingredients === 'string' ? ct.ingredients : '') ||
              p.activeIngredients,
            ),
            excipients: safeExtractFormString(
              ct.detailedIngredients?.excipients ||
              ct.thanh_phan_chi_tiet?.ta_duoc ||
              ct.ta_duoc,
            ),
          },
          usageInstructions: {
            administration: safeExtractFormString(
              ct.usageInstructions?.administration ||
              ct.huong_dan_su_dung?.cach_dung ||
              ct.cach_dung,
            ),
            dosage: safeExtractFormString(
              ct.usageInstructions?.dosage ||
              ct.huong_dan_su_dung?.lieu_dung ||
              ct.lieu_dung ||
              p.dosage,
            ),
            missedDose: safeExtractFormString(
              ct.usageInstructions?.missedDose ||
              ct.huong_dan_su_dung?.quen_lieu ||
              ct.quen_lieu,
            ),
            overdoseManagement: safeExtractFormString(
              ct.usageInstructions?.overdoseManagement ||
              ct.huong_dan_su_dung?.qua_lieu_va_xu_tri ||
              ct.huong_dan_su_dung?.qua_lieu ||
              ct.qua_lieu,
            ),
          },
          pharmacodynamics: {
            pharmacologicalClass: safeExtractFormString(
              ct.pharmacodynamics?.pharmacologicalClass ||
              ct.duoc_luc_hoc?.nhom_duoc_ly ||
              ct.nhom_duoc_ly,
            ),
            mechanismOfAction: safeExtractFormString(
              ct.pharmacodynamics?.mechanismOfAction ||
              ct.duoc_luc_hoc?.co_che_tac_dung ||
              ct.co_che_tac_dung,
            ),
          },
          pharmacokinetics: {
            absorption: safeExtractFormString(
              ct.pharmacokinetics?.absorption ||
              ct.duoc_dong_hoc?.hap_thu ||
              ct.hap_thu,
            ),
            metabolism: safeExtractFormString(
              ct.pharmacokinetics?.metabolism ||
              ct.duoc_dong_hoc?.chuyen_hoa ||
              ct.chuyen_hoa,
            ),
            elimination: safeExtractFormString(
              ct.pharmacokinetics?.elimination ||
              ct.duoc_dong_hoc?.thai_tru ||
              ct.thai_tru,
            ),
          },
          drugInteractions:
            (Array.isArray(ct.drugInteractions) ? ct.drugInteractions : null) ||
            (Array.isArray(ct.tuong_tac_thuoc)
              ? ct.tuong_tac_thuoc.map((item: any) => ({
                drug: item.drug || item.thuoc || item.item || item.name || '',
                effect: item.effect || item.hau_qua || item.description || '',
              }))
              : []),
          manufacturingInfo: {
            brand:
              ct.manufacturingInfo?.brand ||
              ct.thong_tin_san_xuat?.thuong_hieu ||
              ct.thuong_hieu ||
              '',
            manufacturer:
              ct.manufacturingInfo?.manufacturer ||
              ct.thong_tin_san_xuat?.nha_san_xuat ||
              ct.nha_san_xuat ||
              p.manufacturer ||
              '',
            origin:
              ct.manufacturingInfo?.origin ||
              ct.thong_tin_san_xuat?.xuat_xu ||
              ct.xuat_xu ||
              p.countryOfOrigin ||
              '',
            storage:
              ct.manufacturingInfo?.storage ||
              ct.thong_tin_san_xuat?.bao_quan ||
              ct.bao_quan ||
              '',
            packaging:
              ct.manufacturingInfo?.packaging ||
              ct.thong_tin_san_xuat?.quy_cach ||
              ct.quy_cach ||
              '',
          },
          specialPatientGroups: {
            pregnancy:
              ct.specialPatientGroups?.pregnancy ||
              ct.nhom_benh_nhan_dac_biet?.phu_nu_mang_thai ||
              ct.nhom_benh_nhan_dac_biet?.pregnancy ||
              ct.phu_nu_mang_thai ||
              '',
            lactation:
              ct.specialPatientGroups?.lactation ||
              ct.nhom_benh_nhan_dac_biet?.phu_nu_cho_con_bu ||
              ct.nhom_benh_nhan_dac_biet?.lactation ||
              ct.phu_nu_cho_con_bu ||
              '',
            pediatric:
              ct.specialPatientGroups?.pediatric ||
              ct.specialPatientGroups?.pediatricUse ||
              ct.nhom_benh_nhan_dac_biet?.tre_em ||
              ct.nhom_benh_nhan_dac_biet?.pediatric ||
              ct.nhom_benh_nhan_dac_biet?.pediatricUse ||
              ct.tre_em ||
              '',
            geriatric:
              ct.specialPatientGroups?.geriatric ||
              ct.specialPatientGroups?.elderly ||
              ct.nhom_benh_nhan_dac_biet?.nguoi_cao_tuoi ||
              ct.nhom_benh_nhan_dac_biet?.geriatric ||
              ct.nhom_benh_nhan_dac_biet?.elderly ||
              ct.nguoi_cao_tuoi ||
              '',
          },
          extra_fields: (() => {
            const extraFieldsBySection: Record<string, { key: string; value: string }[]> = {
              composition: [],
              indications: [],
              safety: [],
              usage: [],
              pharmacology: [],
              interactions: [],
              manufacturing: [],
            };

            if (ct.extra_fields && typeof ct.extra_fields === 'object') {
              Object.entries(ct.extra_fields).forEach(([sec, list]: [string, any]) => {
                if (Array.isArray(list) && extraFieldsBySection[sec]) {
                  extraFieldsBySection[sec] = list;
                }
              });
            }

            const standardKeys = new Set([
              'ingredients', 'contraindications', 'manufacturingInfo', 'usageInstructions',
              'detailedIngredients', 'specialPatientGroups', 'warningsAndPrecautions',
              'indications', 'sideEffects', 'drugInteractions', 'generalDescription',
              'effectsOnDriving', 'thong_tin_san_xuat', 'huong_dan_su_dung', 'thanh_phan_chi_tiet',
              'nhom_benh_nhan_dac_biet', 'mo_ta_chung', 'chi_dinh', 'chong_chi_dinh',
              'tac_dung_phu', 'canh_bao_than_trong', 'anh_huong_lai_xe', 'duoc_luc_hoc',
              'duoc_dong_hoc', 'tuong_tac_thuoc', 'custom_fields', 'customFields',
              'extra_fields', 'extraFields', 'xu_tri_tac_dung_phu', 'pharmacodynamics',
              'pharmacokinetics', 'adverseReactionManagement', 'cong_dung', 'than_trong',
              'lai_xe_van_hanh_may_moc', 'hoat_chat', 'ta_duoc', 'thanh_phan', 'cach_dung',
              'lieu_dung', 'quen_lieu', 'qua_lieu', 'qua_lieu_va_xu_tri', 'thuong_hieu',
              'nha_san_xuat', 'xuat_xu', 'nuoc_san_xuat', 'quy_cach', 'bao_quan',
              'phu_nu_mang_thai', 'phu_nu_cho_con_bu', 'tre_em', 'nguoi_cao_tuoi',
              'suy_than', 'suy_gan', 'nhom_duoc_ly', 'co_che_tac_dung', 'hap_thu',
              'chuyen_hoa', 'thai_tru'
            ]);

            const customFieldsList: { key: string; value: string; section?: string }[] = [];
            if (Array.isArray(ct.custom_fields)) {
              customFieldsList.push(...ct.custom_fields);
            } else if (Array.isArray(ct.customFields)) {
              customFieldsList.push(...ct.customFields);
            } else if (ct.customFields && typeof ct.customFields === 'object') {
              Object.entries(ct.customFields).forEach(([k, v]) => {
                customFieldsList.push({ key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
              });
            }

            Object.entries(ct).forEach(([k, v]) => {
              if (!standardKeys.has(k) && v !== null && v !== undefined && v !== '') {
                customFieldsList.push({
                  key: k,
                  value: typeof v === 'object' ? JSON.stringify(v) : String(v),
                });
              }
            });

            customFieldsList.forEach((item) => {
              if (!item?.key) return;
              const sec = item.section || detectSectionFromKey(item.key);
              if (extraFieldsBySection[sec] && !extraFieldsBySection[sec].some((e) => e.key === item.key)) {
                extraFieldsBySection[sec].push({
                  key: item.key,
                  value: typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value || ''),
                });
              }
            });

            return extraFieldsBySection;
          })(),
        };

        setProductDetailsData(mappedDetails);

        const primaryCatId =
          p.categories?.find((c) => c.isPrimary)?.id ||
          p.category?.id ||
          p.categoryId ||
          null;
        const allCatIds =
          p.categories && p.categories.length > 0
            ? p.categories.map((c) => c.id)
            : primaryCatId
              ? [primaryCatId]
              : [];

        form.setFieldsValue({
          medicineName: p.medicineName,
          registrationNumber: p.registrationNumber || '',
          primaryCategoryId: primaryCatId,
          categoryIds: allCatIds,
          manufacturer: p.manufacturer || ct?.manufacturingInfo?.manufacturer || '',
          imageUrl: p.imageUrl || '',
          isPrescription: p.isPrescription ?? false,
          shortDescription: p.shortDescription || ct?.generalDescription || ct?.mo_ta_chung || '',
          isActive: (p.status || 'ACTIVE').toUpperCase() === 'ACTIVE',
          packagingVariants,
          details: {
            ...mappedDetails,
            indications: Array.isArray(mappedDetails.indications) ? mappedDetails.indications.join('\n') : mappedDetails.indications,
            contraindications: Array.isArray(mappedDetails.contraindications) ? mappedDetails.contraindications.join('\n') : mappedDetails.contraindications,
            sideEffects: Array.isArray(mappedDetails.sideEffects) ? mappedDetails.sideEffects.join('\n') : mappedDetails.sideEffects,
            warningsAndPrecautions: Array.isArray(mappedDetails.warningsAndPrecautions) ? mappedDetails.warningsAndPrecautions.join('\n') : mappedDetails.warningsAndPrecautions,
          },
        });
      })
      .catch(() => {
        messageApi.error('Failed to load product details');
      })
      .finally(() => setInitLoading(false));
  }, [productId, isEdit, form, messageApi]);

  const handlePriceChange = (fieldKey: number, val: any) => {
    const price = Number(val) || 0;
    const variants = form.getFieldValue('packagingVariants') || [];
    const row = variants[fieldKey] || {};
    const originalPrice = Number(row.originalPrice) || 0;
    const discountPercent = Number(row.discountPercent) || 0;

    if (originalPrice > 0) {
      if (price > 0 && price < originalPrice) {
        const pct = Math.max(0, Math.round(((originalPrice - price) / originalPrice) * 100));
        form.setFieldValue(['packagingVariants', fieldKey, 'discountPercent'], pct);
      } else {
        form.setFieldValue(['packagingVariants', fieldKey, 'discountPercent'], 0);
      }
    } else if (discountPercent > 0 && discountPercent < 100 && price > 0) {
      const computedOriginal = Math.round(price / (1 - discountPercent / 100));
      form.setFieldValue(['packagingVariants', fieldKey, 'originalPrice'], computedOriginal);
    }
  };

  const handleOriginalPriceChange = (fieldKey: number, val: any) => {
    const originalPrice = Number(val) || 0;
    const variants = form.getFieldValue('packagingVariants') || [];
    const row = variants[fieldKey] || {};
    const price = Number(row.price) || 0;
    const discountPercent = Number(row.discountPercent) || 0;

    if (originalPrice > 0) {
      if (price > 0) {
        if (originalPrice > price) {
          const pct = Math.max(0, Math.round(((originalPrice - price) / originalPrice) * 100));
          form.setFieldValue(['packagingVariants', fieldKey, 'discountPercent'], pct);
        } else {
          form.setFieldValue(['packagingVariants', fieldKey, 'discountPercent'], 0);
        }
      } else if (discountPercent > 0 && discountPercent < 100) {
        const computedPrice = Math.max(0, Math.round(originalPrice * (1 - discountPercent / 100)));
        form.setFieldValue(['packagingVariants', fieldKey, 'price'], computedPrice);
      }
    }
  };

  const handleDiscountPercentChange = (fieldKey: number, val: any) => {
    const pct = Number(val) || 0;
    const variants = form.getFieldValue('packagingVariants') || [];
    const row = variants[fieldKey] || {};
    const originalPrice = Number(row.originalPrice) || 0;
    const price = Number(row.price) || 0;

    if (originalPrice > 0) {
      const computedPrice = Math.max(0, Math.round(originalPrice * (1 - pct / 100)));
      form.setFieldValue(['packagingVariants', fieldKey, 'price'], computedPrice);
    } else if (price > 0 && pct > 0 && pct < 100) {
      const computedOriginal = Math.round(price / (1 - pct / 100));
      form.setFieldValue(['packagingVariants', fieldKey, 'originalPrice'], computedOriginal);
    }
  };

  const handleBaseUnitToggle = (fieldKey: number, checked: boolean) => {
    const variants = form.getFieldValue('packagingVariants') || [];
    const updated = variants.map((item: any, idx: number) => ({
      ...item,
      isBaseUnit: checked ? idx === fieldKey : (idx === fieldKey ? false : item.isBaseUnit),
    }));

    const hasBase = updated.some((i: any) => i.isBaseUnit);
    if (!hasBase && updated.length > 0) {
      updated[0].isBaseUnit = true;
    }

    form.setFieldsValue({ packagingVariants: updated });
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      if (productId) {
        const res = await productService.uploadProductImage(productId, file);
        if (res?.data?.imageUrl) {
          setImageUrl(res.data.imageUrl);
          form.setFieldsValue({ imageUrl: res.data.imageUrl });
        }
      } else {
        const res = await productService.uploadImageDirect(file);
        if (res?.data?.imageUrl) {
          setImageUrl(res.data.imageUrl);
          form.setFieldsValue({ imageUrl: res.data.imageUrl });
        }
      }
      messageApi.success('Image uploaded to Cloudinary successfully!');
    } catch (err: any) {
      console.error('Image upload error:', err);
      messageApi.error(err?.message || 'Failed to upload image to Cloudinary');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const variants = values.packagingVariants || [];
      if (variants.length === 0) {
        messageApi.error('Please add at least 1 packaging variant.');
        setLoading(false);
        return;
      }

      const baseVariant = variants.find((v: any) => v.isBaseUnit) || variants[0];
      const originalPrice = Number(baseVariant.originalPrice) || 0;
      const price = Number(baseVariant.price) || 0;
      const pct = Number(baseVariant.discountPercent) || 0;

      let unitPrice = originalPrice > 0 ? originalPrice : price > 0 ? price : 0;
      let promotionalPrice: number | undefined = undefined;

      if (originalPrice > 0 && price > 0 && price < originalPrice) {
        unitPrice = originalPrice;
        promotionalPrice = price;
      } else if (pct > 0 && unitPrice > 0) {
        promotionalPrice = Math.round(unitPrice * (1 - pct / 100));
      }

      const details = buildProductDetails(values.details) || {};
      const mfgInput = (values.manufacturer || '').trim();

      if (mfgInput) {
        if (!details.manufacturingInfo) details.manufacturingInfo = {};
        details.manufacturingInfo.manufacturer = mfgInput;
      }

      const shortDesc = (values.shortDescription || '').trim();
      if (shortDesc) {
        details.generalDescription = shortDesc;
      }

      const activeIngredients =
        details.detailedIngredients?.activeIngredients ||
        (Array.isArray(details.ingredients) ? details.ingredients.join(', ') : undefined);

      const primaryCategoryId = values.primaryCategoryId ? Number(values.primaryCategoryId) : undefined;
      const rawCatIds = Array.isArray(values.categoryIds) ? values.categoryIds.map(Number) : [];
      const categoryIds = Array.from(new Set([...rawCatIds, ...(primaryCategoryId ? [primaryCategoryId] : [])]));

      const mappedPackagingVariants = variants.map((v: any) => ({
        unitName: (v.unitName || '').trim(),
        price: Number(v.price) || 0,
        originalPrice: v.originalPrice ? Number(v.originalPrice) : undefined,
        discountPercent: Number(v.discountPercent) || 0,
        isBaseUnit: Boolean(v.isBaseUnit),
        saleStartDate: v.saleStartDate ? (v.saleStartDate.toISOString ? v.saleStartDate.toISOString() : v.saleStartDate) : undefined,
        saleEndDate: v.saleEndDate ? (v.saleEndDate.toISOString ? v.saleEndDate.toISOString() : v.saleEndDate) : undefined,
      }));

      const payload: ProductPayload = {
        medicineName: values.medicineName,
        registrationNumber: values.registrationNumber || undefined,
        primaryCategoryId,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
        categoryId: primaryCategoryId,
        manufacturer: mfgInput || undefined,
        activeIngredients: activeIngredients || undefined,
        dosage: values.dosage || undefined,
        countryOfOrigin: details.manufacturingInfo?.origin || undefined,
        imageUrl: values.imageUrl || imageUrl || undefined,
        isPrescription: values.isPrescription ?? false,
        shortDescription: values.shortDescription || undefined,
        status: values.isActive ? 'ACTIVE' : 'INACTIVE',
        unitPrice,
        promotionalPrice,
        details,
        packagingVariants: mappedPackagingVariants.length > 0 ? mappedPackagingVariants : undefined,
      };

      if (isEdit && productId) {
        await productService.updateProduct(productId, payload);
        messageApi.success('Product updated successfully!');
      } else {
        await productService.createProduct(payload);
        messageApi.success('Product created successfully!');
      }

      router.push('/admin/products');
    } catch (err: any) {
      console.error('Save product error:', err);
      let errMsg = 'Failed to save product';
      if (typeof err === 'string') {
        errMsg = err;
      } else if (err?.message) {
        errMsg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      } else if (err?.response?.data?.message) {
        const msg = err.response.data.message;
        errMsg = Array.isArray(msg) ? msg.join(', ') : msg;
      }
      messageApi.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in pb-20">
      {contextHolder}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 m-0">
            {isEdit ? 'Edit Product' : 'Add New Product'}
          </h1>
          <p className="text-slate-500 text-sm m-0 mt-1">
            Manage pharmaceutical catalog specifications & traceability data
          </p>
        </div>
        <AButton
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/admin/products')}
        >
          Back to List
        </AButton>
      </div>

      <Spin spinning={initLoading} description="Loading product specifications...">
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          requiredMark={(label, { required }) => (
            <span>
              {label}
              {!required && <span className="text-slate-400 font-normal text-xs ml-1">(optional)</span>}
            </span>
          )}
          initialValues={{
            isActive: true,
            isPrescription: false,
            packagingVariants: [
              {
                unitName: 'Box',
                price: null,
                originalPrice: null,
                discountPercent: 0,
                saleStartDate: null,
                saleEndDate: null,
                isBaseUnit: true,
              },
            ],
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column (2 cols) */}
            <div className="lg:col-span-2 space-y-6">
              <Card title="General Information" className="shadow-xs border-slate-200 rounded-[6px]">
                <div className="grid sm:grid-cols-2 gap-x-4">
                  <Form.Item
                    label="Product Name"
                    name="medicineName"
                    rules={[{ required: true, message: 'Please enter product name' }]}
                    className="sm:col-span-2"
                  >
                    <Input placeholder="e.g. Panadol Extra with Optizorb" />
                  </Form.Item>
                  <Form.Item
                    label="Registration / Visa Number"
                    name="registrationNumber"
                    rules={[{ required: true, message: 'Please enter registration / visa number' }]}
                  >
                    <Input placeholder="e.g. VD-28491-18" />
                  </Form.Item>
                  <Form.Item
                    label="Primary Category"
                    name="primaryCategoryId"
                    rules={[{ required: true, message: 'Please select a primary category' }]}
                  >
                    <Select
                      showSearch
                      placeholder="Select primary category"
                      optionFilterProp="children"
                      onChange={(val) => {
                        const currentCatIds = form.getFieldValue('categoryIds') || [];
                        if (!currentCatIds.includes(val)) {
                          form.setFieldValue('categoryIds', [...currentCatIds, val]);
                        }
                      }}
                    >
                      {categories.map((c) => (
                        <Select.Option key={c.id} value={c.id}>
                          {c.categoryName}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item
                    label="Associated Categories"
                    name="categoryIds"
                    className="sm:col-span-2"
                  >
                    <Select
                      mode="multiple"
                      showSearch
                      placeholder="Select all additional categories this medicine belongs to..."
                      optionFilterProp="children"
                      allowClear
                    >
                      {categories.map((c) => (
                        <Select.Option key={c.id} value={c.id}>
                          {c.categoryName}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item
                    label="Manufacturer"
                    name="manufacturer"
                    className="sm:col-span-2"
                  >
                    <AutoComplete
                      placeholder="Select manufacturer (e.g. DHG Pharma, Pfizer, AstraZeneca, Hasan...)"
                      options={[
                        { value: 'DHG Pharma', label: 'DHG Pharma (Manufacturer)' },
                        { value: 'Hasan - Demarpharm', label: 'Hasan - Demarpharm (Manufacturer)' },
                        { value: 'Pfizer Vietnam', label: 'Pfizer Vietnam (Manufacturer)' },
                        { value: 'AstraZeneca Vietnam', label: 'AstraZeneca Vietnam (Manufacturer)' },
                        { value: 'Sanofi Vietnam', label: 'Sanofi Vietnam (Manufacturer)' },
                      ]}
                      filterOption={(inputValue, option) =>
                        (option?.value || '').toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                      }
                      allowClear
                    />
                  </Form.Item>
                  <Form.Item label="Short Description" name="shortDescription" className="sm:col-span-2">
                    <TextArea rows={3} placeholder="Brief summary of medication..." />
                  </Form.Item>
                </div>
              </Card>

              <Card
                title="Clinical & Pharmacology Specifications"
                className="shadow-xs border-slate-200 rounded-[6px]"
                extra={
                  isEdit ? (
                    <AButton
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setEditDetailsMode(!editDetailsMode)}
                      className="text-slate-700 border-slate-200 bg-white hover:bg-slate-50 font-medium text-xs rounded-[6px]"
                    >
                      {editDetailsMode ? 'View Summary' : 'Edit Details'}
                    </AButton>
                  ) : null
                }
              >
                {!editDetailsMode && isEdit && productDetailsData ? (
                  <div className="space-y-4 bg-white p-5 rounded-[6px] border border-slate-200 divide-y divide-slate-100">
                    {/* 1. Ingredients */}
                    <div className="space-y-1.5 pb-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">1.</span>
                        <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                          Active Formulation & Ingredients
                        </p>
                      </div>
                      <div className="pl-4 space-y-1">
                        <p className="text-sm text-slate-700 m-0 leading-relaxed">
                          {productDetailsData.detailedIngredients?.activeIngredients ||
                            (Array.isArray(productDetailsData.ingredients)
                              ? productDetailsData.ingredients.join(', ')
                              : 'Standard pharmaceutical formulation')}
                        </p>
                        {productDetailsData.generalDescription && (
                          <p className="text-sm text-slate-700 m-0 leading-relaxed pt-0.5">
                            {productDetailsData.generalDescription}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 2. Indications */}
                    <div className="space-y-1.5 pt-4 pb-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">2.</span>
                        <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                          Indications & Approved Uses
                        </p>
                      </div>
                      <div className="pl-4">
                        {productDetailsData.indications?.length > 0 ? (
                          <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1 m-0 leading-relaxed">
                            {productDetailsData.indications.map((ind: string, i: number) => (
                              <li key={i}>{ind}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-slate-400 italic m-0">No indications specified.</p>
                        )}
                      </div>
                    </div>

                    {/* 3. Directions for Use */}
                    <div className="space-y-1.5 pt-4 pb-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">3.</span>
                        <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                          Directions for Use & Administration
                        </p>
                      </div>
                      <div className="pl-4 space-y-1.5 text-sm text-slate-700 leading-relaxed">
                        {productDetailsData.usageInstructions?.administration && (
                          <p className="m-0">
                            <span className="font-bold text-slate-900">Administration: </span>
                            {productDetailsData.usageInstructions.administration}
                          </p>
                        )}
                        {productDetailsData.usageInstructions?.dosage && (
                          <p className="m-0">
                            <span className="font-bold text-slate-900">Dosage: </span>
                            {productDetailsData.usageInstructions.dosage}
                          </p>
                        )}
                        {!productDetailsData.usageInstructions?.administration &&
                          !productDetailsData.usageInstructions?.dosage && (
                            <p className="text-slate-400 italic m-0">Standard clinical dosing as directed by physician.</p>
                          )}
                        {productDetailsData.usageInstructions?.missedDose && (
                          <p className="m-0 text-slate-700">
                            <span className="font-bold text-slate-900">Missed dose: </span>
                            {productDetailsData.usageInstructions.missedDose}
                          </p>
                        )}
                        {productDetailsData.usageInstructions?.overdoseManagement && (
                          <p className="m-0 text-slate-700">
                            <span className="font-bold text-slate-900">Overdose: </span>
                            {productDetailsData.usageInstructions.overdoseManagement}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 4. Precautions & Safety Warnings */}
                    <div className="space-y-1.5 pt-4 pb-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">4.</span>
                        <p className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">
                          Precautions, Contraindications & Safety
                        </p>
                      </div>
                      <div className="pl-4 space-y-3 text-sm">
                        {productDetailsData.contraindications?.length > 0 && (
                          <div>
                            <span className="font-bold text-slate-900 block mb-1 text-sm">Contraindications:</span>
                            <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                              {productDetailsData.contraindications.map((c: string, i: number) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {productDetailsData.warningsAndPrecautions?.length > 0 && (
                          <div>
                            <span className="font-bold text-slate-900 block mb-1 text-sm">Warnings & Precautions:</span>
                            <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                              {productDetailsData.warningsAndPrecautions.map((w: string, i: number) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {productDetailsData.sideEffects?.length > 0 && (
                          <div>
                            <span className="font-bold text-slate-900 block mb-1 text-sm">Side Effects:</span>
                            <ul className="list-disc pl-4 text-slate-700 space-y-1 m-0 leading-relaxed">
                              {productDetailsData.sideEffects.map((s: string, i: number) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {productDetailsData.specialPatientGroups && (() => {
                          const sp = productDetailsData.specialPatientGroups;
                          return (
                            <div className="bg-slate-50 p-3.5 rounded-[6px] border border-slate-200/80 text-slate-700 space-y-1.5 text-sm">
                              <span className="font-bold text-slate-900 block text-sm">Special Patient Considerations:</span>
                              {sp.pregnancy && (
                                <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Pregnancy: </span>{sp.pregnancy}</p>
                              )}
                              {sp.lactation && (
                                <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Lactation: </span>{sp.lactation}</p>
                              )}
                              {(sp.pediatric || sp.pediatricUse) && (
                                <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Pediatric Use: </span>{sp.pediatric || sp.pediatricUse}</p>
                              )}
                              {(sp.geriatric || sp.elderly) && (
                                <p className="m-0 leading-relaxed"><span className="font-bold text-slate-900">Geriatric Use: </span>{sp.geriatric || sp.elderly}</p>
                              )}
                            </div>
                          );
                        })()}
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
                      {(() => {
                        const mfg = productDetailsData.manufacturingInfo || {};
                        return (
                          <div className="pl-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-700 pt-1">
                            <div>
                              <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Manufacturer</span>
                              <span className="font-medium text-slate-900">{mfg.manufacturer || 'Not specified'}</span>
                            </div>
                            <div>
                              <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Origin</span>
                              <span className="font-medium text-slate-900">{mfg.origin || 'Vietnam'}</span>
                            </div>
                            {mfg.storage && (
                              <div className="sm:col-span-2">
                                <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Storage Conditions</span>
                                <span className="text-slate-800">{mfg.storage}</span>
                              </div>
                            )}
                            {mfg.packaging && (
                              <div className="sm:col-span-2">
                                <span className="text-xs text-slate-900 font-bold uppercase tracking-wider block mb-0.5">Packaging Format</span>
                                <span className="text-slate-800">{mfg.packaging}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="pt-3 flex items-center justify-between text-xs text-slate-400">
                      <span>Pharmaceutical Clinical Profile (Synchronized)</span>
                      <button
                        type="button"
                        onClick={() => setEditDetailsMode(true)}
                        className="text-slate-600 hover:text-slate-900 font-medium hover:underline cursor-pointer border-none bg-transparent text-xs"
                      >
                        Click to Edit Full Specifications →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-slate-400 mb-4">
                      Fill relevant sections — empty fields will be omitted automatically.
                    </p>
                    <Tabs
                      size="small"
                      items={[
                        {
                          key: 'composition',
                          label: 'Composition & Active',
                          children: (
                            <div className="space-y-4 pt-1">
                              <Form.Item
                                label="Detailed Active Ingredients"
                                name={['details', 'detailedIngredients', 'activeIngredients']}
                              >
                                <Input placeholder="e.g. Paracetamol 500mg, Caffeine 65mg" />
                              </Form.Item>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'composition']}
                                sectionLabel="Composition & Active"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'indications',
                          label: 'Indications & Uses',
                          children: (
                            <div className="space-y-4 pt-1">
                              <Form.Item
                                label="Approved Indications (one item per line)"
                                name={['details', 'indications']}
                              >
                                <TextArea
                                  rows={4}
                                  placeholder={`Relieves mild to moderate pain\nReduces fever and flu symptoms`}
                                />
                              </Form.Item>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'indications']}
                                sectionLabel="Indications & Uses"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'safety',
                          label: 'Precautions & Safety',
                          children: (
                            <div className="space-y-4 pt-1">
                              <Form.Item
                                label="Contraindications (one item per line)"
                                name={['details', 'contraindications']}
                              >
                                <TextArea
                                  rows={3}
                                  placeholder="e.g. Hypersensitivity to active ingredients, severe hepatic impairment"
                                />
                              </Form.Item>
                              <Form.Item
                                label="Warnings & Precautions (one item per line)"
                                name={['details', 'warningsAndPrecautions']}
                              >
                                <TextArea
                                  rows={3}
                                  placeholder="e.g. Do not exceed recommended dosage; monitor kidney function"
                                />
                              </Form.Item>
                              <Form.Item
                                label="Side Effects (one item per line)"
                                name={['details', 'sideEffects']}
                              >
                                <TextArea
                                  rows={3}
                                  placeholder="e.g. Nausea, rash, dizziness"
                                />
                              </Form.Item>
                              <Form.Item
                                label="Adverse Event Management"
                                name={['details', 'adverseReactionManagement']}
                              >
                                <TextArea
                                  rows={3}
                                  placeholder="Recommended actions upon experiencing adverse reactions..."
                                />
                              </Form.Item>
                              <Form.Item
                                label="Driving & Machinery Precautions"
                                name={['details', 'effectsOnDriving']}
                              >
                                <Input placeholder="e.g. May cause drowsiness — exercise caution when driving" />
                              </Form.Item>
                              <div className="grid sm:grid-cols-2 gap-4">
                                <Form.Item
                                  label="Pregnancy Risk"
                                  name={['details', 'specialPatientGroups', 'pregnancy']}
                                >
                                  <Input placeholder="e.g. Consult doctor or pharmacist before use" />
                                </Form.Item>
                                <Form.Item
                                  label="Lactation / Breastfeeding"
                                  name={['details', 'specialPatientGroups', 'lactation']}
                                >
                                  <Input placeholder="e.g. Consult doctor or pharmacist before use" />
                                </Form.Item>
                                <Form.Item
                                  label="Pediatric Use (Children)"
                                  name={['details', 'specialPatientGroups', 'pediatric']}
                                >
                                  <Input placeholder="e.g. Contraindicated in children under 10 years of age" />
                                </Form.Item>
                                <Form.Item
                                  label="Geriatric Use (Elderly)"
                                  name={['details', 'specialPatientGroups', 'geriatric']}
                                >
                                  <Input placeholder="e.g. Dose adjustment may be required in elderly patients" />
                                </Form.Item>
                              </div>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'safety']}
                                sectionLabel="Precautions & Safety"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'usage',
                          label: 'Dosage & Administration',
                          children: (
                            <div className="space-y-4 pt-1">
                              <div className="grid sm:grid-cols-2 gap-4">
                                <Form.Item
                                  label="Administration Method"
                                  name={['details', 'usageInstructions', 'administration']}
                                  className="sm:col-span-2"
                                >
                                  <TextArea
                                    rows={3}
                                    placeholder="e.g. Oral administration after meals, 1-2 times daily"
                                  />
                                </Form.Item>
                                <Form.Item
                                  label="Dosage"
                                  name={['details', 'usageInstructions', 'dosage']}
                                >
                                  <TextArea
                                    rows={3}
                                    placeholder="e.g. Start with lowest effective dose, adjust per clinical response"
                                  />
                                </Form.Item>
                                <Form.Item
                                  label="Missed Dose"
                                  name={['details', 'usageInstructions', 'missedDose']}
                                >
                                  <TextArea
                                    rows={3}
                                    placeholder="e.g. Take with next scheduled meal, do not double dose"
                                  />
                                </Form.Item>
                                <Form.Item
                                  label="Overdose Management"
                                  name={['details', 'usageInstructions', 'overdoseManagement']}
                                  className="sm:col-span-2"
                                >
                                  <TextArea
                                    rows={3}
                                    placeholder="e.g. Seek emergency medical attention immediately"
                                  />
                                </Form.Item>
                              </div>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'usage']}
                                sectionLabel="Dosage & Administration"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'pharmacology',
                          label: 'Pharmacology',
                          children: (
                            <div className="space-y-4 pt-1">
                              <Form.Item
                                label="Pharmacological Class"
                                name={['details', 'pharmacodynamics', 'pharmacologicalClass']}
                              >
                                <Input placeholder="e.g. Sulfonylurea, Biguanide" />
                              </Form.Item>
                              <Form.Item
                                label="Mechanism of Action"
                                name={['details', 'pharmacodynamics', 'mechanismOfAction']}
                              >
                                <TextArea
                                  rows={3}
                                  placeholder="Description of pharmacological mechanism of action..."
                                />
                              </Form.Item>
                              <Divider plain>Pharmacokinetics</Divider>
                              <Form.Item
                                label="Absorption"
                                name={['details', 'pharmacokinetics', 'absorption']}
                              >
                                <TextArea
                                  rows={2}
                                  placeholder="Bioavailability and absorption kinetics..."
                                />
                              </Form.Item>
                              <Form.Item
                                label="Metabolism"
                                name={['details', 'pharmacokinetics', 'metabolism']}
                              >
                                <TextArea
                                  rows={2}
                                  placeholder="Hepatic / systemic metabolic pathway..."
                                />
                              </Form.Item>
                              <Form.Item
                                label="Elimination"
                                name={['details', 'pharmacokinetics', 'elimination']}
                              >
                                <TextArea
                                  rows={2}
                                  placeholder="Renal / biliary excretion pathway and half-life..."
                                />
                              </Form.Item>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'pharmacology']}
                                sectionLabel="Pharmacology"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'interactions',
                          label: 'Drug Interactions',
                          children: (
                            <div className="space-y-4 pt-1">
                              <Form.Item label="Drug Interactions">
                                <Form.List name={['details', 'drugInteractions']}>
                                  {(fields, { add, remove }) => (
                                    <>
                                      {fields.map(({ key, name }) => (
                                        <Card
                                          key={key}
                                          size="small"
                                          className="mb-3"
                                          extra={
                                            <AButton
                                              type="text"
                                              danger
                                              icon={<DeleteOutlined />}
                                              onClick={() => remove(name)}
                                            />
                                          }
                                        >
                                          <Form.Item label="Interacting Drug" name={[name, 'drug']}>
                                            <Input placeholder="e.g. Furosemide" />
                                          </Form.Item>
                                          <Form.Item
                                            label="Interaction Effect"
                                            name={[name, 'effect']}
                                            className="mb-0"
                                          >
                                            <TextArea
                                              rows={2}
                                              placeholder="Clinical impact and consequences of combination..."
                                            />
                                          </Form.Item>
                                        </Card>
                                      ))}
                                      <AButton
                                        type="dashed"
                                        onClick={() => add()}
                                        icon={<PlusOutlined />}
                                        block
                                      >
                                        Add Drug Interaction
                                      </AButton>
                                    </>
                                  )}
                                </Form.List>
                              </Form.Item>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'interactions']}
                                sectionLabel="Drug Interactions"
                              />
                            </div>
                          ),
                        },
                        {
                          key: 'manufacturing',
                          label: 'Manufacturing & Origin',
                          children: (
                            <div className="space-y-4 pt-1">
                              <div className="grid sm:grid-cols-2 gap-4">
                                <Form.Item
                                  label="Brand Name"
                                  name={['details', 'manufacturingInfo', 'brand']}
                                >
                                  <Input placeholder="e.g. Hasan - Demarpharm" />
                                </Form.Item>
                                <Form.Item
                                  label="Country of Origin"
                                  name={['details', 'manufacturingInfo', 'origin']}
                                >
                                  <Input placeholder="e.g. Vietnam" />
                                </Form.Item>
                                <Form.Item
                                  label="Packaging Specification"
                                  name={['details', 'manufacturingInfo', 'packaging']}
                                >
                                  <Input placeholder="e.g. Box of 3 blisters x 10 tablets" />
                                </Form.Item>
                                <Form.Item
                                  label="Storage Conditions"
                                  name={['details', 'manufacturingInfo', 'storage']}
                                  className="sm:col-span-2"
                                >
                                  <Input placeholder="e.g. Store below 30°C in a dry place, protect from light" />
                                </Form.Item>
                              </div>
                              <SectionCustomFields
                                name={['details', 'extra_fields', 'manufacturing']}
                                sectionLabel="Manufacturing & Origin"
                              />
                            </div>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </Card>

              {/* Packaging Variants & Pricing */}
              <Card title="Packaging Variants & Pricing" className="shadow-xs border-slate-200 rounded-[6px]">
                <Form.List name="packagingVariants">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...restField }) => (
                        <Card
                          key={key}
                          size="small"
                          className="mb-3 bg-slate-50 border-slate-200 rounded-[6px]"
                          extra={
                            <AButton
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => remove(name)}
                            />
                          }
                        >
                          <div className="grid sm:grid-cols-3 gap-3">
                            <Form.Item
                              {...restField}
                              label="Unit Name"
                              name={[name, 'unitName']}
                              rules={[{ required: true, message: 'Unit name is required' }]}
                            >
                              <Input placeholder="e.g. Box, Blister, Tablet" />
                            </Form.Item>

                            <Form.Item
                              {...restField}
                              label="Sale Price (₫)"
                              name={[name, 'price']}
                              rules={[{ required: true, message: 'Price is required' }]}
                            >
                              <InputNumber
                                min={0}
                                style={{ width: '100%' }}
                                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                parser={(v) => (v ? (v.replace(/\$\s?|(,*)/g, '') as any) : '')}
                                onChange={(val) => handlePriceChange(name, val)}
                              />
                            </Form.Item>

                            <Form.Item
                              {...restField}
                              label="Original Price (₫)"
                              name={[name, 'originalPrice']}
                            >
                              <InputNumber
                                min={0}
                                style={{ width: '100%' }}
                                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                parser={(v) => (v ? (v.replace(/\$\s?|(,*)/g, '') as any) : '')}
                                placeholder="Original MSRP"
                                onChange={(val) => handleOriginalPriceChange(name, val)}
                              />
                            </Form.Item>

                            <Form.Item
                              {...restField}
                              label="Discount %"
                              name={[name, 'discountPercent']}
                            >
                              <InputNumber
                                min={0}
                                max={100}
                                suffix="%"
                                style={{ width: '100%' }}
                                placeholder="0"
                                onChange={(val) => handleDiscountPercentChange(name, val)}
                              />
                            </Form.Item>

                            <Form.Item
                              {...restField}
                              label="Sale Start Date"
                              name={[name, 'saleStartDate']}
                            >
                              <DatePicker showTime style={{ width: '100%' }} placeholder="Sale start" />
                            </Form.Item>

                            <Form.Item
                              {...restField}
                              label="Sale End Date"
                              name={[name, 'saleEndDate']}
                            >
                              <DatePicker showTime style={{ width: '100%' }} placeholder="Sale end" />
                            </Form.Item>
                          </div>

                          <Form.Item
                            {...restField}
                            name={[name, 'isBaseUnit']}
                            valuePropName="checked"
                            label="Base Unit"
                            className="mb-0"
                          >
                            <Switch
                              size="small"
                              onChange={(checked) => handleBaseUnitToggle(name, checked)}
                            />
                          </Form.Item>
                        </Card>
                      ))}

                      <Form.Item className="mb-0">
                        <AButton
                          type="dashed"
                          onClick={() => {
                            const currentList = form.getFieldValue('packagingVariants') || [];
                            add({
                              unitName: '',
                              price: undefined,
                              originalPrice: undefined,
                              discountPercent: 0,
                              isBaseUnit: currentList.length === 0,
                            });
                          }}
                          block
                          icon={<PlusOutlined />}
                          className="rounded-[6px]"
                        >
                          Add Packaging Variant
                        </AButton>
                      </Form.Item>
                    </>
                  )}
                </Form.List>
              </Card>
            </div>

            {/* Right column (1 col) */}
            <div className="space-y-6">
              <Card title="Product Image" className="shadow-xs border-slate-200 rounded-[6px]">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-full aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-[6px] overflow-hidden flex items-center justify-center p-2">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt="Preview"
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      <div className="text-center p-4">
                        <UploadOutlined className="text-3xl text-slate-300 mb-2" />
                        <p className="text-xs text-slate-400">No image uploaded</p>
                      </div>
                    )}
                  </div>

                  <Form.Item name="imageUrl" className="w-full mb-0">
                    <Input
                      placeholder="Paste image URL here"
                      onChange={(e) => setImageUrl(e.target.value)}
                    />
                  </Form.Item>

                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={handleUpload}
                  >
                    <AButton loading={uploading} icon={<UploadOutlined />} className="rounded-[6px]">
                      {uploading ? 'Uploading...' : 'Change Image'}
                    </AButton>
                  </Upload>
                </div>
              </Card>

              <Card title="Settings" className="shadow-xs border-slate-200 rounded-[6px]">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Active Status</span>
                    <Form.Item name="isActive" valuePropName="checked" noStyle>
                      <Switch defaultChecked />
                    </Form.Item>
                  </div>
                  <Divider className="my-2" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Prescription Required (Rx)</span>
                    <Form.Item name="isPrescription" valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <AButton
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<SaveOutlined />}
              size="large"
              className="px-10 bg-[#004996] rounded-[6px] !shadow-none"
            >
              {isEdit ? 'Update Product' : 'Create Product'}
            </AButton>
            <AButton size="large" onClick={() => router.push('/admin/products')} className="rounded-[6px]">
              Cancel
            </AButton>
          </div>
        </Form>
      </Spin>
    </div>
  );
}
