
import React from 'react';
import { ViewState, UserProfile } from '../types';
import { Trophy, Users } from 'lucide-react';

interface NavigationProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  userProfile: UserProfile | null;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onNavigate, userProfile }) => {
  const navItems = [
    { id: 'TOURNAMENTS', label: 'Tournaments', icon: Trophy },
    { id: 'LEADERBOARD', label: 'Rankings', icon: Users },
  ];

  // Logic for avatar: Priority to DB avatar, fallback to generated initials based on username or fullname
  const displayName = userProfile?.username || userProfile?.full_name || 'Guest';
  const avatarSrc = userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0D8ABC&color=fff`;

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-16">
          {/* Logo - Acts as Home Button */}
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onNavigate('HOME')}>
             <div className="size-8 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-lg shadow-sm">
               T
             </div>
             <span className="font-bold text-slate-900 text-lg tracking-tight">Tippon</span>
          </div>

          {/* Center Navigation */}
          <div className="flex gap-1">
            {navItems.map((item) => {
              const isActive = currentView === item.id || (item.id === 'TOURNAMENTS' && (currentView === 'BRACKET' || currentView === 'CREATE_TOURNAMENT'));
              const Icon = item.icon;
              
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as ViewState)}
                  className={`flex items-center gap-2 px-4 h-16 border-b-2 transition-all ${
                    isActive 
                      ? 'border-primary text-primary' 
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'stroke-[2.5px]' : 'stroke-2'} />
                  <span className={`text-sm font-medium hidden md:block ${isActive ? 'font-bold' : ''}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
          
          {/* Profile Avatar - Acts as Profile Button */}
          <div className="flex items-center">
             <div 
                className={`size-8 rounded-full bg-slate-100 border-2 overflow-hidden cursor-pointer hover:border-primary transition-colors ${currentView === 'PROFILE' ? 'border-primary' : 'border-slate-200'}`} 
                onClick={() => onNavigate('PROFILE')}
             >
                <img 
                    key={avatarSrc} 
                    src={avatarSrc} 
                    alt="Profile" 
                    className="w-full h-full object-cover"
                />
             </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
