'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, LogIn, Warehouse, PackageCheck } from 'lucide-react';
import { App } from 'antd';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/useAuthStore';

export default function WarehouseLoginPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const login = useAuthStore((state) => state.login);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      email: 'warehouse@pharmatrace.vn',
      password: 'password123',
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const credentials = {
        loginType: 'warehouse',
        email: data.email,
        password: data.password,
      };

      const result = await login(credentials);
      const userRole = result.user?.role;

      const allowedWarehouseRoles = [
        'QuanLyKho',
        'NhanVienKho',
        'WAREHOUSE_MANAGER',
        'WAREHOUSE_STAFF',
        'SuperAdmin',
        'superadmin',
        'SUPER_ADMIN',
      ];

      if (!allowedWarehouseRoles.some((r) => r.toLowerCase() === (userRole || '').toLowerCase())) {
        await useAuthStore.getState().logout();
        message.error('Incorrect username or password!');
        return;
      }

      const userName = result?.user?.fullName || result?.user?.full_name || 'Warehouse Staff';
      message.success(`Signed in successfully! Welcome ${userName}`);
      router.push('/warehouse');
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || 'Incorrect username or password!');
    }
  };

  return (
    <AuthLayoutWrapper>
      <div className="animate-fade-in">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-bold mb-4" style={{ color: '#1e4287', backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }}>
            <PackageCheck className="w-4 h-4" style={{ color: '#1e4287' }} />
            <span>PHARMATRACE WMS PORTAL</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Warehouse className="w-7 h-7 inline-block" style={{ color: '#1e4287' }} />
            Warehouse WMS Sign In
          </h1>
          <p className="text-slate-500 text-sm">
            Warehouse operations, inventory audits, serialization QR tagging & logistics fulfillment.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Warehouse Account Email"
            type="email"
            placeholder="warehouse@pharmatrace.vn"
            error={errors.email?.message as string}
            required
            {...register('email', { required: 'Please enter a valid warehouse email' })}
          />

          <Input
            label="Password"
            type={showPw ? 'text' : 'password'}
            placeholder="••••••••"
            error={errors.password?.message as string}
            required
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="cursor-pointer focus:outline-none"
              >
                {showPw ? (
                  <EyeOff className="w-4 h-4 text-slate-400" />
                ) : (
                  <Eye className="w-4 h-4 text-slate-400" />
                )}
              </button>
            }
            {...register('password', { required: 'Password must be at least 6 characters' })}
          />

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              style={{ color: '#1e4287' }}
              className="text-xs sm:text-sm hover:underline font-medium"
            >
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{ backgroundColor: '#1e4287' }}
            className="w-full py-3 px-4 text-white font-bold text-base rounded-xl transition-all shadow-md hover:opacity-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
          >
            <LogIn className="w-5 h-5" />
            <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Warehouse WMS'}</span>
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-2 text-center text-xs text-slate-500">
          <p>
            Are you a Store Manager / Administrator?{' '}
            <Link href="/admin/login" style={{ color: '#1e4287' }} className="font-semibold hover:underline">
              Sign in to Store & Admin Portal ➔
            </Link>
          </p>
          <p>
            Are you a retail customer?{' '}
            <Link href="/login" style={{ color: '#1e4287' }} className="font-semibold hover:underline">
              Go to Customer Storefront Sign In ➔
            </Link>
          </p>
        </div>
      </div>
    </AuthLayoutWrapper>
  );
}
