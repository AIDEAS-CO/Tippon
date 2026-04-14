
import React from 'react';

// Mapping IOC codes (Judo standard) to ISO 3166-1 alpha-2 codes (Flag API standard)
const iocToIso: Record<string, string> = {
    'FRA': 'fr', 'JPN': 'jp', 'KAZ': 'kz', 'GEO': 'ge', 'BRA': 'br', 
    'UZB': 'uz', 'MGL': 'mn', 'KOR': 'kr', 'AZE': 'az', 'ISR': 'il', 
    'ITA': 'it', 'ESP': 'es', 'CAN': 'ca', 'CUB': 'cu', 'GER': 'de', 
    'NED': 'nl', 'BEL': 'be', 'TUR': 'tr', 'UKR': 'ua', 'GBR': 'gb', 
    'USA': 'us', 'POR': 'pt', 'HUN': 'hu', 'SRB': 'rs', 'KOS': 'xk', 
    'TJK': 'tj', 'CZE': 'cz', 'POL': 'pl', 'ROU': 'ro', 'AUT': 'at',
    'SUI': 'ch', 'CHN': 'cn', 'TPE': 'tw', 'KGZ': 'kg', 'TKM': 'tm',
    'CRO': 'hr', 'MDA': 'md', 'AUS': 'au', 'UAE': 'ae', 'SWE': 'se',
    'AIN': 'ru', 'RUS': 'ru', 'IJF': 'xx'
};

interface FlagProps {
  countryCode?: string;
  className?: string;
}

const Flag: React.FC<FlagProps> = ({ countryCode, className = "" }) => {
  if (!countryCode) return null;
  
  // 1. Clean input
  const code = countryCode.trim().toUpperCase();
  
  // 2. Try mapping IOC to ISO, fallback to input (if already ISO)
  // The API requires 2-letter ISO codes.
  const isoCode = iocToIso[code] ? iocToIso[code].toUpperCase() : code.substring(0, 2).toUpperCase();

  // 3. Construct URL
  const flagUrl = `https://purecatamphetamine.github.io/country-flag-icons/3x2/${isoCode}.svg`;

  return (
    <img 
      src={flagUrl}
      alt={countryCode}
      title={countryCode}
      className={`w-6 h-4 object-cover rounded-sm shadow-sm border border-slate-200/60 inline-block ${className}`}
      onError={(e) => (e.currentTarget.style.display = 'none')}
    />
  );
};

export default Flag;
