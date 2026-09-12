import React, { useState } from 'react';
import {
  ShieldCheck,
  Clock,
  Navigation,
  Siren,
  Users,
  PhoneCall,
  Phone,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  X,
  Sparkles,
  MapPin,
  Volume2,
} from 'lucide-react';
import { UserProfile } from '../types';
import { updateUserProfileData } from '../services/authService';

interface OnboardingCarouselProps {
  user: UserProfile;
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingCarousel: React.FC<OnboardingCarouselProps> = ({
  user,
  isOpen,
  onClose,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  if (!isOpen) return null;

  const slides = [
    {
      id: 'trip-tracking',
      badge: 'Trip Tracking & Timer',
      badgeColor: 'bg-[#F9EDF3] text-[#9E4D71] border-[#F0D0DF]',
      title: 'Automated Trip Check-Ins',
      subtitle: 'Peace of mind on every commute, jog, or night walk.',
      icon: Clock,
      illustrationColor: 'bg-[#FAF2F6] border-[#F0D0DF] text-[#9E4D71]',
      features: [
        {
          icon: Navigation,
          title: 'Set Destination & ETA',
          description: 'Choose your route and duration before setting out.',
        },
        {
          icon: Clock,
          title: 'Automated Grace Period',
          description: "Get reminded to tap 'I'm Safe' when your expected arrival time hits.",
        },
        {
          icon: MapPin,
          title: 'Overdue Auto-Alerts',
          description: 'If you do not confirm within the grace window, emergency contacts receive live GPS maps.',
        },
      ],
    },
    {
      id: 'sos-features',
      badge: 'Rapid Response Circle',
      badgeColor: 'bg-rose-50 text-rose-800 border-rose-200',
      title: '1-Tap SOS & Silent Triggers',
      subtitle: 'Immediate broadcast to your safety circle when seconds count.',
      icon: Siren,
      illustrationColor: 'bg-rose-50 border-rose-200 text-rose-700',
      features: [
        {
          icon: Siren,
          title: '1-Tap SOS Dispatch',
          description: 'Instantly fires priority emergency alerts with your exact live coordinates.',
        },
        {
          icon: Users,
          title: 'Prioritized Contacts',
          description: 'Reorder your contacts so 1st responders and primary guardians get notified first.',
        },
        {
          icon: Volume2,
          title: 'Hardware Key Multi-Press',
          description: 'Triple-press volume or power keys to trigger emergency alerts silently.',
        },
      ],
    },
    {
      id: 'discreet-tools',
      badge: 'De-escalation Tools',
      badgeColor: 'bg-amber-50 text-amber-900 border-amber-200',
      title: 'Discreet Tools & Fake Call',
      subtitle: 'Subtle safety options to defuse uncomfortable moments safely.',
      icon: PhoneCall,
      illustrationColor: 'bg-[#FAF6F3] border-[#EFE8E1] text-[#9E4D71]',
      features: [
        {
          icon: PhoneCall,
          title: 'Simulated Incoming Call',
          description: 'Receive a realistic ringing call with authentic audio dialogue to exit uneasy situations.',
        },
        {
          icon: Phone,
          title: 'Quick-Dial Helpline Presets',
          description: 'Instant 1-tap connection to emergency helplines and national response services.',
        },
        {
          icon: Sparkles,
          title: 'Cloud Synced & Always On',
          description: 'Your safety preferences and priority list are backed up securely to Firebase.',
        },
      ],
    },
  ];

  const handleFinish = async () => {
    try {
      localStorage.setItem(`safecheck_onboarding_completed_${user.uid}`, 'true');
      await updateUserProfileData(user.uid, { hasCompletedOnboarding: true });
    } catch (e) {
      console.warn('Could not save onboarding completion state:', e);
    }
    onClose();
  };

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide((prev) => prev - 1);
    }
  };

  const slide = slides[currentSlide];
  const IconComponent = slide.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3A3A3A]/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        id="onboarding-carousel-modal"
        className="bg-white border border-[#EFE8E1] w-full max-w-lg rounded-3xl p-6 sm:p-8 text-[#3A3A3A] space-y-6 shadow-2xl relative overflow-hidden"
      >
        {/* Top Header & Skip */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-[#C88EA7] flex items-center justify-center text-white shadow-2xs">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#3A3A3A] uppercase tracking-wider">
              SafeCheck Quick Tour
            </span>
          </div>

          <button
            id="skip-onboarding-btn"
            onClick={handleFinish}
            className="text-xs font-semibold text-[#7D757A] hover:text-[#3A3A3A] px-2.5 py-1 rounded-lg hover:bg-[#FAF6F3] transition-colors cursor-pointer"
          >
            Skip
          </button>
        </div>

        {/* Slide Visual & Header */}
        <div className="text-center space-y-3 pt-2">
          {/* Central Icon Illustration */}
          <div
            className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border shadow-xs transition-transform transform ${slide.illustrationColor}`}
          >
            <IconComponent className="w-8 h-8" />
          </div>

          {/* Badge */}
          <div>
            <span
              className={`inline-block text-[11px] font-bold px-3 py-0.5 rounded-full border uppercase tracking-wider ${slide.badgeColor}`}
            >
              {slide.badge}
            </span>
          </div>

          {/* Slide Title */}
          <h2 className="text-xl sm:text-2xl font-bold text-[#3A3A3A] tracking-tight">
            {slide.title}
          </h2>
          <p className="text-xs sm:text-sm text-[#6B6368] max-w-sm mx-auto leading-relaxed">
            {slide.subtitle}
          </p>
        </div>

        {/* Feature Cards in Slide */}
        <div className="space-y-2.5 bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl">
          {slide.features.map((feat, idx) => {
            const FeatIcon = feat.icon;
            return (
              <div key={idx} className="flex items-start space-x-3 text-left">
                <div className="w-7 h-7 rounded-xl bg-white border border-[#EFE8E1] flex items-center justify-center text-[#9E4D71] shrink-0 mt-0.5 shadow-2xs">
                  <FeatIcon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-[#3A3A3A]">{feat.title}</h4>
                  <p className="text-[11px] text-[#6B6368] leading-normal">{feat.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step Indicators (Dots) */}
        <div className="flex items-center justify-center space-x-2 pt-1">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                idx === currentSlide
                  ? 'w-6 bg-[#B36D8B]'
                  : 'w-2 bg-[#EFE8E1] hover:bg-[#D5CDC6]'
              }`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2 border-t border-[#EFE8E1]">
          {currentSlide > 0 ? (
            <button
              id="onboarding-prev-btn"
              type="button"
              onClick={handlePrev}
              className="flex items-center space-x-1 px-4 py-2.5 rounded-xl border border-[#EFE8E1] text-xs font-bold text-[#6B6368] hover:bg-[#FAF6F3] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <div />
          )}

          <button
            id="onboarding-next-btn"
            type="button"
            onClick={handleNext}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
          >
            <span>{currentSlide === slides.length - 1 ? 'Get Started' : 'Next'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
