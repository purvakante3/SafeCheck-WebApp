import React, { useState, useMemo } from 'react';
import {
  PhoneCall,
  Phone,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Search,
  Wifi,
  WifiOff,
  Flame,
  HeartPulse,
  Users,
  Shield,
  Clock,
  Sparkles,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { EMERGENCY_HELPLINES, Helpline } from '../data/helplines';
import { useLanguage } from '../i18n/LanguageContext';

interface HelplinesProps {
  onNavigate?: (page: string) => void;
}

export const Helplines: React.FC<HelplinesProps> = ({ onNavigate }) => {
  const { language, t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyNumber = (helpline: Helpline, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(helpline.number);
      setCopiedId(helpline.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const filteredHelplines = useMemo(() => {
    return EMERGENCY_HELPLINES.filter((item) => {
      const matchesCategory =
        selectedCategory === 'all' ||
        (selectedCategory === 'women' && item.category === 'women') ||
        (selectedCategory === 'primary' && (item.category === 'primary' || item.category === 'police' || item.category === 'fire')) ||
        (selectedCategory === 'medical' && item.category === 'medical') ||
        (selectedCategory === 'specialized' && item.category === 'specialized');

      const query = searchQuery.trim().toLowerCase();
      if (!query) return matchesCategory;

      const matchesSearch =
        item.number.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.nameHi.toLowerCase().includes(query) ||
        item.nameMr.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.categoryLabel.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const getHelplineName = (item: Helpline) => {
    if (language === 'hi') return item.nameHi || item.name;
    if (language === 'mr') return item.nameMr || item.name;
    return item.name;
  };

  const getHelplineDesc = (item: Helpline) => {
    if (language === 'hi') return item.descriptionHi || item.description;
    if (language === 'mr') return item.descriptionMr || item.description;
    return item.description;
  };

  const getCategoryLabel = (item: Helpline) => {
    if (language === 'hi') return item.categoryLabelHi || item.categoryLabel;
    if (language === 'mr') return item.categoryLabelMr || item.categoryLabel;
    return item.categoryLabel;
  };

  const getCategoryIcon = (category: Helpline['category']) => {
    switch (category) {
      case 'primary':
        return <ShieldAlert className="w-4 h-4 text-[#9E4D71]" />;
      case 'women':
        return <Shield className="w-4 h-4 text-[#9E4D71]" />;
      case 'police':
        return <ShieldCheck className="w-4 h-4 text-sky-600" />;
      case 'medical':
        return <HeartPulse className="w-4 h-4 text-emerald-600" />;
      case 'fire':
        return <Flame className="w-4 h-4 text-orange-600" />;
      default:
        return <Users className="w-4 h-4 text-purple-600" />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Banner & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EFE8E1] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center gap-1">
              <WifiOff className="w-3 h-3" />
              <span>{t('offlineReadyBadge')}</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {t('zeroPermBadge')}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3A3A3A] tracking-tight">
            {t('helplinesTitle')}
          </h1>
          <p className="text-sm text-[#6B6368] mt-1 max-w-2xl">
            {t('helplinesSubtitle')}
          </p>
        </div>

        {/* Quick 112 Hero Callout */}
        <a
          id="btn-quick-call-112"
          href="tel:112"
          className="inline-flex items-center justify-center gap-2.5 bg-[#9E4D71] hover:bg-[#7C3654] text-white px-5 py-3.5 rounded-2xl font-bold text-sm shadow-md transition-all active:scale-95 group shrink-0"
        >
          <PhoneCall className="w-4 h-4 animate-bounce" />
          <span>{t('quickCall112Btn')}</span>
        </a>
      </div>

      {/* Mandatory Disclaimer Box */}
      <div
        id="disclaimer-call-112"
        className="bg-amber-50/90 border-2 border-amber-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5 shadow-xs"
      >
        <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5 text-amber-800">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="space-y-1 flex-1">
          <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
            <span>{t('helplineDisclaimerTitle')}</span>
          </h3>
          <p className="text-xs sm:text-sm text-amber-800 leading-relaxed font-medium">
            {t('helplineDisclaimerDesc')}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3 bg-white p-4 sm:p-5 rounded-2xl border border-[#EFE8E1] shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9E4D71]" />
          <input
            id="helpline-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('helplineSearchPlaceholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] focus:border-[#C88EA7] focus:bg-white rounded-xl text-sm text-[#3A3A3A] placeholder-[#8A7B84] outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#8A7B84] hover:text-[#3A3A3A] bg-white px-2 py-0.5 rounded-md border border-[#EFE8E1]"
            >
              {language === 'hi' ? 'हटाएं' : language === 'mr' ? 'साफ करा' : 'Clear'}
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'all', label: t('helplineCategoryAll') },
            { id: 'women', label: t('helplineCategoryWomen') },
            { id: 'primary', label: t('helplineCategoryPrimary') },
            { id: 'medical', label: t('helplineCategoryMedical') },
            { id: 'specialized', label: t('helplineCategorySpecialized') },
          ].map((cat) => (
            <button
              key={cat.id}
              id={`filter-cat-${cat.id}`}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-[#9E4D71] text-white shadow-2xs'
                  : 'bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#6B6368] border border-[#EFE8E1]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Helplines Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredHelplines.map((item) => {
          const isCopied = copiedId === item.id;
          const isPriority = item.priority;

          return (
            <div
              key={item.id}
              id={`helpline-card-${item.id}`}
              className={`bg-white rounded-2xl p-5 border transition-all hover:shadow-md flex flex-col justify-between relative group ${
                isPriority
                  ? 'border-[#F0D0DF] ring-1 ring-[#F0D0DF]/60 shadow-xs'
                  : 'border-[#EFE8E1]'
              }`}
            >
              <div>
                {/* Card Header with Badges */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="p-1 rounded-lg bg-[#FAF6F3] border border-[#EFE8E1]">
                      {getCategoryIcon(item.category)}
                    </span>
                    <span className="text-[11px] font-bold text-[#9E4D71] bg-[#F9EDF3] px-2 py-0.5 rounded-full border border-[#F0D0DF]">
                      {getCategoryLabel(item)}
                    </span>
                    {item.is24x7 && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{t('helpline24x7Active')}</span>
                      </span>
                    )}
                    {item.tollFree && (
                      <span className="text-[10px] font-medium text-[#6B6368] bg-[#FAF6F3] px-2 py-0.5 rounded-full border border-[#EFE8E1]">
                        {t('helplineTollFree')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Number & Service Name */}
                <div className="mt-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#3A3A3A] tracking-tight font-mono">
                      {item.number}
                    </span>
                  </div>
                  <h2 className="font-bold text-[#3A3A3A] text-base mt-1 leading-snug">
                    {getHelplineName(item)}
                  </h2>
                  <p className="text-xs text-[#6B6368] mt-1.5 leading-relaxed">
                    {getHelplineDesc(item)}
                  </p>
                </div>
              </div>

              {/* Action Buttons: Tap to Call & Copy */}
              <div className="mt-5 pt-4 border-t border-[#EFE8E1] flex items-center gap-2.5">
                <a
                  id={`btn-call-${item.number}`}
                  href={`tel:${item.tel}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#9E4D71] hover:bg-[#7C3654] text-white px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-xs transition-all active:scale-95 text-center"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>{t('callBtn', { num: item.number })}</span>
                </a>

                <button
                  id={`btn-copy-${item.number}`}
                  type="button"
                  onClick={(e) => handleCopyNumber(item, e)}
                  title={t('copyNumBtn')}
                  className={`px-3 py-2.5 rounded-xl font-semibold text-xs border transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                    isCopied
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#6B6368] hover:text-[#3A3A3A] border-[#EFE8E1]'
                  }`}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t('copiedNumBtn')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#8A7B84]" />
                      <span>{t('copyNumBtn')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredHelplines.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center border border-[#EFE8E1] space-y-2">
          <p className="text-sm font-bold text-[#3A3A3A]">
            {language === 'hi' ? `कोई हेल्पलाइन "${searchQuery}" से मेल नहीं खाती` : language === 'mr' ? `कोणतीही हेल्पलाईन "${searchQuery}" शी जुळत नाही` : `No helplines match "${searchQuery}"`}
          </p>
          <p className="text-xs text-[#6B6368]">
            {language === 'hi' ? '112, पुलिस, महिला या एम्बुलेंस खोजें।' : language === 'mr' ? '112, पोलीस, महिला किंवा रुग्णवाहिका शोधा.' : 'Try searching for "Police", "Women", "112", or reset the category filter.'}
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
            className="mt-2 text-xs font-bold text-[#9E4D71] hover:underline"
          >
            {language === 'hi' ? 'फ़िल्टर रीसेट करें' : language === 'mr' ? 'फिल्टर रीसेट करा' : 'Reset Filters'}
          </button>
        </div>
      )}

      {/* Offline Guarantee Info Card */}
      <div className="bg-[#FAF6F3] rounded-2xl p-5 border border-[#EFE8E1] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#9E4D71] flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5" />
            <span>{t('offlineCardTitle')}</span>
          </h4>
          <p className="text-xs text-[#6B6368] leading-relaxed max-w-2xl">
            {t('offlineCardDesc')}
          </p>
        </div>

        {onNavigate && (
          <button
            id="btn-return-dashboard"
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3A3A3A] hover:text-[#9E4D71] bg-white px-3.5 py-2 rounded-xl border border-[#EFE8E1] shadow-2xs transition-colors shrink-0"
          >
            <span>{t('backToDashboardBtn')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
