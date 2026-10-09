import React, { useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit3,
  Mail,
  Phone,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  X,
  Shield,
  Clock,
  Sparkles,
} from 'lucide-react';
import { EmergencyContact, UserProfile } from '../types';
import {
  addContact,
  updateContact,
  deleteContact,
  reorderContacts,
} from '../services/contactService';
import { useLanguage } from '../i18n/LanguageContext';

interface ContactsProps {
  user: UserProfile;
  contacts: EmergencyContact[];
  onNavigate: (page: string) => void;
}

export const Contacts: React.FC<ContactsProps> = ({ user, contacts, onNavigate }) => {
  const { t, language } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState('Parent');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarColors = [
    'bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF]',
    'bg-[#F3ECE5] text-[#7D5A47] border border-[#E5D8CC]',
    'bg-[#EDF5F2] text-[#3D705C] border border-[#D5E8DF]',
    'bg-[#F0EEF8] text-[#63558A] border border-[#DBD6EE]',
    'bg-[#FDF2E9] text-[#915B2B] border border-[#F5DFCD]',
  ];

  const relationOptions = [
    { value: 'Parent', label: t('relationParent') },
    { value: 'Partner / Spouse', label: t('relationPartner') },
    { value: 'Sibling', label: t('relationSibling') },
    { value: 'Friend', label: t('relationFriend') },
    { value: 'Roommate', label: t('relationRoommate') },
    { value: 'Colleague', label: t('relationColleague') },
    { value: 'Guardian', label: t('relationGuardian') },
    { value: 'Neighbor', label: t('relationNeighbor') },
    { value: 'Other', label: t('relationOther') },
  ];

  const openAddModal = () => {
    setEditingContact(null);
    setName('');
    setEmail('');
    setRelation('Parent');
    setPhone('');
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (c: EmergencyContact) => {
    setEditingContact(c);
    setName(c.name);
    setEmail(c.email);
    setRelation(c.relation || 'Friend');
    setPhone(c.phone || '');
    setError(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName || !trimmedEmail) {
      setError(t('validationNameEmail'));
      return;
    }

    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setError(t('validationValidEmail'));
      return;
    }

    setLoading(true);
    try {
      if (editingContact) {
        await updateContact(
          editingContact.id,
          {
            name: trimmedName,
            email: trimmedEmail,
            relation,
            phone: trimmedPhone,
          },
          user.uid
        );
      } else {
        await addContact(user.uid, trimmedName, trimmedEmail, relation, trimmedPhone);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Error saving contact:', err);
      setError(err.message || 'Failed to save contact.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, contactName: string) => {
    if (window.confirm(t('deleteConfirm', { name: contactName }))) {
      try {
        await deleteContact(id, user.uid);
      } catch (err) {
        console.error('Error deleting contact:', err);
      }
    }
  };

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    if (reordering) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= contacts.length) return;

    const newContacts = [...contacts];
    const [moved] = newContacts.splice(index, 1);
    newContacts.splice(targetIndex, 0, moved);

    setReordering(true);
    try {
      await reorderContacts(user.uid, newContacts);
    } catch (err) {
      console.error('Error reordering contacts:', err);
    } finally {
      setReordering(false);
    }
  };

  const getInitials = (nameStr: string) => {
    if (!nameStr) return 'EC';
    const parts = nameStr.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return nameStr.slice(0, 2).toUpperCase();
  };

  const getPriorityLabel = (priorityIndex: number) => {
    if (priorityIndex === 0) return t('primaryResponderBadge');
    return t('priorityBadge', { num: priorityIndex + 1 });
  };

  const getDisplayRelation = (relStr?: string) => {
    if (!relStr) return t('relationFriend');
    const matched = relationOptions.find((r) => r.value.toLowerCase() === relStr.toLowerCase());
    return matched ? matched.label : relStr;
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <Users className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('priorityInfoTitle')}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#3A3A3A]">{t('contactsPageTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#6B6368] max-w-xl">
            {t('contactsPageSubtitle')}
          </p>
        </div>

        <button
          id="add-contact-header-btn"
          onClick={openAddModal}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addContactBtn')}</span>
        </button>
      </div>

      {/* Reordering / Priority explanation Banner */}
      {contacts.length > 1 && (
        <div className="bg-[#FAF6F3] border border-[#EFE8E1] p-4 rounded-2xl flex items-center justify-between gap-3 text-xs text-[#5A5558]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#9E4D71] shrink-0" />
            <span>
              <strong>{t('priorityInfoTitle')}:</strong> {t('priorityInfoDesc')}
            </span>
          </div>
          <span className="text-[11px] font-semibold text-[#7D757A] shrink-0">
            {t('contactsCountUnit', { count: contacts.length })}
          </span>
        </div>
      )}

      {/* Warning if 0 contacts */}
      {contacts.length === 0 && (
        <div className="bg-[#FFFDFB] border border-amber-300 p-4 rounded-2xl flex items-start space-x-3 text-amber-900 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm text-amber-900">{t('noContactsBannerTitle')}</h4>
            <p className="text-xs text-amber-800 leading-relaxed mt-0.5">
              {t('noContactsBannerDesc')}
            </p>
          </div>
        </div>
      )}

      {/* Contact Cards List with Priority Reordering */}
      {contacts.length === 0 ? (
        <div className="bg-white border border-[#EFE8E1] border-dashed rounded-3xl p-12 text-center space-y-3">
          <Users className="w-12 h-12 text-[#7D757A] mx-auto" />
          <h3 className="font-bold text-[#3A3A3A] text-base">{t('noContactsTitle')}</h3>
          <p className="text-xs text-[#6B6368] max-w-sm mx-auto">
            {t('noContactsSubtitle')}
          </p>
          <button
            id="empty-add-contact-btn"
            onClick={openAddModal}
            className="px-5 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs cursor-pointer"
          >
            {t('addContactNow')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map((c, idx) => {
            const colorClass = avatarColors[idx % avatarColors.length];
            const isFirst = idx === 0;
            const isLast = idx === contacts.length - 1;

            return (
              <div
                key={c.id}
                id={`contact-card-${c.id}`}
                className={`bg-white border p-5 rounded-2xl space-y-3 shadow-2xs transition-all relative ${
                  isFirst ? 'border-[#C88EA7] ring-1 ring-[#C88EA7]/30' : 'border-[#EFE8E1] hover:border-[#C88EA7]'
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  {/* Left: Priority Rank + Avatar + Details */}
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    {/* Priority Badge */}
                    <div className="flex flex-col items-center justify-center shrink-0">
                      <span
                        className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs ${
                          isFirst
                            ? 'bg-[#9E4D71] text-white shadow-xs'
                            : 'bg-[#FAF6F3] text-[#5A5558] border border-[#EFE8E1]'
                        }`}
                        title={getPriorityLabel(idx)}
                      >
                        #{idx + 1}
                      </span>
                    </div>

                    {/* Avatar Icon */}
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 shadow-2xs ${colorClass}`}
                    >
                      {getInitials(c.name)}
                    </div>

                    {/* Contact Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-[#3A3A3A] text-base truncate">{c.name}</h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            isFirst
                              ? 'bg-rose-50 text-rose-800 border border-rose-200'
                              : 'bg-[#FAF6F3] text-[#6B6368] border border-[#EFE8E1]'
                          }`}
                        >
                          {getPriorityLabel(idx)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#7D757A] mt-0.5">
                        <span className="font-semibold text-[#5A5558]">{getDisplayRelation(c.relation)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Reorder Up/Down & Action Buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    {/* Priority Controls */}
                    <div className="flex items-center bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl p-0.5 mr-2">
                      <button
                        id={`move-up-contact-${c.id}`}
                        type="button"
                        disabled={isFirst || reordering}
                        onClick={() => handleMovePriority(idx, 'up')}
                        title={t('moveUpLabel')}
                        className="p-1.5 rounded-lg text-[#5A5558] hover:text-[#9E4D71] hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#5A5558] transition-colors cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`move-down-contact-${c.id}`}
                        type="button"
                        disabled={isLast || reordering}
                        onClick={() => handleMovePriority(idx, 'down')}
                        title={t('moveDownLabel')}
                        className="p-1.5 rounded-lg text-[#5A5558] hover:text-[#9E4D71] hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#5A5558] transition-colors cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Edit Button */}
                    <button
                      id={`edit-contact-${c.id}`}
                      onClick={() => openEditModal(c)}
                      className="p-2 rounded-xl text-[#6B6368] hover:text-[#9E4D71] hover:bg-[#FAF6F3] border border-transparent hover:border-[#EFE8E1] transition-colors cursor-pointer"
                      title={t('editContactBtn')}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    {/* Delete Button */}
                    <button
                      id={`delete-contact-${c.id}`}
                      onClick={() => handleDelete(c.id, c.name)}
                      className="p-2 rounded-xl text-[#7D757A] hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                      title={t('deleteContactBtn')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Contact Communication Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 border-t border-[#EFE8E1] text-xs text-[#5A5558]">
                  <div className="flex items-center space-x-2 truncate">
                    <Mail className="w-3.5 h-3.5 text-[#9E4D71] shrink-0" />
                    <span className="font-mono text-[#3A3A3A] truncate">{c.email}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Phone className="w-3.5 h-3.5 text-[#9E4D71] shrink-0" />
                    <span className="text-[#3A3A3A]">
                      {c.phone ? c.phone : <span className="text-[#9E979B] italic">{language === 'hi' ? 'कोई फोन नंबर नहीं' : language === 'mr' ? 'फोन नंबर नाही' : 'No phone added'}</span>}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3A3A3A]/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white border border-[#EFE8E1] w-full max-w-md rounded-3xl p-6 text-[#3A3A3A] space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#EFE8E1] pb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center text-[#9E4D71]">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[#3A3A3A] text-lg">
                    {editingContact ? t('modalEditContactTitle') : t('modalAddContactTitle')}
                  </h3>
                  <p className="text-[11px] text-[#7D757A]">
                    {editingContact
                      ? (language === 'hi' ? 'नाम, फोन, संबंध और ईमेल अपडेट करें।' : language === 'mr' ? 'नाव, फोन, नाते आणि ईमेल बदला.' : 'Update name, phone number, relationship, and email.')
                      : (language === 'hi' ? 'अपने सुरक्षा मंडल में एक नया भरोसेमंद संपर्क जोड़ें।' : language === 'mr' ? 'तुमच्या सुरक्षा वर्तुळात नवीन संपर्क जोडा.' : 'Add a trusted responder to your safety circle.')}
                  </p>
                </div>
              </div>
              <button
                id="close-contact-modal-btn"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-[#7D757A] hover:text-[#3A3A3A] hover:bg-[#FAF6F3] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-xs text-rose-800 font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                  {t('contactNameLabel')}
                </label>
                <input
                  id="contact-name-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('contactNamePlaceholder')}
                  className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                  {t('contactRelationLabel')}
                </label>
                <select
                  id="contact-relation-select"
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors cursor-pointer"
                >
                  {relationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                  {t('contactEmailLabel')}
                </label>
                <input
                  id="contact-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('contactEmailPlaceholder')}
                  className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6368] mb-1">
                  {t('contactPhoneLabel')}
                </label>
                <input
                  id="contact-phone-input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('contactPhonePlaceholder')}
                  className="w-full px-3.5 py-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl text-sm text-[#3A3A3A] placeholder-[#9E979B] focus:outline-none focus:border-[#C88EA7] focus:bg-white transition-colors"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#EFE8E1]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-[#EFE8E1] text-xs font-semibold text-[#6B6368] hover:bg-[#FAF6F3] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  id="save-contact-submit-btn"
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? t('savingContactBtn') : t('saveContactSubmitBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
