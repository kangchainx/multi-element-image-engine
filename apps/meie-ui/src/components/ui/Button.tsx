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
  const baseStyles = "inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg active:scale-95";
  
  const variants = {
    primary: "bg-terracotta text-white hover:bg-[#c4694d] shadow-sm hover:shadow-md border border-transparent focus:ring-terracotta/50",
    secondary: "bg-charcoal text-white hover:bg-black shadow-sm focus:ring-charcoal/50",
    ghost: "bg-transparent text-charcoal hover:bg-black/5 focus:ring-charcoal/20",
    outline: "bg-transparent border border-charcoal/20 text-charcoal hover:bg-black/5 hover:border-charcoal/40"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
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
