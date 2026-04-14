
import React, { ButtonHTMLAttributes } from 'react';
import { Loader2, LucideIcon } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon: Icon,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  
  const baseStyles = "flex items-center justify-center gap-2 transition-all active:scale-[0.98] font-bold rounded-xl disabled:opacity-70 disabled:cursor-not-allowed";
  
  const variants = {
    // UPDATED: Strict Blue Standard
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20", 
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm",
    danger: "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20",
    ghost: "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
  };

  const sizes = {
    sm: "py-2 px-3 text-xs",
    md: "py-3 px-5 text-sm", // Updated to py-3 for standard feel
    lg: "py-4 px-6 text-base"
  };

  return (
    <button
      className={`
        ${baseStyles} 
        ${variants[variant]} 
        ${sizes[size]} 
        ${fullWidth ? 'w-full' : ''} 
        ${className}
      `}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin" size={size === 'lg' ? 20 : 18} />}
      {!isLoading && Icon && <Icon size={size === 'lg' ? 20 : 18} />}
      {children}
    </button>
  );
};

export default Button;
