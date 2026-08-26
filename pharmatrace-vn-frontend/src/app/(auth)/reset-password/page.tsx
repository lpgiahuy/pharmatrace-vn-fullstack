'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Form, Input, Button, message } from 'antd';
import { Lock } from 'lucide-react';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { authService } from '@/services/auth.service';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const token = searchParams.get('token');

  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);
      await authService.resetPassword({
        token: token || '',
        password: values.password,
      });
      message.success('Password reset successfully. Please sign in.');
      router.push('/login');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Reset link expired or invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">
          New password
        </h1>
        <p className="text-slate-500 text-sm">
          Choose a strong new password for your account.
        </p>
      </div>

      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large" className="space-y-4">
        <Form.Item
          name="password"
          label={<span className="text-sm font-medium text-slate-700">New Password</span>}
          rules={[{ required: true, min: 6, message: 'Password must be at least 6 characters' }]}
        >
          <Input.Password
            prefix={<Lock className="w-4 h-4 text-slate-400 mr-1" />}
            placeholder="••••••••"
            className="h-11 rounded-lg border-slate-200 focus:border-[#004996]"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label={<span className="text-sm font-medium text-slate-700">Confirm Password</span>}
          dependencies={['password']}
          rules={[
            { required: true, message: 'Please confirm your password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match!'));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<Lock className="w-4 h-4 text-slate-400 mr-1" />}
            placeholder="••••••••"
            className="h-11 rounded-lg border-slate-200 focus:border-[#004996]"
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loading}
          className="h-12 rounded-xl text-base font-bold bg-[#1e4287] hover:bg-[#16346e] border-none shadow-md shadow-blue-900/10"
        >
          Reset Password
        </Button>
      </Form>

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-[#1e4287] hover:underline">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayoutWrapper>
      <Suspense fallback={<div className="text-center py-8 text-slate-400">Loading...</div>}>
        <ResetPasswordContent />
      </Suspense>
    </AuthLayoutWrapper>
  );
}
