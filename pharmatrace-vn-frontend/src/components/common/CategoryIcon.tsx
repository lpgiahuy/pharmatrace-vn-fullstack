'use client';

import React from 'react';
import {
  MedicineBoxOutlined,
  HeartOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  ExperimentOutlined,
  SmileOutlined,
  FireOutlined,
  AppstoreOutlined,
  CustomerServiceOutlined,
  SkinOutlined,
  ThunderboltOutlined,
  AlertOutlined,
} from '@ant-design/icons';

export const PRESET_CATEGORY_ICONS = [
  { value: 'pill', label: 'Pill / Medicine Box', icon: <MedicineBoxOutlined /> },
  { value: 'heart', label: 'Cardiology / Heart', icon: <HeartOutlined /> },
  { value: 'eye', label: 'Eye & ENT Care', icon: <EyeOutlined /> },
  { value: 'shield', label: 'Vitamins & Supplements', icon: <SafetyCertificateOutlined /> },
  { value: 'experiment', label: 'Digestive & Lab', icon: <ExperimentOutlined /> },
  { value: 'smile', label: 'Mom & Baby / Pediatrics', icon: <SmileOutlined /> },
  { value: 'skin', label: 'Dermatology & Skincare', icon: <SkinOutlined /> },
  { value: 'fire', label: 'Pain & Fever Relief', icon: <FireOutlined /> },
  { value: 'thunder', label: 'Antibiotics & Acute', icon: <ThunderboltOutlined /> },
  { value: 'medical', label: 'First Aid & Safety', icon: <AlertOutlined /> },
];

export const CategoryIcon: React.FC<{ icon?: string | null; className?: string; size?: number }> = ({
  icon,
  className = '',
  size = 16,
}) => {
  if (!icon) {
    return <AppstoreOutlined style={{ fontSize: size }} className={className} />;
  }

  const trimmed = icon.trim();

  // If it's a web URL or local uploaded file URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={trimmed}
        alt="Category icon"
        style={{ width: size, height: size }}
        className={`object-contain inline-block rounded-xs ${className}`}
      />
    );
  }

  // If it matches one of our preset icon keys
  const normalized = trimmed.toLowerCase();
  switch (normalized) {
    case 'pill':
    case 'medication':
    case 'medicine':
      return <MedicineBoxOutlined style={{ fontSize: size }} className={className} />;
    case 'heart':
    case 'cardiology':
      return <HeartOutlined style={{ fontSize: size }} className={className} />;
    case 'eye':
    case 'ent':
      return <EyeOutlined style={{ fontSize: size }} className={className} />;
    case 'shield':
    case 'supplement':
    case 'vitamin':
      return <SafetyCertificateOutlined style={{ fontSize: size }} className={className} />;
    case 'experiment':
    case 'digestive':
      return <ExperimentOutlined style={{ fontSize: size }} className={className} />;
    case 'smile':
    case 'baby':
    case 'pediatrics':
      return <SmileOutlined style={{ fontSize: size }} className={className} />;
    case 'skin':
    case 'dermatology':
      return <SkinOutlined style={{ fontSize: size }} className={className} />;
    case 'fire':
    case 'pain':
      return <FireOutlined style={{ fontSize: size }} className={className} />;
    case 'thunder':
    case 'antibiotic':
      return <ThunderboltOutlined style={{ fontSize: size }} className={className} />;
    case 'medical':
    case 'firstaid':
    case 'general':
      return <AlertOutlined style={{ fontSize: size }} className={className} />;
    default:
      return <AppstoreOutlined style={{ fontSize: size }} className={className} />;
  }
};
