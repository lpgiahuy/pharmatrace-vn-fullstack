'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { App } from 'antd';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { authService } from '@/services/auth.service';

export default function RegisterPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm({
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      address: '',
      password: '',
      confirmPassword: '',
    },
  });

  const passwordValue = watch('password');

  const onSubmit = async (data: any) => {
    try {
      await authService.register({
        name: data.name.trim(),
        phone: data.phone.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
        address: data.address?.trim() || undefined,
      });

      message.success('Account created! Please sign in.');
      router.push('/login');
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || 'Registration failed');
    }
  };

  return (
    <AuthLayoutWrapper>
      <div className="animate-fade-in">
        <div className="mb-6">
          <h1 className="text-3xl font-display font-bold text-slate-900 mb-1">
            Create New Account
          </h1>
          <p className="text-slate-500 text-sm">
            Join PharmaTrace VN for better health management
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
            label="Full Name"
            type="text"
            placeholder="Nguyen Van A"
            error={errors.name?.message as string}
            required
            {...register('name', { required: 'Full Name is required' })}
          />

          <Input
            label="Mobile Number"
            type="tel"
            placeholder="0909 123 456"
            error={errors.phone?.message as string}
            required
            {...register('phone', {
              required: 'Mobile Number is required',
              minLength: { value: 9, message: 'Please enter a valid phone number' },
            })}
          />

          <Input
            label="Email Address"
            type="email"
            placeholder="customer@pharmatrace.vn"
            error={errors.email?.message as string}
            required
            {...register('email', {
              required: 'Email address is required',
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: 'Please enter a valid email address',
              },
            })}
          />

          <Input
            label="Primary Address"
            type="text"
            placeholder="123 Nguyen Hue, Q1"
            error={errors.address?.message as string}
            {...register('address')}
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
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 6, message: 'Password must be at least 6 characters' },
            })}
          />

          <Input
            label="Confirm Password"
            type={showPw ? 'text' : 'password'}
            placeholder="••••••••"
            error={errors.confirmPassword?.message as string}
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
            {...register('confirmPassword', {
              required: 'Please confirm your password',
              validate: (val) => val === passwordValue || 'Passwords do not match',
            })}
          />

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={isSubmitting}
            leftIcon={<UserPlus className="w-4 h-4 mr-1" />}
            className="bg-[#1e4287] hover:bg-[#16346e] text-white font-semibold py-3 rounded-lg mt-2 cursor-pointer shadow-sm"
          >
            Create Account
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-[#1e4287] hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </AuthLayoutWrapper>
  );
}
