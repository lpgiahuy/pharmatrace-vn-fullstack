'use client';

import React, { forwardRef, useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      className = '',
      wrapperClassName = '',
      id,
      required,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            required={required}
            className={`w-full px-3.5 py-2.5 rounded-lg border text-sm placeholder:text-slate-400 transition-all duration-150 text-slate-800 ${
              error
                ? 'border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200 focus:border-red-400 focus:outline-none'
                : 'border-slate-200 bg-white hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#004996]/20 focus:border-[#004996]'
            } ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''} ${className}`}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 flex items-center">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-red-500 font-medium mt-0.5">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
