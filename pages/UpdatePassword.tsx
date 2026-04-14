import React, { useState } from 'react';
import { ViewState } from '../types';
import { Lock, Eye, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';

interface UpdatePasswordProps {
  onNavigate: (view: ViewState) => void;
}

const UpdatePassword: React.FC<UpdatePasswordProps> = ({ onNavigate }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) throw error;

      setSuccess(true);
      setTimeout(() => {
        onNavigate('HOME');
      }, 2000);
    } catch (err: any) {
      console.error("Update Password Error:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative bg-slate-50 overflow-hidden">
      {/* Decorative Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-500/5 blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[5%] w-[30%] h-[30%] rounded-full bg-blue-600/10 blur-[80px] animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="flex flex-col w-full max-w-[440px] z-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2 tracking-tight">
            Update Password
          </h1>
          <p className="text-slate-500 text-base font-medium">
            Enter your new password below.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-100 relative">
          
          {success ? (
            <div className="flex flex-col items-center text-center py-8 animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600">
                <CheckCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Password Updated!</h3>
              <p className="text-slate-500 mb-6">
                Your password has been successfully changed. Redirecting to home...
              </p>
            </div>
          ) : (
            <form className="flex flex-col gap-5 mt-2" onSubmit={handleSubmit}>
              
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 ml-1">New Password</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 transition-colors">
                    <Lock size={20} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <Eye size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 ml-1">Confirm New Password</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 transition-colors">
                    <Lock size={20} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1 border border-red-100">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                isLoading={loading}
                variant="primary"
                fullWidth
                size="lg"
              >
                Update Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdatePassword;
