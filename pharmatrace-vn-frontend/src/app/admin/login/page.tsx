'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, LogIn, Store, ShieldCheck } from 'lucide-react';
import { App } from 'antd';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';

export default function AdminLoginPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const login = useAuthStore((state) => state.login);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      email: 'admin@pharmatrace.vn',
      password: '',
    },
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      try {
        const params = new URLSearchParams(window.location.search);
        const emailParam = params.get('email');
        if (emailParam) {
          setValue('email', emailParam);
        }
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
      }
    }
  }, [setValue]);

  const onSubmit = async (data: any) => {
    try {
      const credentials = {
        loginType: 'admin',
        email: data.email,
        password: data.password,
      };

      const result = await login(credentials);
      const userRole = result.user?.role;

      const allowedAdminRoles = [
        'SUPER_ADMIN',
        'ADMIN',
        'STORE_MANAGER',
        'PHARMACIST',
      ];

      if (!allowedAdminRoles.includes(userRole || '')) {
        await useAuthStore.getState().logout();
        message.error('Incorrect username or password!');
        return;
      }

      const userName = result?.user?.fullName || result?.user?.full_name || 'Manager';
      message.success(`Welcome ${userName}!`);
      router.push('/admin');
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || 'Incorrect username or password!');
    }
  };

  return (
    <AuthLayoutWrapper>
      <div className="animate-fade-in">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-[#1e4287] text-xs font-semibold mb-4">
            <ShieldCheck className="w-4 h-4 text-[#1e4287]" />
            <span>INTERNAL & STORE PORTAL</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Store className="w-7 h-7 text-[#1e4287] inline-block" />
            Welcome back, Admin!
          </h1>
          <p className="text-slate-500 text-sm">
            Restricted to Store Managers, Pharmacists, and PharmaTrace System Administrators.
          </p>
        </div>

        <form
          method="POST"
          action="#"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
        >
          <Input
            label="Internal Account Email"
            type="email"
            placeholder="admin@pharmatrace.vn"
            error={errors.email?.message as string}
            required
            {...register('email', { required: 'Please enter a valid email address' })}
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

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={isSubmitting}
            leftIcon={<LogIn className="w-4 h-4 mr-1" />}
            style={{ backgroundColor: '#1e4287' }}
            className="text-white font-semibold py-3 rounded-[6px] mt-2 cursor-pointer shadow-xs"
          >
            Sign In to Admin Portal
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-2 text-center text-xs text-slate-500">
          <p>
            Are you warehouse logistics staff?{' '}
            <Link href="/warehouse/login" style={{ color: '#1e4287' }} className="font-semibold hover:underline">
              Sign in to Warehouse WMS Portal &rarr;
            </Link>
          </p>
          <p>
            Are you a retail customer?{' '}
            <Link href="/login" style={{ color: '#1e4287' }} className="font-semibold hover:underline">
              Go to Customer Storefront Sign In &rarr;
            </Link>
          </p>
        </div>
      </div>
    </AuthLayoutWrapper>
  );
}
