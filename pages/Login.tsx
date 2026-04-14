
import React, { useState, useEffect } from 'react';
import { ViewState } from '../types';
import { Mail, Lock, Eye, User, Award, AlertCircle, AtSign, Check, X, LogIn, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';

interface LoginProps {
  onNavigate: (view: ViewState) => void;
}

const Login: React.FC<LoginProps> = ({ onNavigate }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState(''); 
  const [username, setUsername] = useState(''); 
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Validation States
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null); 
  const [isCheckingUsername, setIsCheckingUsername] = useState(false); 
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time Username Validation
  useEffect(() => {
    if (!isRegistering || username.trim().length < 3) {
        setUsernameAvailable(null);
        return;
    }

    const checkUsername = async () => {
        setIsCheckingUsername(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('username')
                .ilike('username', username.trim()) 
                .maybeSingle();

            if (data) {
                setUsernameAvailable(false); 
            } else {
                setUsernameAvailable(true); 
            }
        } catch (err) {
            console.error("Error checking username:", err);
            setUsernameAvailable(null);
        } finally {
            setIsCheckingUsername(false);
        }
    };

    const timeoutId = setTimeout(checkUsername, 500); 
    return () => clearTimeout(timeoutId);

  }, [username, isRegistering]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match");
        }

        if (usernameAvailable === false) {
            throw new Error("This username is already registered");
        }

        if (!username || username.length < 3) {
            throw new Error("Username must be at least 3 characters long");
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              username: username, 
              role: 'Player',
            },
          },
        });

        if (signUpError) throw signUpError;
        
        if (data.user && data.session === null) {
            alert("Account created! Please check your email to verify your account.");
            setIsRegistering(false);
        } else if (data.session) {
            onNavigate('HOME');
        }

      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
        onNavigate('HOME');
      }

    } catch (err: any) {
      console.log("Auth Error:", err.message);
      let message = err.message;
      
      if (message.includes("User already registered") || message.includes("unique constraint")) {
          message = "This email is already registered";
      }
      
      if (message === 'Invalid login credentials') message = 'Invalid email or password';
      if (message.includes('Password should be at least')) message = 'Password must be at least 6 characters';
      
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = loading || (isRegistering && (
      username.length < 3 || 
      usernameAvailable === false || 
      isCheckingUsername ||          
      password !== confirmPassword   
  ));

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
          <div className="relative w-24 h-24 mx-auto mb-6 rounded-2xl shadow-xl bg-slate-900 flex items-center justify-center rotate-3 hover:rotate-0 transition-transform duration-500 border-4 border-white">
             <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-black rounded-xl"></div>
             <Award size={48} className="text-white relative z-10" />
             <div className="absolute -bottom-2 -right-2 bg-yellow-500 text-slate-900 text-[10px] font-black px-2 py-0.5 rounded-md shadow-sm border border-slate-900 z-20">
                JUDO
             </div>
          </div>
          
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2 tracking-tight">
            {isRegistering ? 'Join the Ranks' : 'Welcome to the Tatami'}
          </h1>
          <p className="text-slate-500 text-base font-medium">
            {isRegistering ? 'Create your profile to start predicting.' : 'Predict winners. Climb the rankings.'}
          </p>
        </div>

        {/* Login/Register Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 border border-slate-100">
          <div className="flex p-1 bg-slate-100 rounded-xl mb-8">
            <button 
                type="button"
                onClick={() => { setIsRegistering(false); setError(null); }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${!isRegistering ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Log In
            </button>
            <button 
                type="button"
                onClick={() => { setIsRegistering(true); setError(null); }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${isRegistering ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Register
            </button>
          </div>

          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            
            {isRegistering && (
                <>
                    <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 ml-1">Full Name</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 transition-colors">
                        <User size={20} />
                        </div>
                        <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        placeholder="Jigoro Kano"
                        required={isRegistering}
                        />
                    </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex justify-between">
                            <label className="text-sm font-medium text-slate-700 ml-1">Username</label> 
                            {username.length >= 3 && (
                                <span className="text-xs font-bold flex items-center gap-1">
                                    {isCheckingUsername ? (
                                        <span className="text-slate-400 flex items-center gap-1">Checking...</span>
                                    ) : usernameAvailable ? (
                                        <span className="text-green-600 flex items-center gap-1"><Check size={12}/> Available</span>
                                    ) : (
                                        <span className="text-red-500 flex items-center gap-1"><X size={12}/> Taken</span>
                                    )}
                                </span>
                            )}
                        </div>
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 transition-colors">
                                <AtSign size={20} />
                            </div>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className={`w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-xl text-slate-900 focus:outline-none focus:ring-2 transition-all text-sm
                                    ${usernameAvailable === false ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}
                                `}
                                placeholder="JudoMaster99"
                                required={isRegistering}
                            />
                        </div>
                        {usernameAvailable === false && !isCheckingUsername && (
                             <p className="text-[10px] text-red-500 font-bold ml-1 mt-1 animate-pulse">This username is already registered</p>
                        )}
                    </div>
                </>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 ml-1">Email</label>
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

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700 ml-1">Password</label>
                  {!isRegistering && (
                      <button 
                          type="button"
                          onClick={() => onNavigate('FORGOT_PASSWORD')}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                          Forgot Password?
                      </button>
                  )}
              </div>
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

            {isRegistering && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 ml-1">Confirm Password</label>
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
                      required={isRegistering}
                    />
                  </div>
                </div>
            )}
            
            {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1 border border-red-100">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitDisabled}
              isLoading={loading}
              variant="primary"
              fullWidth
              size="lg"
              icon={isRegistering ? UserPlus : LogIn}
            >
               {isRegistering ? 'Sign Up' : 'Log In'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
