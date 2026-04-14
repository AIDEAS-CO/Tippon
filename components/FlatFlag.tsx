import React from 'react';

// Color map for common Judo nations
const COUNTRY_COLORS: Record<string, string> = {
    'Japan': 'bg-red-600 text-white',
    'France': 'bg-blue-700 text-white',
    'Georgia': 'bg-red-500 text-white',
    'Brazil': 'bg-green-600 text-white',
    'Uzbekistan': 'bg-blue-400 text-white',
    'Italy': 'bg-green-700 text-white',
    'Korea': 'bg-slate-900 text-white',
    'Azerbaijan': 'bg-blue-500 text-white',
    'Canada': 'bg-red-500 text-white',
    'Mongolia': 'bg-blue-600 text-white',
    'Netherlands': 'bg-orange-500 text-white',
    'Germany': 'bg-yellow-500 text-black',
    'Spain': 'bg-yellow-400 text-red-600',
    'Cuba': 'bg-blue-800 text-white',
    'Kazakhstan': 'bg-cyan-400 text-yellow-100',
};

interface FlatFlagProps {
    country: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const FlatFlag: React.FC<FlatFlagProps> = ({ country, className = "", size = 'md' }) => {
    const code = country ? country.substring(0, 3).toUpperCase() : '???';
    const colorClass = COUNTRY_COLORS[country] || 'bg-slate-200 text-slate-500';
    
    const sizeClasses = {
        sm: 'w-6 h-4 text-[8px]',
        md: 'w-8 h-5 text-[9px]',
        lg: 'w-10 h-7 text-[10px]',
        xl: 'w-16 h-10 text-xs'
    };

    return (
        <div className={`rounded-[2px] shadow-sm flex items-center justify-center font-black tracking-tighter select-none ${sizeClasses[size]} ${colorClass} ${className}`}>
            {code}
        </div>
    );
};