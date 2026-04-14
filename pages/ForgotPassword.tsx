import React, { useState } from 'react';
import { ViewState } from '../types';
import { Mail, ArrowLeft, Send, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';

interface ForgotPasswordProps {
  onNavigate: (view: ViewState) => void;
}

const ForgotPassword: React.FC<ForgotPasswordProps> = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });

      if (error) throw error;

      setSuccess(true);
    } catch (err: any) {
      console.error("Reset Password Error:", err.message);
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
            Reset Password
          </h1>
          <p className="text-slate-500 text-base font-medium">
            Enter your email to receive a password reset link.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-100 relative">
          <button 
            onClick={() => onNavigate('LOGIN')}
            className="absolute top-6 left-6 text-slate-400 hover:text-slate-600 transition-colors"
            title="Back to Login"
          >
            <ArrowLeft size={24} />
          </button>

          {success ? (
            <div className="flex flex-col items-center text-center py-8 animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600">
                <CheckCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Check your email</h3>
              <p className="text-slate-500 mb-6">
                We have sent a password reset link to <span className="font-semibold text-slate-700">{email}</span>.
              </p>
              <Button
                onClick={() => onNavigate('LOGIN')}
                variant="primary"
                fullWidth
              >
                Return to Login
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-5 mt-8" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 ml-1">Email Address</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 transition-colors">
                    <Mail size={20} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    placeholder="sensei@tippon.com"
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
                icon={Send}
              >
                Send Reset Link
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
