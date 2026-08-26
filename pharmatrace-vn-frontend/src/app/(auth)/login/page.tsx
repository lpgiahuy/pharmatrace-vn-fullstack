'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { App } from 'antd';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';

export default function CustomerLoginPage() {
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
      identifier: 'customer@pharmatrace.vn',
      password: '0123456789',
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const credentials = {
        loginType: 'customer',
        identifier: data.identifier,
        password: data.password,
      };

      const result = await login(credentials);
      const userRole = result.user?.role;

      const internalRoles = [
        'QuanLyKho',
        'NhanVienKho',
        'WAREHOUSE_MANAGER',
        'WAREHOUSE_STAFF',
        'SuperAdmin',
        'superadmin',
        'SUPER_ADMIN',
        'Admin',
        'admin',
        'ADMIN',
        'NhanVienBanHang',
        'QuanLyCuaHang',
        'STORE_MANAGER',
        'SALES_STAFF',
      ];

      if (internalRoles.includes(userRole)) {
        await useAuthStore.getState().logout();
        message.error('Incorrect username or password!');
        return;
      }

      message.success(
        `Welcome back, ${(result.user?.fullName || result.user?.name || 'Customer').split(' ').pop()}!`
      );
      router.push('/');
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || 'Incorrect username or password!');
    }
  };

  return (
    <AuthLayoutWrapper>
      <div className="animate-fade-in">
        <div className="mb-6">
          <h1 className="text-3xl font-display font-bold text-slate-900">
            Welcome back
          </h1>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Mobile Number or Email"
            type="text"
            placeholder="0909 123 456 or name@example.com"
            error={errors.identifier?.message as string}
            required
            {...register('identifier', { required: 'Please enter Email or Phone number' })}
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
            {...register('password', { required: 'Please enter password' })}
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

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={isSubmitting}
            leftIcon={<LogIn className="w-4 h-4 mr-1" />}
            style={{ backgroundColor: '#1e4287' }}
            className="text-white font-semibold py-3 rounded-lg mt-2 cursor-pointer shadow-sm"
          >
            Sign In
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <Link href="/register" style={{ color: '#1e4287' }} className="font-semibold hover:underline">
            Sign up now
          </Link>
        </p>
      </div>
    </AuthLayoutWrapper>
  );
}
