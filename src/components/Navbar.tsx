import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Menu,
  X,
  BellRing,
  User,
  LogOut,
  PlusCircle,
  Clock,
  Users,
  BookOpen,
  Shield,
  ChevronDown,
  Settings,
  Sparkles,
  Globe,
  Check,
  PhoneCall,
  WifiOff,
} from 'lucide-react';
import { UserProfile, Trip } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { SupportedLanguage } from '../i18n/translations';

interface NavbarProps {
  user: UserProfile | null;
  activeTrip: Trip | null;
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  onOpenSystemLogs?: () => void;
  isOffline?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTrip,
  currentPage,
  onNavigate,
  onLogout,
  onOpenSystemLogs,
  isOffline = false,
}) => {
  const { language, setLanguage, languages, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(event.target as Node)
      ) {
        setProfileDropdownOpen(false);
      }
      if (
        langDropdownRef.current &&
        !langDropdownRef.current.contains(event.target as Node)
      ) {
        setLangDropdownOpen(false);
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileDropdownOpen(false);
        setLangDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, []);

  const navItems = [
    { id: 'home', label: t('navHome'), icon: ShieldCheck, public: true },
    { id: 'dashboard', label: t('navDashboard'), icon: User, public: false },
    { id: 'start-trip', label: t('navStartTrip'), icon: PlusCircle, public: false },
    { id: 'contacts', label: t('navContacts'), icon: Users, public: false },
    { id: 'history', label: t('navHistory'), icon: Clock, public: false },
    { id: 'profile', label: t('navProfile'), icon: User, public: false },
    { id: 'settings', label: t('navSettings'), icon: Shield, public: false },
    { id: 'helplines', label: t('navHelplines'), icon: PhoneCall, public: true },
    { id: 'about', label: t('navAbout'), icon: BookOpen, public: true },
  ];

  const handleNavClick = (id: string) => {
    console.log(`[Navbar] handleNavClick called with id: "${id}" | currentPage: "${currentPage}" | user:`, user?.email || 'unauthenticated');
    if (id === 'home') {
      console.log('[Navbar] Home nav item clicked -> firing onNavigate("home")');
    }
    onNavigate(id);
    setMobileMenuOpen(false);
    setProfileDropdownOpen(false);
    setLangDropdownOpen(false);
  };

  const handleLogoutClick = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    console.log('[Navbar] Logout button clicked! Calling onLogout prop from App to open LogoutConfirmModal.');
    setProfileDropdownOpen(false);
    setMobileMenuOpen(false);
    onLogout();
  };

  const getInitials = (name: string) => {
    if (!name) return 'SC';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const currentLangObj = languages.find((l) => l.code === language) || languages[0];

  return (
    <nav className="h-16 bg-white border-b border-[#EFE8E1] sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Brand Logo */}
          <div
            className="flex items-center gap-2.5 cursor-pointer group shrink-0 mr-8 lg:mr-10"
            onClick={() => handleNavClick(user ? 'dashboard' : 'home')}
          >
            <div className="w-9 h-9 bg-[#C88EA7] rounded-xl flex items-center justify-center shadow-xs group-hover:bg-[#B36D8B] transition-colors">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-[#3A3A3A] font-sans">
                SafeCheck
              </span>
            </div>
            {isOffline && (
              <span
                id="navbar-offline-badge"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold tracking-wide uppercase"
                title="Device is offline. Local features and offline resilience active."
              >
                <WifiOff className="w-3 h-3 text-amber-700" />
                <span>Offline</span>
              </span>
            )}
          </div>

          {/* Active Trip Banner Pill */}
          {user && activeTrip && (
            <div
              onClick={() => handleNavClick('active-trip')}
              className={`hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer border transition-all ${
                activeTrip.status === 'reminded'
                  ? 'bg-amber-50 text-amber-800 border-amber-200 animate-pulse'
                  : 'bg-[#F9EDF3] text-[#9E4D71] border-[#F0D0DF]'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current animate-ping" />
              <span>
                {t('activeTripPill')}: <strong className="font-bold">{activeTrip.destination}</strong>
              </span>
              <span className="underline ml-0.5">{t('viewTimer')} →</span>
            </div>
          )}

          {/* Navigation Links */}
          <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#6B6368] mr-8 lg:mr-10">
            {navItems
              .filter((item) => item.public || user)
              .map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    id={`nav-link-${item.id}`}
                    onClick={() => handleNavClick(item.id)}
                    className={`py-5 transition-colors relative font-medium cursor-pointer ${
                      isActive
                        ? 'text-[#9E4D71] font-bold border-b-2 border-[#C88EA7]'
                        : 'hover:text-[#3A3A3A]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
          </div>

          {/* Right Action / Language Selector & User Profile */}
          <div className="hidden sm:flex items-center gap-3 shrink-0 ml-auto lg:ml-0">
            {/* Quick Language Selector */}
            <div className="relative" ref={langDropdownRef}>
              <button
                id="language-switcher-btn"
                type="button"
                onClick={() => setLangDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1] transition-colors cursor-pointer"
                title="Change Language (English / हिन्दी / मराठी)"
              >
                <Globe className="w-3.5 h-3.5 text-[#9E4D71]" />
                <span>{currentLangObj.nativeName}</span>
                <ChevronDown className="w-3 h-3 text-[#7D757A]" />
              </button>

              {langDropdownOpen && (
                <div className="absolute right-0 mt-2 w-44 bg-white rounded-2xl border border-[#EFE8E1] shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95">
                  {languages.map((langOpt) => {
                    const isSelected = language === langOpt.code;
                    return (
                      <button
                        key={langOpt.code}
                        id={`nav-lang-opt-${langOpt.code}`}
                        onClick={() => {
                          setLanguage(langOpt.code);
                          setLangDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2 text-xs text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#F9EDF3] text-[#9E4D71] font-bold'
                            : 'text-[#3A3A3A] hover:bg-[#FAF6F3]'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{langOpt.flag}</span>
                          <span>{langOpt.nativeName}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#9E4D71]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {user ? (
              <div className="relative pl-2 border-l border-[#EFE8E1]" ref={profileDropdownRef}>
                {/* Profile Button Trigger */}
                <button
                  id="user-profile-menu-button"
                  type="button"
                  onClick={() => setProfileDropdownOpen((prev) => !prev)}
                  className={`flex items-center gap-2.5 p-1.5 pl-2.5 rounded-2xl border transition-all cursor-pointer ${
                    profileDropdownOpen
                      ? 'bg-[#FAF6F3] border-[#C88EA7] shadow-xs'
                      : 'bg-transparent hover:bg-[#FAF6F3] border-transparent hover:border-[#EFE8E1]'
                  }`}
                  aria-expanded={profileDropdownOpen}
                  aria-haspopup="true"
                >
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-bold text-[#3A3A3A] leading-tight max-w-[120px] truncate">
                      {user.name}
                    </div>
                    <div className="text-[10px] text-[#7D757A] leading-tight max-w-[120px] truncate">
                      {user.email}
                    </div>
                  </div>

                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover border border-[#F0D0DF] shadow-2xs shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center font-bold text-xs text-[#9E4D71] shadow-2xs shrink-0">
                      {getInitials(user.name)}
                    </div>
                  )}

                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#7D757A] transition-transform duration-200 ${
                      profileDropdownOpen ? 'rotate-180 text-[#9E4D71]' : ''
                    }`}
                  />
                </button>

                {/* Profile Dropdown Menu */}
                {profileDropdownOpen && (
                  <div
                    id="user-profile-dropdown-menu"
                    className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-[#EFE8E1] shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100"
                  >
                    {/* User Profile Header in Dropdown */}
                    <div className="px-4 py-3 border-b border-[#EFE8E1]">
                      <div className="flex items-center gap-3">
                        {user.photoURL ? (
                          <img
                            src={user.photoURL}
                            alt={user.name}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover border border-[#F0D0DF] shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center font-bold text-sm text-[#9E4D71] shrink-0">
                            {getInitials(user.name)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#3A3A3A] truncate">{user.name}</p>
                          <p className="text-[11px] text-[#7D757A] truncate">{user.email}</p>
                        </div>
                      </div>
                    </div>

                    {/* Navigation Items */}
                    <div className="py-1">
                      <button
                        id="dropdown-nav-profile"
                        onClick={() => handleNavClick('profile')}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#3A3A3A] hover:bg-[#FAF6F3] hover:text-[#9E4D71] transition-colors text-left cursor-pointer"
                      >
                        <User className="w-3.5 h-3.5 text-[#9E4D71]" />
                        <span>{t('navProfile')}</span>
                      </button>

                      <button
                        id="dropdown-nav-dashboard"
                        onClick={() => handleNavClick('dashboard')}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#3A3A3A] hover:bg-[#FAF6F3] hover:text-[#9E4D71] transition-colors text-left cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#9E4D71]" />
                        <span>{t('navDashboard')}</span>
                      </button>

                      <button
                        id="dropdown-nav-contacts"
                        onClick={() => handleNavClick('contacts')}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#3A3A3A] hover:bg-[#FAF6F3] hover:text-[#9E4D71] transition-colors text-left cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5 text-[#9E4D71]" />
                        <span>{t('navContacts')}</span>
                      </button>

                      <button
                        id="dropdown-nav-settings"
                        onClick={() => handleNavClick('settings')}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#3A3A3A] hover:bg-[#FAF6F3] hover:text-[#9E4D71] transition-colors text-left cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5 text-[#9E4D71]" />
                        <span>{t('navSettings')}</span>
                      </button>
                    </div>

                    {/* Divider & Logout Action */}
                    <div className="pt-1 mt-1 border-t border-[#EFE8E1]">
                      <button
                        id="dropdown-logout-btn"
                        type="button"
                        onClick={handleLogoutClick}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50 hover:text-rose-800 transition-colors text-left cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 text-rose-600" />
                        <span>{t('navLogout')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                id="navbar-login-btn"
                onClick={() => handleNavClick('auth')}
                className="bg-[#B36D8B] hover:bg-[#9E5875] text-white font-semibold text-xs py-2 px-4 rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                {t('navLogin')}
              </button>
            )}
          </div>

          {/* Mobile menu icon + Language switcher */}
          <div className="lg:hidden flex items-center gap-2">
            <button
              id="mobile-lang-btn"
              onClick={() => {
                const next = language === 'en' ? 'hi' : language === 'hi' ? 'mr' : 'en';
                setLanguage(next);
              }}
              className="px-2 py-1 bg-[#FAF6F3] rounded-lg text-xs font-bold text-[#9E4D71] border border-[#EFE8E1] cursor-pointer"
            >
              {currentLangObj.nativeName}
            </button>
            <button
              id="mobile-menu-toggle-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-[#6B6368] hover:text-[#3A3A3A] hover:bg-[#FAF6F3] cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-b border-[#EFE8E1] px-4 pt-2 pb-6 space-y-2 shadow-lg">
          {user && activeTrip && (
            <div
              onClick={() => handleNavClick('active-trip')}
              className={`p-3 rounded-xl text-xs font-semibold cursor-pointer border ${
                activeTrip.status === 'reminded'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-[#F9EDF3] text-[#9E4D71] border-[#F0D0DF]'
              }`}
            >
              ⚡ {t('activeTripPill')}: <strong>{activeTrip.destination}</strong> — {t('viewTimer')}
            </div>
          )}

          {/* Language Picker in Mobile Drawer */}
          <div className="p-2 bg-[#FAF6F3] rounded-xl flex items-center justify-between">
            <span className="text-xs font-bold text-[#6B6368]">Language:</span>
            <div className="flex items-center gap-1">
              {languages.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    language === l.code
                      ? 'bg-[#B36D8B] text-white shadow-2xs'
                      : 'bg-white text-[#3A3A3A] border border-[#EFE8E1]'
                  }`}
                >
                  {l.nativeName}
                </button>
              ))}
            </div>
          </div>

          {navItems
            .filter((item) => item.public || user)
            .map((item) => {
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  id={`mobile-nav-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${
                    isActive
                      ? 'bg-[#F9EDF3] text-[#9E4D71] font-bold border border-[#F0D0DF]'
                      : 'text-[#6B6368] hover:bg-[#FAF6F3]'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}

          {user ? (
            <div className="pt-4 border-t border-[#EFE8E1] space-y-3">
              <div
                className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-[#FAF6F3]"
                onClick={() => handleNavClick('profile')}
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full object-cover border border-[#F0D0DF] shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center font-bold text-xs text-[#9E4D71]">
                    {getInitials(user.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#3A3A3A] truncate">{user.name}</p>
                  <p className="text-xs text-[#7D757A] truncate">{user.email}</p>
                </div>
              </div>

              <button
                id="mobile-logout-btn"
                onClick={handleLogoutClick}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('navLogout')}</span>
              </button>
            </div>
          ) : (
            <div className="pt-2">
              <button
                id="mobile-login-btn"
                onClick={() => handleNavClick('auth')}
                className="w-full py-2.5 rounded-xl text-center text-sm font-semibold bg-[#B36D8B] hover:bg-[#9E5875] text-white cursor-pointer"
              >
                {t('navLogin')}
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
};
