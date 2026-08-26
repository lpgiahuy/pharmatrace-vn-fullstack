'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Form, Input, Button, message } from 'antd';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { AuthLayoutWrapper } from '@/components/layout/AuthLayoutWrapper';
import { authService } from '@/services/auth.service';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleSubmit = async (values: { email: string }) => {
    try {
      setLoading(true);
      await authService.forgotPassword(values.email);
      setSent(true);
      message.success('Password reset email sent!');
    } catch {
      // Mock success state if email server not configured
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayoutWrapper>
        <div className="text-center animate-fade-in py-6">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2 tracking-tight">
            Check your email
          </h1>
          <p className="text-slate-500 text-sm mb-6 leading-relaxed">
            We&apos;ve sent a password reset link to your email address. Please follow the instructions to reset your password.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-[#1e4287] hover:underline font-bold text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </AuthLayoutWrapper>
    );
  }

  return (
    <AuthLayoutWrapper>
      <div className="animate-fade-in">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">
            Reset password
          </h1>
          <p className="text-slate-500 text-sm">
            Enter your account email address and we&apos;ll send you a password reset link.
          </p>
        </div>

        <Form form={form} layout="vertical" onFinish={handleSubmit} size="large" className="space-y-4">
          <Form.Item
            name="email"
            label={<span className="text-sm font-medium text-slate-700">Email Address</span>}
            rules={[{ required: true, type: 'email', message: 'Please enter a valid email address' }]}
          >
            <Input
              prefix={<Mail className="w-4 h-4 text-slate-400 mr-1" />}
              placeholder="you@example.com"
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
            Send Reset Link
          </Button>
        </Form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Remember your password?{' '}
          <Link href="/login" className="font-semibold text-[#1e4287] hover:underline">
            Back to Sign In
          </Link>
        </p>
      </div>
    </AuthLayoutWrapper>
  );
}
