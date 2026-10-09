import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  Mail,
  Lock,
  User,
  CheckCircle2,
  ArrowRight,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
} from '../services/authService';

interface AuthProps {
  onAuthSuccess: () => void;
  initialMode?: 'login' | 'signup';
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess, initialMode = 'login' }) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Form Fields - always start empty/blank
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Reset errors and clear all form fields when switching modes
  const handleModeSwitch = (newMode: 'login' | 'signup') => {
    setMode(newMode);
    setError(null);
    setSuccessMessage(null);
    setUnauthorizedDomain(null);
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const getFirebaseErrorMessage = (err: any): string => {
    const errCode = err?.code || '';
    const errMsg = err?.message || '';

    if (errCode === 'auth/unauthorized-domain' || errMsg.includes('auth/unauthorized-domain') || errMsg.includes('unauthorized domain')) {
      const currentHost = window.location.hostname;
      setUnauthorizedDomain(currentHost);
      return `This domain (${currentHost}) is not yet added to your Firebase Authorized Domains list. Follow the steps below or use Email Login.`;
    }

    if (
      errMsg.includes('Database is closing') ||
      errMsg.includes('closing/hidden') ||
      errMsg.includes('IDBDatabase')
    ) {
      return 'The browser closed the Google popup session prematurely (common in iframe preview tabs). Please open the app in a new standalone tab (using the pop-out icon at the top right) or sign in with Email below.';
    }

    switch (errCode) {
      case 'auth/email-already-in-use':
        return 'This email address is already registered. Please log in instead or use another email.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters with letters and numbers.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password. Please verify your credentials and try again.';
      case 'auth/user-disabled':
        return 'This user account has been disabled. Please contact support.';
      case 'auth/too-many-requests':
        return 'Too many unsuccessful attempts. Access has been temporarily restricted for security. Please try again later.';
      case 'auth/network-request-failed':
        return 'Network connection error. Please check your internet connection.';
      case 'auth/popup-closed-by-user':
        return 'Google Sign-In popup was closed before completing authentication.';
      case 'auth/popup-blocked':
        return 'Popup blocked by browser. Please allow popups for this site and try again.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is not enabled in Firebase Authentication. Enable it in the Firebase Console.';
      default:
        return errMsg || 'An error occurred during authentication. Please try again.';
    }
  };

  const handleCopyHostname = () => {
    const host = window.location.hostname;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(host);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2500);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validation
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    if (!password) {
      setError('Please enter a password.');
      return;
    }

    if (mode === 'signup') {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError('Please enter your full name.');
        return;
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match. Please re-enter your password.');
        return;
      }
    }

    setLoading(true);
    if (mode === 'login') {
      setIsLoggingIn(true);
    }

    try {
      if (mode === 'signup') {
        await signUpWithEmail(name, trimmedEmail, password);
        setSuccessMessage('Account created successfully! Redirecting...');
        // Clear all form inputs so login form starts completely empty/blank
        setName('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        onAuthSuccess();
      } else {
        const signInPromise = signInWithEmail(trimmedEmail, password);
        const delayPromise = new Promise((resolve) => setTimeout(resolve, 800));
        await Promise.all([signInPromise, delayPromise]);
        // Clear inputs upon successful login
        setEmail('');
        setPassword('');
        onAuthSuccess();
      }
    } catch (err: any) {
      console.error('Email Auth Error:', err);
      setIsLoggingIn(false);
      setError(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
      setIsLoggingIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const user = await signInWithGoogle();
      if (user) {
        setIsLoggingIn(true);
        await new Promise((resolve) => setTimeout(resolve, 800));
        onAuthSuccess();
      }
    } catch (err: any) {
      const isPopupClosedByUser =
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request' ||
        err?.message?.includes('auth/popup-closed-by-user') ||
        err?.message?.includes('auth/cancelled-popup-request') ||
        err?.message?.includes('popup-closed-by-user');

      if (isPopupClosedByUser) {
        console.log('Google Sign-In was closed or cancelled by the user.');
        return;
      }

      console.error('Google Sign-In error:', err);
      setError(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 sm:my-12 px-4">
      {/* Logging In Spinner Overlay */}
      {isLoggingIn && (
        <div
          id="logging-in-overlay"
          className="fixed inset-0 bg-[#1A1A1A]/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white px-7 py-5 rounded-3xl border border-[#EFE8E1] shadow-2xl flex items-center space-x-3.5 animate-in zoom-in-95 duration-150">
            <div className="w-5 h-5 border-2 border-[#F0D0DF] border-t-[#9E4D71] rounded-full animate-spin shrink-0" />
            <span className="text-sm font-bold text-[#3A3A3A]">Logging in...</span>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#EFE8E1] rounded-3xl p-6 sm:p-8 shadow-xs text-[#3A3A3A] space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[#C88EA7] flex items-center justify-center shadow-xs">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-[#3A3A3A] font-sans">
            {mode === 'signup' ? 'Create SafeCheck Account' : 'Welcome to SafeCheck'}
          </h2>
          <p className="text-xs text-[#6B6368]">
            {mode === 'signup'
              ? 'Sign up to create custom trips, schedule check-ins, and notify emergency contacts.'
              : 'Sign in to access your safety check-ins and emergency contacts.'}
          </p>
        </div>

        {/* Mode Toggle Tabs */}
        <div className="flex bg-[#FAF6F3] p-1 rounded-2xl border border-[#EFE8E1]">
          <button
            id="tab-login-mode"
            type="button"
            onClick={() => handleModeSwitch('login')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              mode === 'login'
                ? 'bg-white text-[#9E4D71] shadow-xs border border-[#F0D0DF]'
                : 'text-[#6B6368] hover:text-[#3A3A3A]'
            }`}
          >
            Log In
          </button>
          <button
            id="tab-signup-mode"
            type="button"
            onClick={() => handleModeSwitch('signup')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              mode === 'signup'
                ? 'bg-white text-[#9E4D71] shadow-xs border border-[#F0D0DF]'
                : 'text-[#6B6368] hover:text-[#3A3A3A]'
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            id="auth-error-message"
            className="bg-rose-50 border border-rose-200 p-3.5 rounded-2xl space-y-2 text-xs text-rose-800 animate-in fade-in"
          >
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{error}</span>
            </div>

            {/* If Unauthorized Domain Error from Google Sign-In */}
            {unauthorizedDomain && (
              <div
                id="unauthorized-domain-guidance"
                className="mt-2 pt-2.5 border-t border-rose-200/80 space-y-2.5 text-[11px] text-rose-900"
              >
                <div className="bg-white p-2.5 rounded-xl border border-rose-200 space-y-1.5">
                  <div className="font-bold flex items-center justify-between">
                    <span>Current Domain to Authorize:</span>
                    <button
                      type="button"
                      onClick={handleCopyHostname}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-md font-bold transition-all cursor-pointer"
                    >
                      {copiedDomain ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Domain</span>
                        </>
                      )}
                    </button>
                  </div>
                  <code className="block bg-rose-50/80 px-2 py-1 rounded text-[10px] font-mono select-all break-all text-rose-950 font-semibold">
                    {unauthorizedDomain}
                  </code>
                </div>

                <div className="space-y-1 text-rose-900">
                  <p className="font-semibold">How to enable Google Sign-In in Firebase Console:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-rose-800 text-[10px]">
                    <li>Open <strong>Firebase Console &gt; Authentication &gt; Settings</strong></li>
                    <li>Scroll down to <strong>Authorized domains</strong></li>
                    <li>Click <strong>Add domain</strong> and paste the copied domain above</li>
                  </ol>
                </div>

                <div className="pt-1">
                  <a
                    href="https://console.firebase.google.com/project/safecheck-app-ba229/authentication/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 px-3 bg-white hover:bg-rose-100 text-rose-900 border border-rose-300 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  >
                    <span>Open Firebase Console</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl space-y-1 text-xs text-emerald-800 animate-in fade-in">
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{successMessage}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label
                htmlFor="signup-name-input"
                className="block text-xs font-semibold text-[#6B6368] mb-1"
              >
                Full Name *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#7D757A]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="signup-name-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Purva Kante"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email-input"
              className="block text-xs font-semibold text-[#6B6368] mb-1"
            >
              Email Address *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#7D757A]">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="auth-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="auth-password-input"
                className="block text-xs font-semibold text-[#6B6368]"
              >
                Password *
              </label>
              {mode === 'signup' && (
                <span className="text-[10px] text-[#7D757A]">Min. 6 characters</span>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#7D757A]">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="auth-password-input"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Create a secure password' : 'Enter your password'}
                className="w-full pl-9 pr-10 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#7D757A] hover:text-[#3A3A3A] cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div>
              <label
                htmlFor="signup-confirm-password-input"
                className="block text-xs font-semibold text-[#6B6368] mb-1"
              >
                Confirm Password *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#7D757A]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="signup-confirm-password-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                />
              </div>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            id="auth-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center space-x-2 active:scale-[0.99] disabled:opacity-50 cursor-pointer mt-2"
          >
            <span>
              {loading
                ? mode === 'signup'
                  ? 'Creating Account...'
                  : 'Logging In...'
                : mode === 'signup'
                ? 'Create Account'
                : 'Log In'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Divider */}
        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-[#EFE8E1]"></div>
          <span className="flex-shrink mx-4 text-[11px] font-semibold text-[#7D757A] uppercase tracking-wider">
            or continue with
          </span>
          <div className="flex-grow border-t border-[#EFE8E1]"></div>
        </div>

        {/* Google Sign-In Button */}
        <div>
          <button
            id="google-signin-btn"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] hover:border-[#C88EA7] shadow-2xs transition-all flex items-center justify-center space-x-2.5 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>

        {/* Toggle Mode Footer Link */}
        <div className="pt-2 text-center text-xs text-[#6B6368]">
          {mode === 'login' ? (
            <p>
              Don't have an account yet?{' '}
              <button
                id="switch-to-signup-btn"
                type="button"
                onClick={() => handleModeSwitch('signup')}
                className="font-bold text-[#9E4D71] hover:underline cursor-pointer ml-1"
              >
                Sign Up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button
                id="switch-to-login-btn"
                type="button"
                onClick={() => handleModeSwitch('login')}
                className="font-bold text-[#9E4D71] hover:underline cursor-pointer ml-1"
              >
                Log In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

