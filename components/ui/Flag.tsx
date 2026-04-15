
import React from 'react';
import { resolveFlagIso } from '../../lib/iocCountryFlags';

interface FlagProps {
  countryCode?: string;
  className?: string;
}

const Flag: React.FC<FlagProps> = ({ countryCode, className = "" }) => {
  if (!countryCode) return null;

  const code = countryCode.trim().toUpperCase();
  const iso = resolveFlagIso(code);

  if (!iso) {
    return (
      <span
        title={`${code} (flag mapping not found)`}
        className={`inline-flex items-center justify-center min-w-[1.5rem] h-4 px-0.5 rounded-sm bg-slate-200 text-slate-600 text-[8px] font-bold border border-slate-300/60 ${className}`}
      >
        {code.slice(0, 3)}
      </span>
    );
  }

  const flagUrl = `https://purecatamphetamine.github.io/country-flag-icons/3x2/${iso.toUpperCase()}.svg`;

  return (
    <img 
      src={flagUrl}
      alt={countryCode}
      title={countryCode}
      className={`w-6 h-4 object-cover rounded-sm shadow-sm border border-slate-200/60 inline-block ${className}`}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
};

export default Flag;
