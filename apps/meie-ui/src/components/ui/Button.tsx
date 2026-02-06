import React from 'react';
import { CircleNotch } from 'phosphor-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  className?: string;
  leftIcon?: React.ReactNode;
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  leftIcon,
  disabled,
  ...props
}) => {
  const baseStyles = "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg active:scale-[0.98]";
  
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-hover shadow-sm border border-transparent focus:ring-accent/50",
    secondary: "bg-white text-text-primary hover:bg-gray-50 border border-border-subtle shadow-sm focus:ring-gray-200",
    ghost: "bg-transparent text-text-primary hover:bg-black/5 focus:ring-black/10",
    outline: "bg-transparent border border-border-subtle text-text-primary hover:bg-black/5"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-[13px]",
    lg: "px-6 py-3 text-[15px]",
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <CircleNotch className="w-4 h-4 mr-2 animate-spin" weight="bold" />
      ) : leftIcon ? (
        <span className="mr-2">{leftIcon}</span>
      ) : null}
      {children}
    </button>
  );
};
