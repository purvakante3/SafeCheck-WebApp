import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  Camera,
  Check,
  BellRing,
  Shield,
  ShieldCheck,
  Users,
  Clock,
  Navigation,
  AlertTriangle,
  Siren,
  Sparkles,
  Phone,
  Mail,
  Edit3,
  BookOpen,
  Send,
  HelpCircle,
  ExternalLink,
  Upload,
  Loader2,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { UserProfile, EmergencyContact, Trip } from '../types';
import { updateUserProfileData } from '../services/authService';
import {
  getNotificationStatus,
  requestNotificationPermission,
  testPushNotification,
  NotificationStatus,
} from '../services/notificationService';
import {
  uploadProfileAvatar,
  validateAvatarFile,
  fileToDataUrl,
} from '../services/storageService';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDuration } from '../utils/formatters';

interface ProfileProps {
  user: UserProfile;
  contacts: EmergencyContact[];
  trips: Trip[];
  onNavigate: (page: string) => void;
  onReopenOnboarding: () => void;
  onUpdateUser: (updated: UserProfile) => void;
}

export const Profile: React.FC<ProfileProps> = ({
  user,
  contacts,
  trips,
  onNavigate,
  onReopenOnboarding,
  onUpdateUser,
}) => {
  const { t, language } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user.name || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || user.photoUrl || '');
  const [phone, setPhone] = useState(user.phone || user.phoneNumber || '');
  const [selectedAvatarPreset, setSelectedAvatarPreset] = useState<string | null>(null);

  // Photo upload and preview state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push Notification state
  const [notifStatus, setNotifStatus] = useState<NotificationStatus | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [deniedWarning, setDeniedWarning] = useState(false);

  // Avatar presets
  const avatarPresets = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
  ];

  // Refresh notification status on load
  useEffect(() => {
    getNotificationStatus(user.uid).then(setNotifStatus);
  }, [user.uid]);

  // Sync state if user changes
  useEffect(() => {
    setName(user.name || '');
    setPhotoURL(user.photoURL || user.photoUrl || '');
    setPhone(user.phone || user.phoneNumber || '');
  }, [user]);

  // Handle image file selection, validation, instant local preview & Firebase Storage upload
  const handleProcessImageFile = async (file: File) => {
    setUploadError(null);
    setError(null);

    // 1. Validate file format and size
    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      if (validation.code === 'SIZE_EXCEEDED') {
        setUploadError(t('fileSizeExceededError'));
      } else if (validation.code === 'INVALID_TYPE') {
        setUploadError(t('invalidFormatError'));
      } else {
        setUploadError(validation.error || 'Invalid file.');
      }
      return;
    }

    // 2. Immediate instant visual preview before/during upload
    try {
      const localPreviewUrl = await fileToDataUrl(file);
      setPreviewPhoto(localPreviewUrl);
      setSelectedAvatarPreset(null);
    } catch (e) {
      console.warn('Could not generate local preview:', e);
    }

    // 3. Upload to Firebase Storage
    setUploadingPhoto(true);
    setUploadProgress(15);

    try {
      const downloadUrl = await uploadProfileAvatar(user.uid, file, (progressPct) => {
        setUploadProgress(progressPct);
      });

      // Set the resulting Firebase Storage download URL
      setPhotoURL(downloadUrl);
      setPreviewPhoto(downloadUrl);
      setSelectedAvatarPreset(null);
      setUploadError(null);
    } catch (err: any) {
      console.error('Firebase Storage avatar upload failed:', err);
      setUploadError(err.message || t('photoUploadError'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessImageFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessImageFile(file);
    }
  };

  // Trip Stats Calculations
  const totalTrips = trips.length;
  const safeTrips = trips.filter((t) => t.status === 'safe').length;
  const alertedTrips = trips.filter((t) => t.status === 'alerted').length;
  const sosTrips = trips.filter((t) => t.isSosEvent || (t.destination || '').includes('SOS')).length;
  const safeRate = totalTrips > 0 ? Math.round((safeTrips / totalTrips) * 100) : 100;

  const totalMinutes = trips
    .filter((t) => t.status === 'safe')
    .reduce((acc, t) => acc + (t.durationMinutes || 0), 0);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(language === 'hi' ? 'कृपया एक वैध नाम दर्ज करें।' : language === 'mr' ? 'कृपया वैध नाव टाका.' : 'Please enter a valid display name.');
      return;
    }

    setSaving(true);
    try {
      const finalPhoto = selectedAvatarPreset || photoURL.trim() || previewPhoto || '';
      const finalPhone = phone.trim() || '';
      const updated = await updateUserProfileData(user.uid, {
        name: trimmedName,
        photoURL: finalPhoto,
        photoUrl: finalPhoto,
        phone: finalPhone,
        phoneNumber: finalPhone,
      });

      onUpdateUser(updated);
      setSaveSuccess(true);
      setIsEditing(false);
      setPreviewPhoto(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating user profile:', err);
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleEnablePush = async () => {
    if (
      notifStatus?.permission === 'denied' ||
      (typeof Notification !== 'undefined' && Notification.permission === 'denied')
    ) {
      setDeniedWarning(true);
      return;
    }

    setPushLoading(true);
    setDeniedWarning(false);
    try {
      const res = await requestNotificationPermission(user.uid);
      const status = await getNotificationStatus(user.uid);
      setNotifStatus(status);
      if (status.permission === 'denied' || !res.success) {
        if (
          status.permission === 'denied' ||
          (typeof Notification !== 'undefined' && Notification.permission === 'denied') ||
          res.error?.toLowerCase().includes('block') ||
          res.error?.toLowerCase().includes('denied')
        ) {
          setDeniedWarning(true);
        }
      } else if (res.success) {
        setDeniedWarning(false);
        setTestSent(true);
        setTimeout(() => setTestSent(false), 4000);
      }
    } catch (e) {
      console.error('Push enable error:', e);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setDeniedWarning(true);
      }
    } finally {
      setPushLoading(false);
    }
  };

  const handleSendTestPush = async () => {
    const ok = await testPushNotification();
    if (ok) {
      setTestSent(true);
      setTimeout(() => setTestSent(false), 4000);
    }
  };

  const getInitials = (nameStr: string) => {
    if (!nameStr) return 'SC';
    const parts = nameStr.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return nameStr.slice(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* Header Banner */}
      <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <User className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('profileBadge')}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#3A3A3A]">{t('profilePageTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#6B6368] max-w-xl">
            {t('profilePageSubtitle')}
          </p>
        </div>

        <button
          id="profile-onboarding-tour-btn"
          onClick={onReopenOnboarding}
          className="flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-[#EFE8E1] bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs shadow-2xs transition-colors shrink-0 cursor-pointer"
        >
          <BookOpen className="w-4 h-4 text-[#9E4D71]" />
          <span>{t('replayWalkthroughBtn')}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-2xl flex items-center space-x-2 text-xs font-bold shadow-xs">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{t('profileSavedSuccess')}</span>
        </div>
      )}

      {/* Main Grid: Left Profile Card / Right Stats & Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Profile Card & Photo Editor */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-3xl shadow-xs space-y-6 text-center">
            {/* Avatar Display */}
            <div className="space-y-3">
              <div className="relative w-28 h-28 mx-auto">
                {previewPhoto || selectedAvatarPreset || user.photoURL || user.photoUrl ? (
                  <img
                    src={previewPhoto || selectedAvatarPreset || user.photoURL || user.photoUrl}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-28 h-28 rounded-full object-cover border-4 border-[#F9EDF3] shadow-md mx-auto"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-[#F9EDF3] border-4 border-[#F0D0DF] flex items-center justify-center font-extrabold text-2xl text-[#9E4D71] shadow-md mx-auto">
                    {getInitials(user.name)}
                  </div>
                )}

                {uploadingPhoto && (
                  <div className="absolute inset-0 rounded-full bg-black/60 flex flex-col items-center justify-center text-white backdrop-blur-xs">
                    <Loader2 className="w-6 h-6 animate-spin text-white mb-1" />
                    <span className="text-[10px] font-bold">{uploadProgress}%</span>
                  </div>
                )}

                <button
                  id="edit-profile-photo-camera-btn"
                  type="button"
                  onClick={() => {
                    setIsEditing(true);
                    fileInputRef.current?.click();
                  }}
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#B36D8B] hover:bg-[#9E5875] text-white flex items-center justify-center shadow-md transition-all cursor-pointer"
                  title={t('uploadPhotoBtn')}
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>

              {/* Upload Photo Option near Avatar */}
              <div>
                <button
                  id="upload-photo-avatar-btn"
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => {
                    setIsEditing(true);
                    fileInputRef.current?.click();
                  }}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-[#EFE8E1] bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {uploadingPhoto ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9E4D71]" />
                      <span>{t('uploadingPhotoMsg')}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 text-[#9E4D71]" />
                      <span>{t('uploadPhotoBtn')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* User Core Info */}
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-[#3A3A3A]">{user.name}</h2>
              <p className="text-xs text-[#7D757A] font-mono">{user.email}</p>
              {user.phone && (
                <p className="text-xs text-[#5A5558] flex items-center justify-center space-x-1 mt-1">
                  <Phone className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>{user.phone}</span>
                </p>
              )}
            </div>

            {/* Status Pills */}
            <div className="flex items-center justify-center gap-2 flex-wrap pt-2 border-t border-[#EFE8E1]">
              <span className="inline-flex items-center space-x-1 bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                <ShieldCheck className="w-3 h-3" />
                <span>{t('protectedBadge')}</span>
              </span>
              <span className="inline-flex items-center space-x-1 bg-[#FAF6F3] text-[#5A5558] border border-[#EFE8E1] text-[10px] font-bold px-2.5 py-1 rounded-full">
                <span>{t('contactsCountUnit', { count: contacts.length })}</span>
              </span>
            </div>

            <button
              id="toggle-edit-profile-btn"
              onClick={() => setIsEditing(!isEditing)}
              className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl border border-[#EFE8E1] bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs shadow-2xs transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#9E4D71]" />
              <span>{isEditing ? t('cancel') : t('editProfileBtn')}</span>
            </button>
          </div>

          {/* Push Notification Card */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-3xl shadow-xs space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center text-[#9E4D71]">
                <BellRing className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-sm">{t('pushSectionTitle')}</h3>
                <p className="text-[11px] text-[#7D757A]">Firebase Cloud Messaging</p>
              </div>
            </div>

            <p className="text-xs text-[#6B6368] leading-relaxed">
              {t('pushSectionDesc')}
            </p>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-[#FAF6F3] border border-[#EFE8E1] text-xs">
              <span className="font-semibold text-[#5A5558]">{t('pushSectionTitle')}:</span>
              <span
                className={`font-bold px-2 py-0.5 rounded-full text-[10px] uppercase ${
                  notifStatus?.permission === 'granted'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : notifStatus?.permission === 'denied'
                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                {notifStatus?.permission || 'Default'}
              </span>
            </div>

            {notifStatus?.permission !== 'granted' ? (
              <button
                id="enable-fcm-push-btn"
                onClick={handleEnablePush}
                disabled={pushLoading}
                className="w-full py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {pushLoading ? t('enablingPushBtn') : t('enablePushBtn')}
              </button>
            ) : (
              <button
                id="test-fcm-push-btn"
                onClick={handleSendTestPush}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs shadow-2xs transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 text-emerald-700" />
                <span>{testSent ? t('testPushSentBtn') : t('sendTestPushBtn')}</span>
              </button>
            )}

            {deniedWarning && (
              <div
                id="push-denied-warning"
                className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start space-x-2 animate-in fade-in"
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {t('pushDeniedWarning')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Edit Profile Form / Stats & Contacts */}
        <div className="lg:col-span-2 space-y-6">
          {/* Edit Profile Form */}
          {isEditing && (
            <div className="bg-white border-2 border-[#C88EA7] p-6 rounded-3xl shadow-md space-y-5 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-[#EFE8E1] pb-3">
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('editProfileBtn')}</h3>
                <span className="text-xs text-[#9E4D71] font-semibold">Live Firebase Sync</span>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-800 font-semibold">
                  {error}
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('displayNameLabel')}
                  </label>
                  <input
                    id="profile-edit-name-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('phoneNumberLabel')}
                  </label>
                  <input
                    id="profile-edit-phone-input"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +1 (555) 019-2834"
                    className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                  />
                </div>

                {/* Hidden File Input for Image Selection */}
                <input
                  ref={fileInputRef}
                  type="file"
                  id="profile-photo-file-input"
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                {/* Custom Photo Upload Card */}
                <div className="space-y-2.5 p-4 rounded-2xl bg-[#FAF6F3] border border-[#EFE8E1]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#3A3A3A] flex items-center space-x-1.5">
                      <Upload className="w-3.5 h-3.5 text-[#9E4D71]" />
                      <span>{t('uploadCustomPhotoTitle')}</span>
                    </label>
                    <span className="text-[10px] text-[#7D757A] font-medium">Max 5MB • JPG, PNG, WEBP</span>
                  </div>

                  <p className="text-xs text-[#6B6368]">
                    {t('uploadCustomPhotoDesc')}
                  </p>

                  {uploadError && (
                    <div
                      id="profile-upload-error-alert"
                      className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-800 flex items-start space-x-2 font-medium"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {/* Drag & Drop / Click to Upload Area */}
                  <div
                    id="profile-photo-dropzone"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => {
                      if (!uploadingPhoto) {
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2 ${
                      isDragging
                        ? 'border-[#9E4D71] bg-[#F9EDF3]/60'
                        : 'border-[#D9CFD6] hover:border-[#9E4D71] bg-white'
                    }`}
                  >
                    {uploadingPhoto ? (
                      <div className="space-y-2 py-3">
                        <Loader2 className="w-6 h-6 animate-spin text-[#9E4D71] mx-auto" />
                        <p className="text-xs font-bold text-[#9E4D71]">
                          {t('uploadingPhotoMsg')} ({uploadProgress}%)
                        </p>
                        <div className="w-48 bg-[#EFE8E1] rounded-full h-1.5 mx-auto overflow-hidden">
                          <div
                            className="bg-[#9E4D71] h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (previewPhoto && !selectedAvatarPreset) || (photoURL && !selectedAvatarPreset && !avatarPresets.includes(photoURL)) ? (
                      <div className="flex items-center justify-between w-full px-2">
                        <div className="flex items-center space-x-3 text-left">
                          <img
                            src={previewPhoto || photoURL}
                            alt="Custom avatar preview"
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-full object-cover border-2 border-[#9E4D71] shadow-2xs shrink-0"
                          />
                          <div>
                            <p className="text-xs font-bold text-[#3A3A3A] flex items-center space-x-1">
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Photo selected</span>
                            </p>
                            <p className="text-[11px] text-[#7D757A]">Click or drop new image to replace</p>
                          </div>
                        </div>
                        <button
                          id="remove-custom-photo-btn"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewPhoto(null);
                            setPhotoURL('');
                            setSelectedAvatarPreset(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer flex items-center space-x-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>{t('removeCustomPhoto')}</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-full bg-[#F9EDF3] flex items-center justify-center text-[#9E4D71]">
                          <Upload className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-[#3A3A3A]">{t('uploadPhotoBtn')}</p>
                          <p className="text-[11px] text-[#7D757A]">Drag & drop an image here or click to browse</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Avatar Presets */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#6B6368]">
                      {t('orChoosePreset')}
                    </label>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {avatarPresets.map((presetUrl, idx) => (
                      <button
                        key={idx}
                        id={`avatar-preset-btn-${idx}`}
                        type="button"
                        onClick={() => {
                          setSelectedAvatarPreset(presetUrl);
                          setPhotoURL(presetUrl);
                          setPreviewPhoto(presetUrl);
                          setUploadError(null);
                        }}
                        className={`relative rounded-2xl overflow-hidden aspect-square border-2 transition-all cursor-pointer ${
                          selectedAvatarPreset === presetUrl || (photoURL === presetUrl && !uploadingPhoto)
                            ? 'border-[#9E4D71] ring-2 ring-[#C88EA7]/40 scale-105'
                            : 'border-transparent hover:border-[#C88EA7]'
                        }`}
                      >
                        <img
                          src={presetUrl}
                          alt={`Avatar preset ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('avatarPresetsLabel')} (URL)
                  </label>
                  <input
                    id="profile-edit-photourl-input"
                    type="url"
                    value={photoURL}
                    onChange={(e) => {
                      setPhotoURL(e.target.value);
                      setPreviewPhoto(e.target.value || null);
                      setSelectedAvatarPreset(null);
                    }}
                    placeholder="https://example.com/avatar.jpg"
                    className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors font-mono text-xs"
                  />
                </div>

                <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#EFE8E1]">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2.5 rounded-xl border border-[#EFE8E1] text-xs font-semibold text-[#6B6368] hover:bg-[#FAF6F3] cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    id="save-profile-btn"
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? t('savingProfileBtn') : t('saveProfileBtn')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Safety & Transit Statistics */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-3xl shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-[#9E4D71]" />
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('travelStatsTitle')}</h3>
              </div>
              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {t('statSafeRate')}: {safeRate}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl text-center space-y-1">
                <span className="text-2xl font-extrabold text-[#3A3A3A]">{totalTrips}</span>
                <p className="text-[11px] font-semibold text-[#7D757A] uppercase tracking-wider">
                  {t('statTotalTrips')}
                </p>
              </div>

              <div className="bg-emerald-50/50 border border-emerald-200/60 p-4 rounded-2xl text-center space-y-1">
                <span className="text-2xl font-extrabold text-emerald-800">{safeTrips}</span>
                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                  {t('statSafeArrivals')}
                </p>
              </div>

              <div className="bg-rose-50/50 border border-rose-200/60 p-4 rounded-2xl text-center space-y-1">
                <span className="text-2xl font-extrabold text-rose-800">{sosTrips}</span>
                <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">
                  {t('statSosEvents')}
                </p>
              </div>

              <div className="bg-[#FAF2F6] border border-[#F0D0DF] p-4 rounded-2xl text-center space-y-1">
                <span className="text-2xl font-extrabold text-[#9E4D71]">{formatDuration(totalMinutes)}</span>
                <p className="text-[11px] font-semibold text-[#9E4D71] uppercase tracking-wider">
                  {t('statSafeMinutes')}
                </p>
              </div>
            </div>
          </div>

          {/* Emergency Contacts Circle Summary */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-3xl shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-[#9E4D71]" />
                <div>
                  <h3 className="font-bold text-[#3A3A3A] text-base">{t('trustedCircleTitle')}</h3>
                  <p className="text-[11px] text-[#7D757A]">
                    {t('priorityInfoDesc')}
                  </p>
                </div>
              </div>
              <button
                id="profile-manage-contacts-btn"
                onClick={() => onNavigate('contacts')}
                className="text-xs font-bold text-[#9E4D71] hover:text-[#7C3654] hover:underline cursor-pointer"
              >
                {t('manageCircleBtn')}
              </button>
            </div>

            {contacts.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[#FAF6F3] border border-dashed border-[#EFE8E1] text-center space-y-2">
                <p className="text-xs text-[#6B6368]">{t('noContactsTitle')}</p>
                <button
                  id="profile-empty-add-contact-btn"
                  onClick={() => onNavigate('contacts')}
                  className="px-4 py-1.5 rounded-xl bg-[#B36D8B] text-white text-xs font-bold shadow-2xs cursor-pointer"
                >
                  {t('addContactBtn')}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {contacts.slice(0, 4).map((c, idx) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-[#FAF6F3] border border-[#EFE8E1] text-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[11px] ${
                          idx === 0
                            ? 'bg-[#9E4D71] text-white'
                            : 'bg-white text-[#5A5558] border border-[#EFE8E1]'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <div>
                        <span className="font-bold text-[#3A3A3A] text-sm">{c.name}</span>
                        <span className="ml-2 text-[10px] text-[#7D757A] font-medium uppercase">
                          ({c.relation})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 text-[11px] text-[#6B6368]">
                      <span className="font-mono">{c.email}</span>
                    </div>
                  </div>
                ))}
                {contacts.length > 4 && (
                  <p className="text-[11px] text-center text-[#7D757A]">
                    + {contacts.length - 4} {language === 'hi' ? 'अन्य संपर्क' : language === 'mr' ? 'इतर संपर्क' : 'more contacts in safety circle'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
