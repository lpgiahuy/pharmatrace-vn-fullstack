'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Spin, Tag, App, Divider } from 'antd';
import {
  ChevronRight,
  User,
  Shield,
  KeyRound,
  MapPin,
  Building,
  Phone,
  Mail,
  Award,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { authService } from '@/services/auth.service';
import { useAuthStore } from '@/store/useAuthStore';
import { formatRole, formatDate } from '@/utils';

interface Facility {
  id?: number;
  name?: string;
  type?: string;
  address?: string;
}

interface Profile {
  id?: number;
  fullName?: string;
  email?: string;
  phone?: string;
  defaultAddress?: string;
  role?: string;
  jobTitle?: string;
  status?: string;
  membershipTier?: string;
  rewardPoints?: number;
  facilityId?: number;
  facility?: Facility | null;
  createdAt?: string;
}

const AVATAR_COLORS = [
  '#004996',
  '#1e4287',
  '#00897b',
  '#5c6bc0',
  '#8e24aa',
  '#e52592',
  '#d97706',
  '#0284c7',
];

function getAvatarColor(str?: string): string {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ProfilePage({ portal }: { portal: 'customer' | 'admin' }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const updateUser = useAuthStore((state) => state.updateUser);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState('');

  const primaryColor = portal === 'customer' ? '#004996' : '#1e4287';

  useEffect(() => {
    let active = true;
    authService
      .getProfile()
      .then((data: Profile) => {
        if (!active) return;
        setProfile(data);
      })
      .catch((err: any) => {
        if (!active) return;
        if (err?.statusCode === 401 || err?.response?.status === 401) {
          router.replace(portal === 'admin' ? '/admin/login' : '/login');
        } else {
          setError(err?.response?.data?.message || err?.message || 'Unable to load your profile.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [portal, router]);

  useEffect(() => {
    if (!loading && profile) {
      form.setFieldsValue({
        fullName: profile.fullName || '',
        email: profile.email || '',
        defaultAddress: profile.defaultAddress || '',
      });
    }
  }, [loading, profile, form]);

  const saveProfile = async (values: { fullName: string; email?: string; defaultAddress?: string }) => {
    setSaving(true);
    try {
      const payload: { fullName: string; email?: string; defaultAddress?: string } = {
        fullName: values.fullName.trim(),
        ...(values.email?.trim() ? { email: values.email.trim().toLowerCase() } : {}),
        ...(portal === 'customer' ? { defaultAddress: values.defaultAddress?.trim() || '' } : {}),
      };
      const data = await authService.updateProfile(payload);
      setProfile((prev) => ({ ...prev, ...data }));
      updateUser(data);
      message.success('Profile updated successfully');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Unable to update profile');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (values: { currentPassword: string; newPassword: string }) => {
    setSavingPassword(true);
    try {
      await authService.changePassword(values);
      passwordForm.resetFields();
      message.success('Password updated successfully');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Unable to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="w-full py-12">
        <Alert
          type="error"
          showIcon
          message="Profile Unavailable"
          description={error || 'Unable to load profile data.'}
        />
      </div>
    );
  }

  const displayName = profile.fullName || (portal === 'customer' ? 'Customer' : 'Staff');
  const avatarBg = getAvatarColor(displayName);
  const formattedRole = formatRole(profile.role || (portal === 'customer' ? 'CUSTOMER' : 'STAFF'));

  return (
    <div className={portal === 'customer' ? 'w-full pb-16 font-sans' : 'w-full space-y-6 font-sans animate-fade-in'}>
      {portal === 'customer' && (
        <nav aria-label="Breadcrumb" className="mb-4">
          <div className="flex items-center text-xs sm:text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-900 transition-colors font-medium">
              Home
            </Link>
            <ChevronRight className="w-3.5 h-3.5 mx-2 text-slate-400" />
            <span className="text-slate-900 font-semibold">My Profile</span>
          </div>
        </nav>
      )}

      <div className="mb-6 pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight m-0 flex items-center gap-2.5">
            {portal === 'customer' ? (
              <User className="w-6 h-6 shrink-0 stroke-[2]" />
            ) : (
              <Shield className="w-6 h-6 text-[#1e4287] shrink-0 stroke-[2]" />
            )}
            <span>{portal === 'customer' ? 'My Profile' : 'Admin Profile'}</span>
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm m-0 mt-1">
            {portal === 'customer'
              ? 'Manage your personal details, delivery addresses, and account security.'
              : 'Manage your internal credentials, identity details, and account security.'}
          </p>
        </div>
      </div>

      {/* Main Content Layout Grid: 2 cols on Left, 1 col on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* Left Column: Form Cards (spans 2 columns on lg) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card 1: Personal Information */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-bold text-slate-900">Personal Information</span>
              </div>
            }
            className="shadow-xs border border-slate-200/90 rounded-[6px]"
          >
            <Form
              form={form}
              key={profile?.id ? `profile-form-${profile.id}` : 'profile-form'}
              initialValues={{
                fullName: profile?.fullName || '',
                email: profile?.email || '',
                defaultAddress: profile?.defaultAddress || '',
              }}
              layout="vertical"
              onFinish={saveProfile}
              requiredMark={false}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Form.Item
                  name="fullName"
                  label={<span className="text-xs font-semibold text-slate-700">Full Name *</span>}
                  rules={[{ required: true, whitespace: true, message: 'Please enter your full name' }]}
                >
                  <Input placeholder="Your full name" className="rounded-[6px] h-10 text-sm" />
                </Form.Item>

                <Form.Item
                  name="email"
                  label={<span className="text-xs font-semibold text-slate-700">Email Address *</span>}
                  rules={[
                    { required: true, message: 'Please enter your email' },
                    { type: 'email', message: 'Enter a valid email address' },
                  ]}
                >
                  <Input placeholder="your.email@example.com" className="rounded-[6px] h-10 text-sm" />
                </Form.Item>
              </div>

              {portal === 'customer' && (
                <Form.Item
                  name="defaultAddress"
                  label={<span className="text-xs font-semibold text-slate-700">Default Delivery Address</span>}
                >
                  <Input.TextArea
                    rows={3}
                    placeholder="Enter your default shipping address (e.g. 123 Nguyen Hue, Ben Nghe, District 1, HCMC)"
                    className="rounded-[6px] text-sm"
                  />
                </Form.Item>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                  style={{ backgroundColor: primaryColor }}
                  className="px-6 h-10 font-semibold rounded-[6px] text-xs sm:text-sm shadow-xs"
                >
                  Save Changes
                </Button>
              </div>
            </Form>
          </Card>

          {/* Card 2: Change Password */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-bold text-slate-900">Change Password</span>
              </div>
            }
            className="shadow-xs border border-slate-200/90 rounded-[6px]"
          >
            <Form
              form={passwordForm}
              layout="vertical"
              onFinish={changePassword}
              requiredMark={false}
            >
              <Form.Item
                name="currentPassword"
                label={<span className="text-xs font-semibold text-slate-700">Current Password *</span>}
                rules={[{ required: true, message: 'Please enter current password' }]}
              >
                <Input.Password
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  className="rounded-[6px] h-10 text-sm"
                />
              </Form.Item>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Form.Item
                  name="newPassword"
                  label={<span className="text-xs font-semibold text-slate-700">New Password *</span>}
                  rules={[
                    { required: true, message: 'Please enter new password' },
                    { min: 6, message: 'Password must be at least 6 characters' },
                  ]}
                >
                  <Input.Password
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    className="rounded-[6px] h-10 text-sm"
                  />
                </Form.Item>

                <Form.Item
                  name="confirmPassword"
                  label={<span className="text-xs font-semibold text-slate-700">Confirm New Password *</span>}
                  dependencies={['newPassword']}
                  rules={[
                    { required: true, message: 'Please confirm your new password' },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue('newPassword') === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(new Error('Passwords do not match'));
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    className="rounded-[6px] h-10 text-sm"
                  />
                </Form.Item>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  htmlType="submit"
                  loading={savingPassword}
                  className="px-6 h-10 font-semibold rounded-[6px] text-xs sm:text-sm hover:border-slate-400"
                >
                  Update Password
                </Button>
              </div>
            </Form>
          </Card>
        </div>

        {/* Right Column: Account Overview & Details Card */}
        <div className="lg:col-span-1 space-y-6">
          <Card
            title={
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-bold text-slate-900">Account Overview</span>
              </div>
            }
            className="shadow-xs border border-slate-200/90 rounded-[6px]"
          >
            {/* User Profile Header Badge */}
            <div className="text-center pb-4">
              <div
                style={{ backgroundColor: avatarBg }}
                className="w-16 h-16 rounded-full text-white font-bold text-2xl flex items-center justify-center mx-auto shadow-sm select-none"
              >
                {(displayName.charAt(0) || 'U').toUpperCase()}
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-3 m-0">{displayName}</h2>
              <p className="text-xs text-slate-500 m-0 mt-0.5 truncate">{profile.email || 'N/A'}</p>
            </div>

            <Divider className="my-3 border-slate-100" />

            {/* Account Details List */}
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Account Status
                </span>
                <span className="font-semibold text-emerald-600">
                  {profile.status || 'Active'}
                </span>
              </div>

              {profile.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    Phone
                  </span>
                  <span className="font-semibold text-slate-800">{profile.phone}</span>
                </div>
              )}

              {profile.facility?.name && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <Building className="w-3.5 h-3.5 text-slate-400" />
                    Facility
                  </span>
                  <span className="font-semibold text-slate-800 text-right">{profile.facility.name}</span>
                </div>
              )}

              {profile.jobTitle && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Job Title</span>
                  <span className="font-semibold text-slate-800">{profile.jobTitle}</span>
                </div>
              )}

              {portal === 'customer' && profile.membershipTier && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-amber-500" />
                    Membership
                  </span>
                  <span className="font-bold text-amber-700 text-xs tracking-wide">
                    {profile.membershipTier}
                  </span>
                </div>
              )}

              {portal === 'customer' && profile.rewardPoints !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Reward Points</span>
                  <span className="font-bold text-[#004996] text-sm">
                    {profile.rewardPoints.toLocaleString()} pts
                  </span>
                </div>
              )}

              {profile.createdAt && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Member Since
                  </span>
                  <span className="font-medium text-slate-600">{formatDate(profile.createdAt)}</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
