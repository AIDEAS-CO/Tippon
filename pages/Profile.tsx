
import React, { useState, useEffect, useRef } from 'react';
import { ViewState, UserProfile } from '../types';
import { 
  User, Settings, LogOut, 
  ChevronLeft, Mail, Camera, CheckCircle, Loader2, AtSign, ChevronRight, Save
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';

interface ProfileProps {
  onNavigate: (view: ViewState) => void;
  userProfile: UserProfile | null;
  refreshProfile: () => Promise<void>;
}

type SubView = 'MAIN' | 'ACCOUNT';

const Profile: React.FC<ProfileProps> = ({ onNavigate, userProfile, refreshProfile }) => {
  const [currentSubView, setCurrentSubView] = useState<SubView>('MAIN');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  
  // Account Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState(""); 
  const [avatarUrl, setAvatarUrl] = useState("https://ui-avatars.com/api/?name=User&background=random");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI State
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);

  // Sync state with strict priority rules
  useEffect(() => {
    const syncData = async () => {
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
            const realName = user.user_metadata?.full_name || user.user_metadata?.name || 'Judoka';
            const realEmail = user.email || '';

            setFullName(realName);
            setEmail(realEmail);

            if (userProfile) {
                setUsername(userProfile.username || '');

                if (userProfile.avatar_url) {
                    setAvatarUrl(userProfile.avatar_url);
                } else {
                    setAvatarUrl(`https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0D8ABC&color=fff`);
                }
            }
        }
    };

    syncData();
  }, [userProfile]); 

  const handleLogout = async () => {
    try {
        await supabase.auth.signOut();
        setShowLogoutModal(false);
        onNavigate('LOGIN');
    } catch (error) {
        console.error("Error signing out:", error);
    }
  };

  const handleImageClick = () => {
      fileInputRef.current?.click();
  };

  // --- SUBIDA DE IMAGEN (AVATAR) ---
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0 || !userProfile) {
          return;
      }
      
      const file = e.target.files[0];
      const userId = userProfile.id;
      const timestamp = Date.now();
      const filePath = `public/${userId}_${timestamp}`;

      try {
          setIsUploading(true);
          
          const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, file, { upsert: true });

          if (uploadError) throw uploadError;

          const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
          
          if (data) {
              const newAvatarUrl = data.publicUrl;
              setAvatarUrl(newAvatarUrl);
              await supabase.from('profiles').update({ avatar_url: newAvatarUrl }).eq('id', userId);
              await refreshProfile(); 
          }

      } catch (error: any) {
          console.error("Upload error:", error);
          alert('Error uploading image: ' + error.message);
      } finally {
          setIsUploading(false);
      }
  };

  // --- DATA UPDATE (Username only) ---
  const handleSaveAccount = async () => {
      if (!userProfile) return;

      setIsSaving(true);
      try {
          const updates = {
              username, 
              avatar_url: avatarUrl,
          };

          const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userProfile.id);

          if (error) throw error;

          await refreshProfile();

          setShowSuccessAlert(true);
          
          setTimeout(() => {
              setShowSuccessAlert(false);
              setCurrentSubView('MAIN');
          }, 1500);

      } catch (error: any) {
          alert('Error updating profile: ' + error.message);
      } finally {
          setIsSaving(false);
      }
  };

  if (!userProfile) {
      return (
          <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-primary" size={40} />
          </div>
      );
  }

  // --- SUB-VIEWS ---

  const renderAccountDetails = () => (
    <div className="w-full relative">
      
      {showSuccessAlert && (
          <div className="absolute top-0 left-0 right-0 z-50 animate-in slide-in-from-top-5 duration-300">
              <div className="bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 border border-slate-700">
                  <div className="p-1 bg-white/10 rounded-full">
                      <CheckCircle size={16} className="text-green-400" />
                  </div>
                  <div>
                      <p className="font-bold text-sm">Success</p>
                      <p className="text-xs text-slate-300">Profile updated successfully. Redirecting...</p>
                  </div>
              </div>
          </div>
      )}

      <div className="flex items-center gap-2 mb-6 animate-fade-in-up">
        <button onClick={() => setCurrentSubView('MAIN')} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-2xl font-bold text-slate-900">Account Details</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-zen border border-slate-100 p-6 space-y-6 opacity-0 animate-fade-in-up stagger-1">
        
        {/* Profile Picture Upload */}
        <div className="flex flex-col items-center mb-6">
            <div className="relative group cursor-pointer" onClick={handleImageClick}>
                <div className="size-32 rounded-full bg-slate-100 p-1 border-2 border-slate-100 overflow-hidden transition-transform group-hover:scale-105 duration-500 relative">
                    <img src={avatarUrl} className="w-full h-full object-cover object-center" alt="Profile" />
                    {isUploading && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Loader2 className="text-white animate-spin" size={24} />
                        </div>
                    )}
                </div>
                <div className="absolute inset-0 bg-black/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white pointer-events-none">
                    <Camera size={24} />
                </div>
                <button className="absolute bottom-1 right-1 bg-primary text-white p-2 rounded-full shadow-md border-2 border-white hover:bg-blue-600 transition-colors">
                    <Settings size={14} />
                </button>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleImageChange}
                    disabled={isUploading}
                />
            </div>
            <p className="text-xs text-slate-400 mt-2 font-medium">Tap to change photo</p>
        </div>

        <div className="space-y-4">
            <div className="space-y-1 opacity-0 animate-fade-in-up stagger-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Full Name</label>
                <div className="flex items-center gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-200 text-slate-500 cursor-not-allowed">
                    <User size={18} className="text-slate-400" />
                    <span className="font-medium text-slate-600">{fullName}</span>
                </div>
            </div>

            <div className="space-y-1 opacity-0 animate-fade-in-up stagger-3">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Email Address</label>
                <div className="flex items-center gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-200 text-slate-500 cursor-not-allowed">
                    <Mail size={18} className="text-slate-400" />
                    <span className="font-medium text-slate-600">{email}</span>
                </div>
            </div>

            <div className="space-y-1 opacity-0 animate-fade-in-up stagger-4">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider ml-1">Username</label>
                <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-300 text-slate-900 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-sm">
                    <AtSign size={18} className="text-primary" />
                    <input 
                        type="text" 
                        value={username} 
                        onChange={(e) => setUsername(e.target.value)} 
                        className="bg-transparent border-none focus:outline-none w-full font-bold text-slate-900" 
                        placeholder="Your username" 
                    />
                </div>
            </div>
        </div>

        <Button 
            onClick={handleSaveAccount}
            isLoading={isSaving || isUploading}
            fullWidth
            variant="primary"
            className="mt-4"
            icon={Save}
        >
            Save Changes
        </Button>
      </div>
    </div>
  );

  // --- MAIN VIEW ---

  if (currentSubView === 'ACCOUNT') return <div className="max-w-2xl mx-auto p-4 md:p-8">{renderAccountDetails()}</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 relative">
      <h1 className="text-3xl font-bold text-slate-900 mb-6 animate-fade-in-up">Profile Settings</h1>
      
      {/* Profile Card */}
      <div className="bg-white rounded-2xl shadow-zen p-6 flex flex-col items-center mb-6 border border-slate-100 opacity-0 animate-fade-in-up stagger-1">
         <div className="size-24 rounded-full bg-slate-100 mb-4 p-1 border-2 border-slate-100">
            <img src={avatarUrl} className="rounded-full w-full h-full object-cover" alt="Profile" />
         </div>
         <h2 className="text-xl font-bold text-slate-900">{fullName}</h2>
         <p className="text-slate-500 text-sm mb-4">@{username}</p> 
         <div className="flex gap-2">
            <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wider ${userProfile.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-primary/10 text-primary'}`}>
                {userProfile.role}
            </span>
         </div>
      </div>

      {/* Settings Options */}
      <div className="bg-white rounded-xl shadow-zen border border-slate-100 overflow-hidden opacity-0 animate-fade-in-up stagger-2">
          <button 
            onClick={() => setCurrentSubView('ACCOUNT')}
            className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors border-b border-slate-100 text-left group"
          >
              <div className="p-2 bg-blue-50 rounded-lg text-primary group-hover:bg-blue-100 transition-colors">
                <User size={20} />
              </div>
              <div className="flex-1">
                <span className="font-bold text-slate-700 block group-hover:text-primary transition-colors">Account Details</span>
                <span className="text-xs text-slate-400">Name, Email, Username</span>
              </div>
              <ChevronRight size={18} className="text-slate-300" />
          </button>
          
          <button 
            onClick={() => setShowLogoutModal(true)}
            className="w-full flex items-center gap-3 p-4 hover:bg-red-50 transition-colors text-left group"
          >
              <div className="p-2 bg-slate-100 rounded-lg text-slate-400 group-hover:bg-red-100 group-hover:text-red-500 transition-colors">
                <LogOut size={20} />
              </div>
              <span className="font-bold text-slate-700 group-hover:text-red-600">Log Out</span>
          </button>
      </div>

      {/* LOGOUT MODAL */}
      {showLogoutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-xs rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200">
                  <div className="size-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <LogOut size={28} />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">Leaving already?</h3>
                  <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                      You will be logged out of your account. Any unsaved predictions might be lost.
                  </p>
                  <div className="flex flex-col gap-3">
                      <Button 
                        variant="danger"
                        onClick={handleLogout}
                        fullWidth
                        size="lg"
                        icon={LogOut}
                      >
                          Yes, Log Out
                      </Button>
                      <Button 
                        variant="secondary"
                        onClick={() => setShowLogoutModal(false)}
                        fullWidth
                        size="lg"
                      >
                          Cancel
                      </Button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Profile;
