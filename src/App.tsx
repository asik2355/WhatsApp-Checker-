import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Laptop, Smartphone, Lock, RefreshCw, Send, CheckCheck, 
  MessageSquare, UserPlus, LogOut, Copy, Check, MessageCircle, AlertTriangle, HelpCircle, Activity,
  Globe, ChevronDown, Search, Download, Users
} from 'lucide-react';
import { ConnectionState, Chat, Message } from './types';

interface Country {
  name: string;
  nameBn: string;
  code: string;
  flag: string;
  placeholder: string;
}

const COUNTRIES: Country[] = [
  // South Asia
  { name: 'Bangladesh', nameBn: 'বাংলাদেশ', code: '880', flag: '🇧🇩', placeholder: '1712345678' },
  { name: 'India', nameBn: 'ভারত', code: '91', flag: '🇮🇳', placeholder: '9876543210' },
  { name: 'Pakistan', nameBn: 'পাকিস্তান', code: '92', flag: '🇵🇰', placeholder: '3001234567' },
  { name: 'Nepal', nameBn: 'নেপাল', code: '977', flag: '🇳🇵', placeholder: '9801234567' },
  { name: 'Sri Lanka', nameBn: 'শ্রীলঙ্কা', code: '94', flag: '🇱🇰', placeholder: '712345678' },
  { name: 'Maldives', nameBn: 'মালদ্বীপ', code: '960', flag: '🇲🇻', placeholder: '7123456' },
  { name: 'Afghanistan', nameBn: 'আফগানিস্তান', code: '93', flag: '🇦🇫', placeholder: '701234567' },

  // Middle East & Gulf
  { name: 'Saudi Arabia', nameBn: 'সৌদি আরব', code: '966', flag: '🇸🇦', placeholder: '501234567' },
  { name: 'United Arab Emirates', nameBn: 'সংযুক্ত আরব আমিরাত', code: '971', flag: '🇦🇪', placeholder: '501234567' },
  { name: 'Oman', nameBn: 'ওমান', code: '968', flag: '🇴🇲', placeholder: '91234567' },
  { name: 'Qatar', nameBn: 'কাতার', code: '974', flag: '🇶🇦', placeholder: '33123456' },
  { name: 'Kuwait', nameBn: 'কুয়েত', code: '965', flag: '🇰🇼', placeholder: '51234567' },
  { name: 'Bahrain', nameBn: 'বাহরাইন', code: '973', flag: '🇧🇭', placeholder: '31234567' },
  { name: 'Iraq', nameBn: 'ইরাক', code: '964', flag: '🇮🇶', placeholder: '7901234567' },
  { name: 'Jordan', nameBn: 'জর্ডান', code: '962', flag: '🇯🇴', placeholder: '791234567' },
  { name: 'Lebanon', nameBn: 'লেবানন', code: '961', flag: '🇱🇧', placeholder: '3123456' },
  { name: 'Yemen', nameBn: 'ইয়েমেন', code: '967', flag: '🇾🇪', placeholder: '71234567' },

  // South East Asia & East Asia
  { name: 'Malaysia', nameBn: 'মালয়েশিয়া', code: '60', flag: '🇲🇾', placeholder: '123456789' },
  { name: 'Singapore', nameBn: 'সিঙ্গাপুর', code: '65', flag: '🇸🇬', placeholder: '81234567' },
  { name: 'Japan', nameBn: 'জাপান', code: '81', flag: '🇯🇵', placeholder: '9012345678' },
  { name: 'South Korea', nameBn: 'দক্ষিণ কোরিয়া', code: '82', flag: '🇰🇷', placeholder: '1012345678' },
  { name: 'Indonesia', nameBn: 'ইন্দোনেশিয়া', code: '62', flag: '🇮🇩', placeholder: '8123456789' },
  { name: 'Philippines', nameBn: 'ফিলিপাইন', code: '63', flag: '🇵🇭', placeholder: '9123456789' },
  { name: 'Thailand', nameBn: 'থাইল্যান্ড', code: '66', flag: '🇹🇭', placeholder: '812345678' },
  { name: 'Vietnam', nameBn: 'ভিয়েতনাম', code: '84', flag: '🇻🇳', placeholder: '912345678' },
  { name: 'Myanmar', nameBn: 'মিয়ানমার', code: '95', flag: '🇲🇲', placeholder: '912345678' },
  { name: 'Cambodia', nameBn: 'কম্বোডিয়া', code: '855', flag: '🇰🇭', placeholder: '12345678' },

  // Western Americas
  { name: 'United States', nameBn: 'মার্কিন যুক্তরাষ্ট্র', code: '1', flag: '🇺🇸', placeholder: '2015550123' },
  { name: 'Canada', nameBn: 'কানাডা', code: '1', flag: '🇨🇦', placeholder: '6135550123' },
  { name: 'Mexico', nameBn: 'মেক্সিকো', code: '52', flag: '🇲🇽', placeholder: '5512345678' },
  { name: 'Brazil', nameBn: 'ব্রাজিল', code: '55', flag: '🇧🇷', placeholder: '11912345678' },
  { name: 'Argentina', nameBn: 'আর্জেন্টিনা', code: '54', flag: '🇦🇷', placeholder: '91112345678' },
  { name: 'Colombia', nameBn: 'কলম্বিয়া', code: '57', flag: '🇨🇴', placeholder: '3001234567' },
  { name: 'Peru', nameBn: 'পেরু', code: '51', flag: '🇵🇪', placeholder: '912345678' },
  { name: 'Chile', nameBn: 'চিলি', code: '56', flag: '🇨🇱', placeholder: '912345678' },

  // Europe
  { name: 'United Kingdom', nameBn: 'যুক্তরাজ্য', code: '44', flag: '🇬🇧', placeholder: '7123456789' },
  { name: 'Italy', nameBn: 'ইতালি', code: '39', flag: '🇮🇹', placeholder: '3123456789' },
  { name: 'Spain', nameBn: 'স্পেন', code: '34', flag: '🇪🇸', placeholder: '612345678' },
  { name: 'France', nameBn: 'ফ্রান্স', code: '33', flag: '🇫🇷', placeholder: '612345678' },
  { name: 'Germany', nameBn: 'জার্মানি', code: '49', flag: '🇩🇪', placeholder: '15123456789' },
  { name: 'Turkey', nameBn: 'তুরস্ক', code: '90', flag: '🇹🇷', placeholder: '5321234567' },
  { name: 'Netherlands', nameBn: 'নেদারল্যান্ডস', code: '31', flag: '🇳🇱', placeholder: '612345678' },
  { name: 'Belgium', nameBn: 'বেলজিয়াম', code: '32', flag: '🇧🇪', placeholder: '412345678' },
  { name: 'Switzerland', nameBn: 'সুইজারল্যান্ড', code: '41', flag: '🇨🇭', placeholder: '712345678' },
  { name: 'Sweden', nameBn: 'সুইডেন', code: '46', flag: '🇸🇪', placeholder: '712345678' },
  { name: 'Portugal', nameBn: 'পর্তুগাল', code: '351', flag: '🇵🇹', placeholder: '912345678' },
  { name: 'Greece', nameBn: 'গ্রীস', code: '30', flag: '🇬🇷', placeholder: '6912345678' },
  { name: 'Austria', nameBn: 'অস্ট্রিয়া', code: '43', flag: '🇦🇹', placeholder: '650123456' },
  { name: 'Poland', nameBn: 'পোল্যান্ড', code: '48', flag: '🇵🇱', placeholder: '501234567' },
  { name: 'Russian Federation', nameBn: 'রাশিয়া', code: '7', flag: '🇷🇺', placeholder: '9123456789' },

  // Africa & Oceania
  { name: 'Australia', nameBn: 'অস্ট্রেলিয়া', code: '61', flag: '🇦🇺', placeholder: '412345678' },
  { name: 'New Zealand', nameBn: 'নিউজিল্যান্ড', code: '64', flag: '🇳🇿', placeholder: '211234567' },
  { name: 'South Africa', nameBn: 'দক্ষিণ আফ্রিকা', code: '27', flag: '🇿🇦', placeholder: '821234567' },
  { name: 'Egypt', nameBn: 'মিশর', code: '20', flag: '🇪🇬', placeholder: '1012345678' },
  { name: 'Nigeria', nameBn: 'নাইজেরিয়া', code: '234', flag: '🇳🇬', placeholder: '8012345678' },
  { name: 'Kenya', nameBn: 'কেনিয়া', code: '254', flag: '🇰🇪', placeholder: '701234567' },
  { name: 'Morocco', nameBn: 'মরক্কো', code: '212', flag: '🇲🇦', placeholder: '612345678' }
];

export default function App() {
  const [language, setLanguage] = useState<'bn' | 'en'>('bn');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [pairingCode, setPairingCode] = useState<string>('');
  
  // Custom universal country selector and editable dial code states
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [customCode, setCustomCode] = useState<string>('880');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [countrySearch, setCountrySearch] = useState<string>('');

  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [enteredPhoneNumber, setEnteredPhoneNumber] = useState<string>('');
  const [realBackendError, setRealBackendError] = useState<string>('');
  
  const [wsProfile, setWsProfile] = useState<{ name: string; phone: string } | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [webMessageInput, setWebMessageInput] = useState<string>('');
  
  // Custom dialog state for starting direct messaging with any number
  const [isDirectChatOpen, setIsDirectChatOpen] = useState<boolean>(false);
  const [directPhoneNum, setDirectPhoneNum] = useState<string>('');
  const [directChatName, setDirectChatName] = useState<string>('');
  const [directError, setDirectError] = useState<string>('');
  
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [sendingMsgId, setSendingMsgId] = useState<string | null>(null);

  // WhatsApp Presence Checker states
  const [isCheckerOpen, setIsCheckerOpen] = useState<boolean>(false);
  const [checkerPhoneNum, setCheckerPhoneNum] = useState<string>('');
  const [isCheckingAccount, setIsCheckingAccount] = useState<boolean>(false);
  const [checkerResult, setCheckerResult] = useState<{ exists: boolean; jid?: string; phone: string } | null>(null);
  const [checkerError, setCheckerError] = useState<string>('');

  // Bulk Checker states
  const [checkerTab, setCheckerTab] = useState<'single' | 'bulk'>('single');
  const [bulkInputText, setBulkInputText] = useState<string>('');
  const [isBulkChecking, setIsBulkChecking] = useState<boolean>(false);
  const [bulkResult, setBulkResult] = useState<{
    exists: { phone: string; jid: string; original: string }[];
    notExists: { phone: string; original: string }[];
    total: number;
  } | null>(null);
  const [bulkError, setBulkError] = useState<string>('');
  const [copiedType, setCopiedType] = useState<'exists' | 'notExists' | null>(null);

  // New multi-account states
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [currentActivePhoneState, setCurrentActivePhoneState] = useState<string | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Default active chats
  const [activeChats, setActiveChats] = useState<Chat[]>([
    {
      id: 'chat-self',
      name: 'My Saved Notes (আমার নোটস)',
      avatar: '📝',
      messages: [
        { id: 'm1', sender: 'them', text: 'এটি আপনার নিজস্ব সুরক্ষিত হোয়াটসঅ্যাপ রাইটার বুক। নিজেকে মেসেজ পাঠিয়ে এখানে রিয়েল-টাইম টেস্ট করতে পারবেন!', timestamp: '১১:১২ AM', status: 'read' }
      ],
      status: 'online',
      phone: '' 
    },
    {
      id: 'chat-assistant',
      name: 'Linkify AI Assistant',
      avatar: '🟢',
      messages: [
        { id: 'a1', sender: 'them', text: 'লিঙ্ক সফল হয়েছে! এখন আপনি যেকোনো নম্বরে সরাসরি আসল মেসেজ পাঠাতে পারবেন।', timestamp: '১১:১৩ AM', status: 'read' },
        { id: 'a2', sender: 'them', text: 'মেসেজ পাঠানোর সাথে সাথে রিয়েল-টাইমে মেলা ডাবল টিক দেখতে পাবেন।', timestamp: '১১:১৫ AM', status: 'read' }
      ],
      status: 'online',
      phone: '8801700000000'
    }
  ]);

  // Handle auto scroll for chat messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChatId, activeChats]);

  // Poll real status from the Express backend via `/api/status` and `/api/accounts`
  useEffect(() => {
    let intervalId: any;

    const checkRealStatus = async () => {
      try {
        const response = await fetch('/api/status');
        const statusType = response.headers.get("content-type");
        if (response.ok && statusType && statusType.includes("application/json")) {
          const data = await response.json();
          
          if (data.status === 'pairing-code-ready') {
            setConnectionState('phone-code-ready');
            setPairingCode(data.pairingCode);
            setEnteredPhoneNumber(data.phone);
          } else if (data.status === 'connected') {
            setConnectionState('connected');
            setWsProfile(data.profile);
            setEnteredPhoneNumber(data.phone);
            
            // Auto update self-chat phone with user's linked number
            if (data.profile?.phone) {
              setActiveChats(prev => prev.map(chat => {
                if (chat.id === 'chat-self') {
                  return { ...chat, phone: data.profile.phone, name: `${data.profile.name} (আমি)` };
                }
                return chat;
              }));
            }
          } else if (data.status === 'linking' || data.status === 'connecting') {
            setConnectionState('linking');
          } else if (data.status === 'error') {
            setConnectionState('disconnected');
            setRealBackendError(data.error || 'Failed connecting to WhatsApp servers.');
          } else if (data.status === 'disconnected') {
            if (connectionState === 'connected' || connectionState === 'phone-code-ready') {
              setConnectionState('disconnected');
              setWsProfile(null);
              setSelectedChatId(null);
            }
          }
        }

        // Parallel fetch for saved accounts list
        const accountsResponse = await fetch('/api/accounts');
        const accsType = accountsResponse.headers.get("content-type");
        if (accountsResponse.ok && accsType && accsType.includes("application/json")) {
          const accsData = await accountsResponse.json();
          setAccountsList(accsData.accounts || []);
          setCurrentActivePhoneState(accsData.currentActivePhone || null);
        }
      } catch (err) {
        // Safe logger: do not flood with HTML json parser exceptions during rebuild/cold-starts
        console.warn("Momentary status polling warning:", err);
      }
    };

    checkRealStatus();
    intervalId = setInterval(checkRealStatus, 1500);

    return () => clearInterval(intervalId);
  }, [connectionState]);

  // Helper to sanitize and format international numbers
  const sanitizeInternationalPhone = (cc: string, phone: string) => {
    const cleanCC = cc.replace(/\D/g, "");
    let cleanPhone = phone.replace(/\D/g, "");
    
    // Remove leading zeroes from national number
    while (cleanPhone.startsWith("0")) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    // If the phone number already starts with the country code, strip it
    if (cleanPhone.startsWith(cleanCC) && cleanPhone.length > cleanCC.length) {
      cleanPhone = cleanPhone.substring(cleanCC.length);
      while (cleanPhone.startsWith("0")) {
        cleanPhone = cleanPhone.substring(1);
      }
    }
    
    return `${cleanCC}${cleanPhone}`;
  };

  // Request pairing code from core service
  const handleGeneratePairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCC = customCode.replace(/\D/g, "");
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    
    if (!cleanCC) {
      setRealBackendError(language === 'bn' ? 'অনুগ্রহ করে সঠিক কান্ট্রি কোড ইনপুট দিন।' : 'Please select or type a valid country code.');
      return;
    }

    if (!cleanPhone) {
      setRealBackendError(language === 'bn' ? 'অনুগ্রহ করে সঠিক মোবাইল নম্বর দিন।' : 'Please provide a valid phone number.');
      return;
    }

    const cleaned = sanitizeInternationalPhone(cleanCC, cleanPhone);
    if (cleaned.length < 8) {
      setRealBackendError(language === 'bn' ? 'অনুগ্রহ করে সঠিক মোবাইল নম্বর দিন।' : 'Please provide a valid phone number (at least 8 digits).');
      return;
    }

    setRealBackendError('');
    setSubmitting(true);
    setConnectionState('linking');

    try {
      const response = await fetch(`/api/request-code?phone=${encodeURIComponent(cleaned)}`);
      if (response.ok) {
        setEnteredPhoneNumber(cleaned);
      } else {
        const err = await response.json();
        setRealBackendError(err.error || 'Failed requesting code.');
        setConnectionState('disconnected');
      }
    } catch (err: any) {
      setRealBackendError(err.message || 'Network error.');
      setConnectionState('disconnected');
    } finally {
      setSubmitting(false);
    }
  };

  // Reset pairing session and wipe configuration values
  const handleResetSession = async () => {
    try {
      setConnectionState('linking');
      await fetch('/api/reset-session');
      setConnectionState('disconnected');
      setPairingCode('');
      setPhoneNumber('');
      setSelectedChatId(null);
    } catch (e) {
      console.error("Error resetting session:", e);
      setConnectionState('disconnected');
    }
  };

  // Switch to a different saved WhatsApp account
  const handleSwitchAccount = async (phone: string) => {
    try {
      setSubmitting(true);
      setConnectionState('linking');
      const response = await fetch('/api/switch-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentActivePhoneState(data.currentActivePhone);
        
        // Immediately fetch the new status to transition UI
        const statusResponse = await fetch('/api/status');
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (statusData.status === 'connected') {
            setConnectionState('connected');
            setWsProfile(statusData.profile);
          } else if (statusData.status === 'pairing-code-ready') {
            setConnectionState('phone-code-ready');
            setPairingCode(statusData.pairingCode);
          } else {
            setConnectionState('linking');
          }
        }
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to switch account.');
        setConnectionState('disconnected');
      }
    } catch (err: any) {
      console.error("Error switching account:", err);
      setConnectionState('disconnected');
    } finally {
      setSubmitting(false);
      setIsAccountMenuOpen(false);
    }
  };

  // Delete/Wipe a saved account from database
  const handleDeleteAccount = async (phone: string) => {
    const confirmMsg = language === 'bn'
      ? `আপনি কি নিশ্চিতভাবে এই অ্যাকাউন্টটি লোকাল ডাটাবেজ থেকে মুছে ফেলতে চান? +${phone}`
      : `Are you sure you want to delete and wipe this account from the local database? +${phone}`;
    
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
      });
      if (response.ok) {
        // Find if we deleted the active phone
        if (currentActivePhoneState === phone) {
          setConnectionState('disconnected');
          setWsProfile(null);
          setSelectedChatId(null);
        }
        
        // Refresh accounts list
        const accountsResponse = await fetch('/api/accounts');
        if (accountsResponse.ok) {
          const accsData = await accountsResponse.json();
          setAccountsList(accsData.accounts || []);
          setCurrentActivePhoneState(accsData.currentActivePhone || null);
        }
      }
    } catch (err) {
      console.error("Error deleting account:", err);
    }
  };

  // Utility to copy the code safely
  const handleCopyCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode.replace('-', ''));
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
  };

  // Instant messaging sender directly linked to real cell numbers
  const handleSendMessage = async () => {
    if (!webMessageInput.trim() || !selectedChatId) return;

    const chat = activeChats.find(c => c.id === selectedChatId);
    if (!chat) return;

    // Build immediate message card to put on front views
    const tempId = Date.now().toString();
    const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMessage: Message = {
      id: tempId,
      sender: 'me',
      text: webMessageInput.trim(),
      timestamp: formattedTime,
      status: 'sent'
    };

    // Append localized input to front display state
    setActiveChats(prev => prev.map(c => {
      if (c.id === selectedChatId) {
        return {
          ...c,
          messages: [...c.messages, userMessage]
        };
      }
      return c;
    }));

    const messageText = webMessageInput.trim();
    setWebMessageInput('');
    setSendingMsgId(tempId);

    // Target real cell phone receiver
    let destinationPayload = chat.phone;
    if (!destinationPayload && chat.id === 'chat-self' && wsProfile) {
      destinationPayload = wsProfile.phone;
    }

    if (destinationPayload) {
      try {
        const response = await fetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: destinationPayload, text: messageText })
        });

        if (response.ok) {
          // Double blue ticks confirmation simulation after brief delay to represent internet ACK latency
          setTimeout(() => {
            setActiveChats(prev => prev.map(c => {
              if (c.id === selectedChatId) {
                return {
                  ...c,
                  messages: c.messages.map(m => m.id === tempId ? { ...m, status: 'read' as const } : m)
                };
              }
              return c;
            }));
            setSendingMsgId(null);
          }, 600);
        } else {
          // Alert user of failures
          const data = await response.json();
          alert(`মেসেজ পাঠানো সম্ভব হয়নি: ${data.error || 'ডিসকানেক্ট অবস্থা'}`);
          setSendingMsgId(null);
        }
      } catch (err) {
        console.error("Transmitting error:", err);
        setSendingMsgId(null);
      }
    } else {
      // Offline/simulation reply handler
      setTimeout(() => {
        const ackMessage: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'them',
          text: language === 'bn' 
            ? 'এটি একটি অফলাইন সিমুলেশন রেসপন্স। আসল মেসেজ পাঠাতে দয়া করে আপনার ডিভাইসে সেশনটি সফলভাবে লিংক করুন।'
            : 'This is an offline simulation response. To transmit real WhatsApp messages, please complete pairing process.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'read'
        };

        setActiveChats(prev => prev.map(c => {
          if (c.id === selectedChatId) {
            return {
              ...c,
              messages: [...c.messages, ackMessage]
            };
          }
          return c;
        }));
        setSendingMsgId(null);
      }, 1000);
    }
  };

  // Launch a direct messaging chat with any number of choice
  const handleAddNewDirectChat = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNum = directPhoneNum.replace(/\D/g, "");
    if (!cleanNum || cleanNum.length < 8) {
      setDirectError(language === 'bn' ? 'সঠিক নম্বর ইনপুট দিন।' : 'Enter a correct phone number.');
      return;
    }

    // Check if chat already exists
    const existing = activeChats.find(c => c.phone === cleanNum);
    if (existing) {
      setSelectedChatId(existing.id);
      setIsDirectChatOpen(false);
      setDirectPhoneNum('');
      setDirectChatName('');
      setDirectError('');
      return;
    }

    const newId = `chat-direct-${Date.now()}`;
    const displayName = directChatName.trim() || `+${cleanNum}`;

    const newChat: Chat = {
      id: newId,
      name: displayName,
      avatar: '👤',
      messages: [
        { id: 'init-msg', sender: 'them', text: `এই নম্বরের সাথে সরাসরি ক্যাটবেক্স থ্রেড খোলা হয়েছে: +${cleanNum}। এখন রিয়েল মেসেজ পাঠাতে পারেন।`, timestamp: 'Now', status: 'read' }
      ],
      status: 'offline',
      phone: cleanNum
    };

    setActiveChats(prev => [newChat, ...prev]);
    setSelectedChatId(newId);
    setIsDirectChatOpen(false);
    setDirectPhoneNum('');
    setDirectChatName('');
    setDirectError('');
  };

  // Check if a phone number possesses a real WhatsApp account
  const handleCheckWhatsAppAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNum = checkerPhoneNum.replace(/\D/g, "");
    if (!cleanNum || cleanNum.length < 8) {
      setCheckerError(language === 'bn' ? 'সঠিক নম্বর ইনপুট দিন (কমপক্ষে ৮ ডিজিট হতে হবে)।' : 'Please enter a valid phone number (at least 8 digits).');
      return;
    }

    setCheckerError('');
    setCheckerResult(null);
    setIsCheckingAccount(true);

    try {
      const response = await fetch(`/api/check-phone?phone=${encodeURIComponent(cleanNum)}`);
      if (response.ok) {
        const data = await response.json();
        setCheckerResult(data);
      } else {
        const err = await response.json();
        setCheckerError(err.error || (language === 'bn' ? 'যাচাই করা সম্ভব হয়নি। কান্ট্রি কোড সহ নম্বরটি সঠিক আছে কি না এবং আপনার সেশন লাইভ কি না চেক করুন।' : 'Verification failed. Make sure you are connected properly and the session is active.'));
      }
    } catch (err: any) {
      setCheckerError(err.message || 'Verification failed due to a network connection error.');
    } finally {
      setIsCheckingAccount(false);
    }
  };

  // Check multiple phone numbers in bulk
  const handleCheckBulkAccounts = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError('');
    setBulkResult(null);

    // Robust extraction: find all digit blocks of length 7 to 16 (matches CSV rows, copy-pastes, etc.)
    let cleanMatches = bulkInputText.match(/\+?\d{7,16}/g) || [];
    if (cleanMatches.length === 0) {
      // Fallback to normal separator split for shorter/local numbers
      cleanMatches = bulkInputText
        .split(/[\n,;\s]+/)
        .map(n => n.trim())
        .filter(n => n.length >= 5);
    }
    const rawPhones = Array.from(new Set(cleanMatches.map(n => n.trim())));

    if (rawPhones.length === 0) {
      setBulkError(language === 'bn' 
        ? 'দয়া করে কিছু নম্বর লিখুন (প্রতি লাইনে বা কমা দিয়ে)।' 
        : 'Please enter at least one valid phone number (separated by newlines or commas).');
      return;
    }

    // Limit check to 1000 items
    let phonesToQuery = rawPhones;
    if (rawPhones.length > 1000) {
      phonesToQuery = rawPhones.slice(0, 1000);
    }

    setIsBulkChecking(true);

    try {
      const response = await fetch('/api/check-phone-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phones: phonesToQuery }),
      });

      if (response.ok) {
        const data = await response.json();
        setBulkResult(data);

        // Generate assistant message report
        const hasExists = data.exists && data.exists.length > 0;
        const hasNotExists = data.notExists && data.notExists.length > 0;

        const now = new Date();
        const banglaTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
        const englishTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const textTime = language === 'bn' ? banglaTime : englishTime;

        const reportText = language === 'bn'
          ? `🤖 *বাল্ক নম্বর চেকার রিপোর্ট (Bulk Report)*\n\n` +
            `📊 *মোট ইউনিক নম্বর:* ${data.total} টি\n` +
            `✅ *সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট রয়েছে (${data.exists?.length || 0} টি):*\n` +
            `${hasExists ? data.exists.map((item: any) => `+${item.phone}`).join('\n') : 'কোনোটিই নয়'}\n\n` +
            `❌ *হোয়াটসঅ্যাপ খোলা নেই (${data.notExists?.length || 0} টি):*\n` +
            `${hasNotExists ? data.notExists.map((item: any) => item.phone || item.original).join('\n') : 'কোনোটিই নয়'}`
          : `🤖 *Bulk Account Verification Report*\n\n` +
            `📊 *Total Unique Numbers:* ${data.total}\n` +
            `✅ *Registered on WhatsApp (${data.exists?.length || 0}):*\n` +
            `${hasExists ? data.exists.map((item: any) => `+${item.phone}`).join('\n') : 'None'}\n\n` +
            `❌ *Not Registered (${data.notExists?.length || 0}):*\n` +
            `${hasNotExists ? data.notExists.map((item: any) => item.phone || item.original).join('\n') : 'None'}`;

        setActiveChats(prev => prev.map(chat => {
          if (chat.id === 'chat-assistant') {
            return {
              ...chat,
              messages: [
                ...chat.messages,
                {
                  id: `bulk-report-${Date.now()}`,
                  sender: 'them',
                  text: reportText,
                  timestamp: textTime,
                  status: 'read'
                }
              ]
            };
          }
          return chat;
        }));

        // Focus the chatbot so the user sees the report in real-time
        setSelectedChatId('chat-assistant');

        if (rawPhones.length > 1000) {
          setBulkError(language === 'bn'
            ? '১০টি থেকে সর্বোচ্চ ১০০০টি নম্বর একসাথে চেক করা যাবে। অবশিষ্ট নম্বর বাদ দিয়ে প্রথম ১০০০টি যাচাই করা হয়েছে।'
            : 'Max 1000 numbers allowed. Checking has been limited to first 1000 entries.');
        }
      } else {
        const err = await response.json();
        setBulkError(err.error || (language === 'bn' ? 'বাল্ক যাচাই করা সম্ভব হয়নি।' : 'Bulk verification failed.'));
      }
    } catch (err: any) {
      setBulkError(err.message || 'Bulk check failed due to connection errors.');
    } finally {
      setIsBulkChecking(false);
    }
  };

  const getExtractedBulkCount = () => {
    if (!bulkInputText.trim()) return 0;
    let cleanMatches = bulkInputText.match(/\+?\d{7,16}/g) || [];
    if (cleanMatches.length === 0) {
      cleanMatches = bulkInputText
        .split(/[\n,;\s]+/)
        .map(n => n.trim())
        .filter(n => n.length >= 5);
    }
    return new Set(cleanMatches.map(n => n.trim())).size;
  };

  const handleDownloadBulkResult = (type: 'exists' | 'notExists') => {
    if (!bulkResult) return;
    const list = type === 'exists' ? bulkResult.exists : bulkResult.notExists;
    const content = list.map(item => item.phone || item.original).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = type === 'exists' ? 'active_whatsapp_numbers.txt' : 'inactive_whatsapp_numbers.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyBulkResult = (type: 'exists' | 'notExists') => {
    if (!bulkResult) return;
    const list = type === 'exists' ? bulkResult.exists : bulkResult.notExists;
    const content = list.map(item => item.phone || item.original).join('\n');
    navigator.clipboard.writeText(content).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    }).catch(err => {
      console.error("Failed to copy lists: ", err);
    });
  };

  // Convert check result to an active chat panel instantly
  const handleCreateChatFromChecker = (phone: string) => {
    const cleanNum = phone.replace(/\D/g, "");
    const existing = activeChats.find(c => c.phone === cleanNum);
    if (existing) {
      setSelectedChatId(existing.id);
      setIsCheckerOpen(false);
      setCheckerPhoneNum('');
      setCheckerResult(null);
      setCheckerError('');
      return;
    }

    const newId = `chat-direct-${Date.now()}`;
    const newChat: Chat = {
      id: newId,
      name: `+${cleanNum}`,
      avatar: '👤',
      messages: [
        { id: 'init-msg', sender: 'them', text: `এই নম্বরের সাথে সরাসরি চ্যাট থ্রেড খোলা হয়েছে: +${cleanNum}। এখন রিয়েল মেসেজ পাঠাতে পারেন।`, timestamp: 'Now', status: 'read' }
      ],
      status: 'online',
      phone: cleanNum
    };

    setActiveChats(prev => [newChat, ...prev]);
    setSelectedChatId(newId);
    setIsCheckerOpen(false);
    setCheckerPhoneNum('');
    setCheckerResult(null);
    setCheckerError('');
  };

  const currentChatObj = activeChats.find(c => c.id === selectedChatId);

  return (
    <div className="min-h-screen bg-[#0c1317] text-[#e9edef] flex flex-col font-sans selection:bg-[#00a884]/40">
      
      {/* Top Emerald Header Accent Ribbon */}
      <div className="bg-[#00a884] h-32 w-full absolute top-0 left-0 z-0"></div>

      {/* Main Content Workspace Container */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 py-8 flex-1 flex flex-col justify-center min-h-screen">
        
        {/* Subtle Branding Header row */}
        <header className="mb-6 flex justify-between items-center text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-700/60 p-2 rounded-xl border border-emerald-500/20 backdrop-blur-md">
              <MessageCircle className="w-6 h-6 text-emerald-200" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">WhatsApp Web Linker</h1>
              <p className="text-[10px] text-emerald-100 opacity-85">
                {language === 'bn' ? 'আসল হোয়াটসঅ্যাপ সেশন কানেক্টিভিটি টুল' : 'Official WhatsApp Session Web Client'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Real status indicator badge */}
            <div className="bg-emerald-900/60 p-1.5 px-3 rounded-full border border-emerald-500/10 text-[10px] flex items-center gap-1.5 font-mono">
              <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-400 animate-pulse'}`}></span>
              <span className="uppercase text-emerald-200">{connectionState}</span>
            </div>

            {/* Language toggle button */}
            <button
              onClick={() => setLanguage(language === 'bn' ? 'en' : 'bn')}
              className="bg-emerald-800 hover:bg-emerald-700 font-semibold px-2.5 py-1 text-xs rounded-md border border-emerald-500/20 tracking-wider transition outline-none cursor-pointer"
            >
              {language === 'bn' ? 'ENGLISH' : 'বাংলা'}
            </button>
          </div>
        </header>

        {/* Dynamic Display Area based on connection state */}
        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">

            {/* STATUS 1: DISCONNECTED LANDING (Phone Input Box) */}
            {connectionState === 'disconnected' && (
              <motion.div
                key="disconnected-landing"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: -10, y: -15 }}
                transition={{ duration: 0.25 }}
                className="w-full max-w-lg mx-auto bg-[#222e35] rounded-3xl border border-slate-800 shadow-2xl p-6 md:p-8 space-y-6"
              >
                <div className="text-center space-y-2">
                  <div className="mx-auto w-16 h-16 rounded-full bg-[#111b21] border border-slate-800 flex items-center justify-center shadow-lg text-[#00a884]">
                    <Laptop className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold tracking-tight text-gray-100">
                    {language === 'bn' ? 'কানেক্ট করুন হোয়াটসঅ্যাপ' : 'Connect your WhatsApp'}
                  </h2>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                    {language === 'bn' 
                      ? 'নিচে মোবাইল নম্বরটি দিলে অ্যাপটি সরাসরি আসল হোয়াটসঅ্যাপ থেকে একটি অফিশিয়াল লিঙ্কিং কোড এনে দিবে।' 
                      : 'Provide your phone number to request a secure, official pairing code directly from WhatsApp server.'}
                  </p>
                </div>

                <form onSubmit={handleGeneratePairingCode} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#00a884] block font-mono">
                      {language === 'bn' ? 'হোয়াটসঅ্যাপ নম্বর লিখুন:' : 'WhatsApp Phone Number:'}
                    </label>
                    <div className="flex gap-2 relative">
                      {/* Flag select button */}
                      <div className="relative flex-none">
                        <button
                          type="button"
                          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                          className="h-12 bg-[#111b21] border border-slate-800 hover:border-slate-700 rounded-xl px-3 flex items-center justify-between gap-1.5 focus:outline-none focus:ring-1 focus:ring-[#00a884] text-sm text-gray-200 transition cursor-pointer select-none"
                          title="Select Country"
                        >
                          <span className="text-lg leading-none">{selectedCountry.flag}</span>
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        </button>

                        {isDropdownOpen && (
                          <>
                            {/* Click outside to close */}
                            <div className="fixed inset-0 z-40" onClick={() => {
                              setIsDropdownOpen(false);
                              setCountrySearch('');
                            }}></div>
                            
                            {/* Dropdown list popup dialog */}
                            <div className="absolute top-full mt-2 left-0 w-64 bg-[#202c33] border border-slate-800 rounded-2xl shadow-2xl z-50 p-2.5 space-y-2 max-h-72 flex flex-col">
                              {/* Search input bar */}
                              <div className="relative flex-none">
                                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                                <input
                                  type="text"
                                  placeholder={language === 'bn' ? 'দেশ / কোড খুঁজুন...' : 'Search country...'}
                                  value={countrySearch}
                                  onChange={(e) => setCountrySearch(e.target.value)}
                                  className="w-full bg-[#111b21] border border-slate-850 focus:border-[#00a884] pl-8 pr-3 py-1.5 rounded-lg text-xs font-sans text-gray-200 placeholder:text-slate-650 focus:outline-none"
                                />
                              </div>

                              {/* Countries elements viewport */}
                              <div className="overflow-y-auto flex-1 space-y-0.5 pr-1 py-1 scrollbar-thin scrollbar-thumb-slate-850">
                                {COUNTRIES.filter(c => 
                                  c.name.toLowerCase().includes(countrySearch.toLowerCase()) || 
                                  c.nameBn.includes(countrySearch) || 
                                  c.code.includes(countrySearch)
                                ).map((cnt) => (
                                  <button
                                    key={cnt.name}
                                    type="button"
                                    onClick={() => {
                                      setSelectedCountry(cnt);
                                      setCustomCode(cnt.code);
                                      setIsDropdownOpen(false);
                                      setCountrySearch('');
                                    }}
                                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[#111b21] text-xs text-left transition text-gray-300"
                                  >
                                    <span className="flex items-center gap-2 truncate">
                                      <span className="text-base">{cnt.flag}</span>
                                      <span className="truncate">{language === 'bn' ? cnt.nameBn : cnt.name}</span>
                                    </span>
                                    <span className="text-slate-500 font-mono font-semibold shrink-0">+{cnt.code}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Explicitly Editable Country Code input box */}
                      <div className="relative w-24 flex-none font-sans">
                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-xs font-semibold text-slate-500 font-mono">
                          +
                        </div>
                        <input
                          type="tel"
                          required
                          value={customCode}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setCustomCode(val);
                            const matched = COUNTRIES.find(c => c.code === val);
                            if (matched) {
                              setSelectedCountry(matched);
                            } else {
                              setSelectedCountry({
                                name: 'Custom Code',
                                nameBn: 'অন্য কান্ট্রি',
                                code: val,
                                flag: '🌐',
                                placeholder: 'Phone Number'
                              });
                            }
                          }}
                          className="w-full h-12 bg-[#111b21] border border-slate-800 hover:border-slate-700 focus:border-[#00a884] text-gray-200 font-mono font-bold text-center pl-6 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884] transition"
                          placeholder="Code"
                          title={language === 'bn' ? 'কান্ট্রি ডায়াল কোড' : 'Country dial prefix code'}
                        />
                      </div>

                      {/* Phone line numbers segment */}
                      <div className="flex-1 relative">
                        <input
                          type="tel"
                          required
                          placeholder={selectedCountry.placeholder}
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full h-12 bg-[#111b21] border border-slate-800 hover:border-slate-700 focus:border-[#00a884] text-gray-200 placeholder:text-slate-650 font-mono font-bold rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-[#00a884] transition"
                        />
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-550 block leading-tight text-left">
                      {language === 'bn' 
                        ? 'বামপাশে আপনার দেশ সিলেক্ট করুন অথবা যেকোন আন্তর্জাতিক কোড সরাসরি লিখে আপনার মোবাইল নাম্বারটি দিন।' 
                        : 'Select flag on left or type any global country code, then insert rest of the phone number.'}
                    </span>
                  </div>

                  {realBackendError && (
                    <div className="bg-rose-950/40 border border-rose-800/20 text-rose-300 text-xs rounded-xl p-3 flex items-start gap-2.5 leading-relaxed font-sans animate-shake">
                      <AlertTriangle className="w-4 h-4 flex-none text-rose-400 mt-0.5" />
                      <div>
                        <span className="font-bold">{language === 'bn' ? 'ত্রুটি:' : 'Connection Error:'}</span> {realBackendError}
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#00a884] hover:bg-[#00c298] text-gray-950 font-bold tracking-tight rounded-xl py-3 px-4 text-xs select-none shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                  >
                    {submitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-gray-950" />
                        <span>{language === 'bn' ? 'কানেক্ট করা হচ্ছে...' : 'Initializing tunnel...'}</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 text-gray-950" />
                        <span>{language === 'bn' ? 'কানেক্ট করুন (কোড নিন)' : 'Link with phone number'}</span>
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-2 border-t border-slate-800/50 flex justify-between items-center text-[10px] text-slate-500 font-mono">
                  <span className="flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-slate-600" />
                    End-to-End Encrypted Secure Connection
                  </span>
                  <span>Baileys Socket Core</span>
                </div>

                {/* 1. SAVED LOCAL ACCOUNTS SECTION */}
                <div className="w-full max-w-lg mx-auto mt-6 bg-[#111b21] rounded-3xl border border-slate-800/60 p-5 space-y-4">
                  <h3 className="text-xs font-bold font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-2 border-b border-slate-800/60 pb-2">
                    <Smartphone className="w-4 h-4 text-emerald-450" />
                    <span>{language === 'bn' ? 'সংরক্ষিত অ্যাকাউন্টসমূহ (Database Accounts)' : 'Saved Local Accounts'}</span>
                    <span className="ml-auto bg-emerald-950 text-[#00a884] text-[10px] px-2.5 py-0.5 rounded-full border border-emerald-900/20 font-bold font-mono">
                      {accountsList.length}
                    </span>
                  </h3>

                  {accountsList.length > 0 ? (
                    <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                      {accountsList.map((acc) => {
                        const isCurrentActive = currentActivePhoneState === acc.phone;
                        const statusBadgeColor = acc.status === 'connected' ? 'bg-green-400' : acc.status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500';
                        return (
                          <div 
                            key={acc.phone} 
                            className={`p-3 rounded-xl border flex items-center justify-between transition ${
                              isCurrentActive 
                                ? 'bg-[#222e35] border-emerald-500/40' 
                                : 'bg-[#1e2a30]/50 border-slate-850 hover:bg-[#1e2a30]'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-emerald-950/40 border border-emerald-900/30 text-[#00a884] font-black flex items-center justify-center text-xs">
                                {acc.name ? acc.name.substring(0, 2).toUpperCase() : 'WA'}
                              </div>
                              <div className="leading-tight text-left text-xs text-left">
                                <p className="font-bold text-gray-200">
                                  {acc.name || 'WhatsApp User'}
                                </p>
                                <p className="text-[10px] text-gray-400 font-mono">
                                  +{acc.phone}
                                </p>
                                {acc.addedByName && (
                                  <p className="text-[9px] text-[#00a884] font-semibold mt-0.5">
                                    {language === 'bn' ? `যোগ করেছেন: ${acc.addedByName}` : `Added by: ${acc.addedByName}`}
                                    {acc.addedByChatId ? ` (${acc.addedByChatId})` : ''}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {/* Status badge */}
                              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#111b21] border border-slate-800 text-[9px] font-semibold text-slate-300">
                                <span className={`w-1.5 h-1.5 rounded-full ${statusBadgeColor}`}></span>
                                <span className="capitalize text-[8.5px]">{acc.status}</span>
                              </span>

                              {/* Switch option */}
                              {acc.status === 'connected' && !isCurrentActive ? (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchAccount(acc.phone)}
                                  className="p-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-700 font-bold text-[9px] text-gray-950 transition cursor-pointer font-sans"
                                >
                                  {language === 'bn' ? 'ড্যাশবোর্ড' : 'Enter'}
                                </button>
                              ) : isCurrentActive ? (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchAccount(acc.phone)}
                                  className="p-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-700 font-bold text-[9px] text-gray-950 transition cursor-pointer font-sans"
                                >
                                  {language === 'bn' ? 'সক্রিয়' : 'Active'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchAccount(acc.phone)}
                                  className="p-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 font-bold text-[9px] text-gray-250 transition cursor-pointer font-sans"
                                >
                                  {language === 'bn' ? 'কানেক্ট' : 'Activate'}
                                </button>
                              )}

                              {/* Delete button option */}
                              <button
                                type="button"
                                onClick={() => handleDeleteAccount(acc.phone)}
                                className="p-1 bg-[#111b21] hover:bg-rose-500/10 border border-slate-850 hover:border-rose-500/20 rounded text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                title={language === 'bn' ? 'মুছে ফেলুন' : 'Delete account'}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-[#1e2a30]/30 border border-dashed border-slate-800/80 text-center space-y-2">
                      <div className="w-8 h-8 rounded-full bg-[#111b21] flex items-center justify-center mx-auto text-slate-600">
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <p className="text-xs text-gray-400">
                        {language === 'bn' 
                          ? 'কোনো অ্যাকাউন্ট সংরক্ষিত নেই সেশন হিসেবে।' 
                          : 'No accounts are saved in the local session database.'}
                      </p>
                      <p className="text-[10px] text-gray-500 max-w-sm mx-auto">
                        {language === 'bn' 
                          ? 'ড্যাশবোর্ড দিয়ে প্রথম অ্যাকাউন্টটি সিঙ্ক করুন।' 
                          : 'Pair your first WhatsApp session using the Web interface above.'}
                      </p>
                    </div>
                  )}
                </div>

              </motion.div>
            )}

            {/* STATUS 2: SECURE TUNNEL HANDSHAKE (Linking state feedback loader) */}
            {connectionState === 'linking' && (
              <motion.div
                key="linking-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full max-w-sm mx-auto bg-[#222e35] rounded-3xl border border-slate-800 p-8 text-center space-y-6"
              >
                <div className="relative flex items-center justify-center h-20">
                  <div className="absolute w-16 h-16 rounded-full border-2 border-dashed border-[#00a884] animate-spin"></div>
                  <Smartphone className="w-8 h-8 text-[#00a884] animate-pulse" />
                </div>
                
                <div className="space-y-1.5 font-sans">
                  <h3 className="font-bold text-lg text-gray-100">
                    {language === 'bn' ? 'সংযোগ তৈরি হচ্ছে...' : 'Establishing Live Link'}
                  </h3>
                  <p className="text-xs text-gray-400 font-mono text-[11px] leading-relaxed">
                    [TUNNEL CORES] Handshaking secure credential token keys with official WhatsApp Web WebSockets API...
                  </p>
                </div>
              </motion.div>
            )}

            {/* STATUS 3: PAIRING CODE DISCOVERY (Shows Real Code from WhatsApp) */}
            {connectionState === 'phone-code-ready' && (
              <motion.div
                key="pairing-discovery"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="w-full max-w-2xl mx-auto bg-[#222e35] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12"
              >
                {/* Visual Code display panel */}
                <div className="md:col-span-5 bg-[#111b21] p-6 flex flex-col items-center justify-center text-center space-y-5 border-r border-slate-800/40">
                  <span className="p-1 px-2.5 text-[9px] font-mono rounded bg-emerald-950/60 text-[#00a884] border border-emerald-800/40 font-bold uppercase tracking-wider">
                    Pairing Ticket Code
                  </span>

                  <div className="space-y-1">
                    <span className="text-xs text-gray-400 leading-normal block">
                      {language === 'bn' ? 'আপনার মোবাইলে ইনপুট করুন:' : 'Type this on your phone:'}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono block">
                      (+{enteredPhoneNumber})
                    </span>
                  </div>

                  {/* Gigantic Alphanumeric code split block */}
                  <div className="relative group w-full">
                    <div className="p-4 bg-[#222e35]/50 border-2 border-dashed border-emerald-500/30 rounded-2xl flex items-center justify-center select-all">
                      <span className="text-2xl md:text-3xl font-mono font-extrabold tracking-widest text-[#00a884]">
                        {pairingCode}
                      </span>
                    </div>

                    <button
                      onClick={handleCopyCode}
                      className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500 transition cursor-pointer"
                      title="Copy linking code"
                    >
                      {copiedSuccess ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>
                  </div>

                  {/* Pulsing real-time heartbeat connection state tracker */}
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono py-1">
                    <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>
                      {language === 'bn' ? 'সংযোগের জন্য অপেক্ষা করা হচ্ছে...' : 'Waiting on WhatsApp network...'}
                    </span>
                  </div>

                  <button
                    onClick={handleResetSession}
                    className="text-[10px] font-semibold text-rose-400 hover:text-rose-300 hover:underline transition cursor-pointer"
                  >
                    {language === 'bn' ? 'সেশন বাতিল করুন' : 'Cancel pairing session'}
                  </button>
                </div>

                {/* Instructions panel list */}
                <div className="md:col-span-7 p-6 md:p-8 space-y-5 flex flex-col justify-between">
                  <div className="space-y-3 block">
                    <h3 className="text-base font-bold text-gray-100 flex items-center gap-1.5 leading-tight">
                      <Smartphone className="w-5 h-5 text-[#00a884]" />
                      <span>{language === 'bn' ? 'মোবাইলে যেভাবে কানেক্ট করবেন:' : 'How to use this code on mobile:'}</span>
                    </h3>

                    <ol className="space-y-4 text-xs text-gray-300 leading-relaxed list-decimal pl-4">
                      <li>
                        {language === 'bn'
                          ? 'আপনার ফোনের হোয়াটসঅ্যাপ (WhatsApp) অ্যাপটি খুলুন।'
                          : 'Launch the WhatsApp app on your smartphone.'}
                      </li>
                      <li>
                        {language === 'bn'
                          ? 'ডান কোনার থ্রি-ডট মেনু (⋮) বা সেটিংস থেকে Linked Devices অপশনটি সিলেক্ট করুন।'
                          : 'Open Settings or touch Menu (three dots ⋮) and select Linked Devices.'}
                      </li>
                      <li>
                        {language === 'bn'
                          ? 'Link a device-এ ট্যাপ করার পর নিচ থেকে "Link with phone number instead" অপশনে যান।'
                          : 'Tap "Link a device", then choose the bottom option "Link with phone number instead".'}
                      </li>
                      <li>
                        {language === 'bn'
                          ? 'স্ক্রিনে দেখানো এই ৮-সংখ্যার কোডটি যথাস্থানে সঠিকভাবে বসিয়ে দিন।'
                          : 'Enter this 8-digit alphanumeric coupling code in the code entries interface.'}
                      </li>
                    </ol>
                  </div>

                  <div className="bg-[#111b21] p-3 rounded-xl border border-slate-800/40 text-[10px] text-gray-400 leading-relaxed font-sans">
                    💡 <span className="font-bold text-gray-300">
                      {language === 'bn' ? 'জরুরি নির্দেশনা:' : 'Important Note:'}
                    </span> {language === 'bn' 
                      ? 'কোডটি সচল হওয়ার সাথে সাথে উইন্ডোটি ব্রাউজারের মতো অটো-রিফ্রেশ হয়ে যাবে এবং আপনাকে মূল ড্যাশবোর্ডে নিয়ে যাবে।' 
                      : 'As soon as you type this on your mobile, this dashboard client will automatically sync and open the inbox views.'}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STATUS 4: CONNECTED STATE (Full Desktop Client Messaging Workspace Dashboard) */}
            {connectionState === 'connected' && (
              <motion.div
                key="connected-dashboard"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full h-[600px] bg-[#222e35] rounded-3xl border border-slate-800 shadow-2xl flex overflow-hidden divide-x divide-slate-800/50"
              >
                
                {/* 1. SIDEBAR (Chat list & profile configurations) - Span 35% */}
                <div className="w-[35%] flex flex-col h-full bg-[#111b21] shrink-0 select-none">
                  
                  {/* Account Header */}
                  <div className="p-4 bg-[#202c33] flex items-center justify-between shadow-xs select-none relative z-20">
                    <div 
                      onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                      className="flex items-center gap-3 cursor-pointer group flex-1"
                      title={language === 'bn' ? 'অ্যাকাউন্ট পরিবর্তন করুন' : 'Switch WhatsApp Account'}
                    >
                      <div className="w-10 h-10 rounded-full bg-[#00a884]/25 text-[#00a884] font-extrabold flex items-center justify-center border-2 border-[#00a884]/30 group-hover:border-[#00a884] transition shrink-0">
                        {wsProfile?.name ? wsProfile.name.substring(0,2).toUpperCase() : 'WA'}
                      </div>
                      <div className="leading-tight text-left min-w-0">
                        <h4 className="text-xs font-bold text-gray-200 truncate max-w-[124px] flex items-center gap-1">
                          <span>{wsProfile?.name || 'WhatsApp User'}</span>
                          <ChevronDown className={`w-3 h-3 text-slate-400 group-hover:text-emerald-400 transition transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} />
                        </h4>
                        <span className="text-[10px] text-emerald-400 font-mono tracking-wider font-semibold block">
                          +{wsProfile?.phone || enteredPhoneNumber}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleResetSession}
                        className="p-1 px-1.5 rounded-lg border border-slate-700/50 hover:border-rose-500/80 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[9px] font-bold font-mono transition cursor-pointer flex items-center gap-0.5 outline-none"
                        title="Disconnect current account"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>OUT</span>
                      </button>
                    </div>
                  </div>

                  {/* Multi-Account Switching Dropdown List */}
                  <AnimatePresence>
                    {isAccountMenuOpen && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-[#182229] border-b border-slate-800 text-left overflow-hidden z-10"
                      >
                        <div className="p-3.5 space-y-2.5">
                          <p className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider font-mono">
                            {language === 'bn' ? 'অ্যাকাউন্টস গেটওয়ে রেজিস্ট্রি' : 'WhatsApp Gateway Registry'}
                          </p>
                          
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {accountsList.map((acc) => {
                              const isCurrent = acc.phone === (wsProfile?.phone || enteredPhoneNumber);
                              const statusBadgeColor = acc.status === 'connected' ? 'bg-green-400' : acc.status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500';
                              
                              return (
                                <div 
                                  key={acc.phone}
                                  className={`p-2 rounded-xl flex items-center justify-between text-xs transition ${
                                    isCurrent ? 'bg-[#22303c]/40 border border-[#00a884]/20' : 'bg-[#111b21]/40 border border-transparent hover:bg-[#111b21]/80'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-7 h-7 rounded-full bg-slate-800 text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                                      {acc.name ? acc.name.substring(0, 2).toUpperCase() : 'WA'}
                                    </div>
                                    <div className="leading-tight text-left min-w-0">
                                      <p className="text-xs font-bold text-gray-200 truncate">{acc.name || 'WhatsApp User'}</p>
                                      <p className="text-[9px] text-gray-400 font-mono truncate">+{acc.phone}</p>
                                      {acc.addedByName && (
                                        <p className="text-[8px] text-emerald-500 font-medium truncate">
                                          {language === 'bn' ? `দ্বারা: ${acc.addedByName}` : `By: ${acc.addedByName}`}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="flex items-center gap-1 bg-[#202c33] px-1.5 py-0.5 rounded text-[8px] text-slate-350">
                                      <span className={`w-1 h-1 rounded-full ${statusBadgeColor}`}></span>
                                      <span className="capitalize text-[7.5px] font-semibold">{acc.status}</span>
                                    </span>
                                    
                                    {!isCurrent && (
                                      <button
                                        type="button"
                                        onClick={() => handleSwitchAccount(acc.phone)}
                                        className="p-1 px-2 rounded bg-emerald-600 hover:bg-emerald-700 font-bold text-[8px] text-gray-950 transition cursor-pointer"
                                      >
                                        {language === 'bn' ? 'সুইচ' : 'Switch'}
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAccount(acc.phone)}
                                      className="p-1 rounded bg-[#111b21]/70 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                      title={language === 'bn' ? 'ডিলেট' : 'Delete'}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="border-t border-slate-800/40 pt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setConnectionState('disconnected');
                                setWsProfile(null);
                                setIsAccountMenuOpen(false);
                              }}
                              className="text-[9px] font-bold text-emerald-400 hover:text-emerald-350 hover:underline transition flex items-center gap-1 cursor-pointer select-none"
                            >
                              <span>➕ {language === 'bn' ? 'নতুন অ্যাকাউন্ট লিঙ্ক করুন' : 'Link a New Account'}</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Messaging Trigger Tools Box (Lets user start direct chat or check account of any choice) */}
                  <div className="p-3 bg-[#111b21] border-b border-slate-800/50 space-y-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono shrink-0">
                        {language === 'bn' ? 'অ্যাকশন প্যানেল' : 'Action Panel'}
                      </span>
                      <div className="flex gap-1.5 overflow-x-auto">
                        <button
                          onClick={() => {
                            setIsDirectChatOpen(!isDirectChatOpen);
                            setIsCheckerOpen(false);
                          }}
                          className={`p-1 px-2 text-[9px] font-extrabold rounded-md transition cursor-pointer flex items-center gap-1 shrink-0 ${
                            isDirectChatOpen ? 'bg-emerald-600 text-gray-950 font-bold' : 'bg-[#202c33] text-gray-300 hover:bg-[#2a3942]'
                          }`}
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>{language === 'bn' ? 'নতুন চ্যাট' : 'New Chat'}</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsCheckerOpen(!isCheckerOpen);
                            setIsDirectChatOpen(false);
                          }}
                          className={`p-1 px-2 text-[9px] font-extrabold rounded-md transition cursor-pointer flex items-center gap-1 shrink-0 ${
                            isCheckerOpen ? 'bg-emerald-600 text-gray-950 font-bold' : 'bg-[#202c33] text-gray-300 hover:bg-[#2a3942]'
                          }`}
                        >
                          <CheckCheck className="w-3 h-3" />
                          <span>{language === 'bn' ? 'অ্যাকাউন্ট চেক' : 'Verify No.'}</span>
                        </button>
                      </div>
                    </div>

                    {isDirectChatOpen && (
                      <motion.form 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        onSubmit={handleAddNewDirectChat}
                        className="bg-[#202c33] p-3 rounded-xl border border-slate-800 space-y-2.5 text-left"
                      >
                        <span className="text-[10px] font-bold text-gray-300 block">
                          {language === 'bn' ? 'যেকোনো হোয়াটসঅ্যাপ নাম্বার লিখুন:' : 'Send message to any number:'}
                        </span>

                        <div className="space-y-1.5">
                          <input
                            type="tel"
                            required
                            placeholder="যেমন: 8801700000000"
                            value={directPhoneNum}
                            onChange={(e) => setDirectPhoneNum(e.target.value)}
                            className="w-full bg-[#111b21] border border-slate-850 focus:border-[#00a884] rounded-lg py-1.5 px-2.5 text-xs font-mono placeholder:text-slate-600 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder={language === 'bn' ? 'নাম বা বিবরণ (ঐচ্ছিক)' : 'Contact Name (Optional)'}
                            value={directChatName}
                            onChange={(e) => setDirectChatName(e.target.value)}
                            className="w-full bg-[#111b21] border border-slate-850 focus:border-[#00a884] rounded-lg py-1.5 px-2.5 text-xs placeholder:text-slate-600 focus:outline-none"
                          />
                        </div>

                        {directError && (
                          <span className="text-[9px] text-rose-400 font-bold block">{directError}</span>
                        )}

                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setIsDirectChatOpen(false);
                              setDirectError('');
                            }}
                            className="p-1 px-2 px-2.5 text-[9px] font-bold text-gray-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="bg-emerald-600 hover:bg-emerald-700 font-semibold p-1 px-2.5 rounded text-[9px] text-white cursor-pointer"
                          >
                            Open Thread
                          </button>
                        </div>
                      </motion.form>
                    )}

                    {isCheckerOpen && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-[#202c33] p-3 rounded-xl border border-slate-800 space-y-3.5 text-left font-sans"
                      >
                        {/* Tab Headers */}
                        <div className="flex border-b border-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setCheckerTab('single');
                              setCheckerResult(null);
                              setCheckerError('');
                            }}
                            className={`flex-1 pb-1.5 text-center text-[10px] font-extrabold transition border-b-2 ${
                              checkerTab === 'single'
                                ? 'border-[#00a884] text-[#00a884]'
                                : 'border-transparent text-slate-400 hover:text-slate-350'
                            }`}
                          >
                            {language === 'bn' ? 'একটি নম্বর যাচাই' : 'Single Number'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCheckerTab('bulk');
                              setBulkResult(null);
                              setBulkError('');
                            }}
                            className={`flex-1 pb-1.5 text-center text-[10px] font-extrabold transition border-b-2 ${
                              checkerTab === 'bulk'
                                ? 'border-[#00a884] text-[#00a884]'
                                : 'border-transparent text-slate-400 hover:text-slate-350'
                            }`}
                          >
                            {language === 'bn' ? 'বাল্ক নম্বর (১০-১০০০)' : 'Bulk Check (10-1000)'}
                          </button>
                        </div>

                        {checkerTab === 'single' ? (
                          <>
                            <form 
                              onSubmit={handleCheckWhatsAppAccount}
                              className="space-y-2.5"
                            >
                              <span className="text-[10px] font-bold text-gray-300 block">
                                {language === 'bn' ? 'হোয়াটসঅ্যাপ অ্যাকাউন্ট নাম্বার লিখুন:' : 'Check WhatsApp Presence:'}
                              </span>

                              <div className="flex gap-2">
                                <input
                                  type="tel"
                                  required
                                  placeholder="যেমন: 8801712345678"
                                  value={checkerPhoneNum}
                                  onChange={(e) => {
                                    setCheckerPhoneNum(e.target.value);
                                    setCheckerResult(null);
                                    setCheckerError('');
                                  }}
                                  className="flex-1 bg-[#111b21] border border-slate-850 focus:border-[#00a884] rounded-lg py-1.5 px-2.5 text-xs font-mono placeholder:text-slate-600 focus:outline-none text-gray-100"
                                />
                                <button
                                  type="submit"
                                  disabled={isCheckingAccount}
                                  className="bg-emerald-600 hover:bg-emerald-700 font-bold px-3 py-1.5 rounded-lg text-[10px] text-[#0c1317] hover:text-white cursor-pointer select-none transition disabled:opacity-50 flex items-center justify-center min-w-[55px]"
                                >
                                  {isCheckingAccount ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <span>{language === 'bn' ? 'চেক' : 'Check'}</span>
                                  )}
                                </button>
                              </div>
                            </form>

                            {checkerResult && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`p-2.5 rounded-lg border text-[11px] leading-relaxed font-sans ${
                                  checkerResult.exists 
                                    ? 'bg-emerald-950/40 border-emerald-850/20 text-emerald-300' 
                                    : 'bg-rose-950/40 border-rose-850/20 text-rose-300'
                                }`}
                              >
                                <div className="flex items-start gap-2 text-left">
                                  {checkerResult.exists ? (
                                    <>
                                      <CheckCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-none animate-pulse" />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold">
                                          {language === 'bn' ? 'অ্যাকাউন্ট সচল আছে!' : 'WhatsApp Registered!'}
                                        </p>
                                        <p className="text-[9px] text-emerald-400 font-mono truncate select-all block mb-1">
                                          JID: {checkerResult.jid}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleCreateChatFromChecker(checkerResult.phone)}
                                          className="mt-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 font-bold text-[9px] text-gray-950 transition cursor-pointer select-none"
                                        >
                                          {language === 'bn' ? '💬 চ্যাট শুরু করুন' : '💬 Start Chat'}
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="w-4 h-4 text-rose-450 mt-0.5 flex-none" />
                                      <div>
                                        <p className="font-bold">
                                          {language === 'bn' ? 'অ্যাকাউন্ট পাওয়া যায়নি!' : 'Account Not Found!'}
                                        </p>
                                        <p className="text-[10px] text-rose-400 leading-normal block">
                                          {language === 'bn' ? 'এই নম্বরে কোনো সচল হোয়াটসঅ্যাপ অ্যাকাউন্ট পাওয়া যায়নি।' : 'No verified accounts found globally for this phone.'}
                                        </p>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </motion.div>
                            )}

                            {checkerError && (
                              <div className="bg-amber-950/40 border border-amber-900/30 text-amber-300 p-2 text-[10px] rounded-lg flex items-start gap-1.5 leading-relaxed font-sans text-left">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-none animate-pulse" />
                                <span>{checkerError}</span>
                              </div>
                            )}
                          </>
                        ) : (
                          // Bulk Tab
                          <>
                            <form 
                              onSubmit={handleCheckBulkAccounts}
                              className="space-y-2.5"
                            >
                              <span className="text-[10px] font-bold text-gray-300 block">
                                {language === 'bn' ? 'নম্বরগুলো এখানে লিখুন (প্রতি লাইনে বা কমা দিয়ে):' : 'Enter numbers (one per line or comma-separated):'}
                              </span>

                              <div className="space-y-2">
                                <textarea
                                  rows={4}
                                  required
                                  placeholder={language === 'bn' ? "01712345678\n01800000000\n8801911111111" : "01712345678\n01800000000\n8801911111111"}
                                  value={bulkInputText}
                                  onChange={(e) => {
                                    setBulkInputText(e.target.value);
                                    setBulkResult(null);
                                    setBulkError('');
                                  }}
                                  className="w-full bg-[#111b21] border border-slate-850 rounded-lg p-2 text-xs font-mono placeholder:text-slate-700 focus:outline-none text-gray-150 focus:border-[#00a884] resize-none"
                                />

                                {bulkInputText.trim() && (
                                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 mt-1 font-sans">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                                    <span>✓ {language === 'bn' ? `${getExtractedBulkCount()} টি ইউনিক নম্বর পাওয়া গেছে` : `${getExtractedBulkCount()} unique numbers extracted`}</span>
                                  </div>
                                )}

                                <button
                                  type="submit"
                                  disabled={isBulkChecking}
                                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-gray-950 font-bold py-1.5 rounded-lg text-xs cursor-pointer select-none transition disabled:opacity-50 flex items-center justify-center gap-1 min-h-[30px]"
                                >
                                  {isBulkChecking ? (
                                    <>
                                      <RefreshCw className="w-3 h-3 animate-spin text-gray-950" />
                                      <span>{language === 'bn' ? 'যাচাই করা হচ্ছে...' : 'Checking...'}</span>
                                    </>
                                  ) : (
                                    <span>{language === 'bn' ? 'বাল্ক নম্বর চেক করুন' : 'Check Bulk Numbers'}</span>
                                  )}
                                </button>
                              </div>
                            </form>

                            {bulkResult && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="space-y-3"
                              >
                                <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                                  <div className="bg-[#111b21] p-1.5 rounded-lg border border-slate-800">
                                    <p className="text-gray-400 font-bold text-[8px]">{language === 'bn' ? 'মোট ইউনিক' : 'Total UNIQUE'}</p>
                                    <p className="font-bold text-gray-200 mt-0.5">{bulkResult.total}</p>
                                    </div>
                                    <div className="bg-emerald-950/35 p-1.5 rounded-lg border border-emerald-900/30 text-emerald-400 font-bold">
                                      <p className="text-emerald-500/80 font-bold text-[8px]">{language === 'bn' ? 'সচল আছে' : 'Active'}</p>
                                      <p className="font-bold mt-0.5">{bulkResult.exists.length}</p>
                                    </div>
                                    <div className="bg-rose-950/30 p-1.5 rounded-lg border border-rose-900/20 text-rose-400 font-bold">
                                      <p className="text-rose-550/80 font-bold text-[8px]">{language === 'bn' ? 'সচল নেই' : 'Inactive'}</p>
                                      <p className="font-bold mt-0.5">{bulkResult.notExists.length}</p>
                                    </div>
                                  </div>

                                  <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 select-text">
                                    {bulkResult.exists.length > 0 && (
                                      <div className="bg-emerald-950/20 border border-emerald-900/20 p-2 rounded-lg space-y-1 text-left">
                                        <div className="flex justify-between items-center text-[9px] font-bold">
                                          <span className="text-emerald-400">{language === 'bn' ? 'হোয়াটসঅ্যাপ খোলা আছে:' : 'Registered WA:'}</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadBulkResult('exists')}
                                              className="text-[#00a884] hover:text-[#00c298] font-black flex items-center gap-0.5 cursor-pointer text-[9px]"
                                            >
                                              <Download className="w-2.5 h-2.5" />
                                              {language === 'bn' ? 'ডাউনলোড' : 'Download'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleCopyBulkResult('exists')}
                                              className="text-slate-300 hover:text-white font-bold flex items-center gap-0.5 cursor-pointer text-[9px]"
                                            >
                                              {copiedType === 'exists' ? (
                                                <span className="text-emerald-400 font-bold block">Copied!</span>
                                              ) : (
                                                <>
                                                  <Copy className="w-2.5 h-2.5" />
                                                  {language === 'bn' ? 'কপি' : 'Copy'}
                                                </>
                                              )}
                                            </button>
                                          </div>
                                        </div>
                                        <div className="max-h-[55px] overflow-y-auto whitespace-pre font-mono text-[8px] bg-[#111b21]/70 p-1.5 rounded text-emerald-300/85 scrollbar-thin">
                                          {bulkResult.exists.map(item => item.phone).join('\n')}
                                        </div>
                                      </div>
                                    )}

                                    {bulkResult.notExists.length > 0 && (
                                      <div className="bg-rose-950/25 border border-rose-900/20 p-2 rounded-lg space-y-1 text-left">
                                        <div className="flex justify-between items-center text-[9px] font-bold">
                                          <span className="text-rose-400">{language === 'bn' ? 'হোয়াটসঅ্যাপ খোলা নেই:' : 'Not Registered:'}</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadBulkResult('notExists')}
                                              className="text-rose-400 hover:text-rose-300 font-extrabold flex items-center gap-0.5 cursor-pointer text-[9px]"
                                            >
                                              <Download className="w-2.5 h-2.5" />
                                              {language === 'bn' ? 'ডাউনলোড' : 'Download'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleCopyBulkResult('notExists')}
                                              className="text-slate-300 hover:text-white font-bold flex items-center gap-0.5 cursor-pointer text-[9px]"
                                            >
                                              {copiedType === 'notExists' ? (
                                                <span className="text-emerald-400 font-bold block">Copied!</span>
                                              ) : (
                                                <>
                                                  <Copy className="w-2.5 h-2.5" />
                                                  {language === 'bn' ? 'কপি' : 'Copy'}
                                                </>
                                              )}
                                            </button>
                                          </div>
                                        </div>
                                        <div className="max-h-[55px] overflow-y-auto whitespace-pre font-mono text-[8px] bg-[#111b21]/70 p-1.5 rounded text-rose-300/85 scrollbar-thin">
                                          {bulkResult.notExists.map(item => item.phone || item.original).join('\n')}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}

                              {bulkError && (
                                <div className="bg-[#443322] border border-[#ff9900]/25 text-amber-300 p-2 text-[10px] rounded-lg">
                                  <span>{bulkError}</span>
                                </div>
                              )}
                            </>
                        )}
                        
                        <div className="flex gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setIsCheckerOpen(false);
                              setCheckerPhoneNum('');
                              setBulkInputText('');
                              setCheckerResult(null);
                              setBulkResult(null);
                              setCheckerError('');
                              setBulkError('');
                            }}
                            className="text-[9px] font-bold text-gray-400 hover:text-white"
                          >
                            Close
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  {/* Chats list area */}
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-850 text-left">
                    {activeChats.map(chat => {
                      const finalPreview = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].text : 'No conversations started';
                      const finalTime = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].timestamp : '';
                      const isHighlighted = selectedChatId === chat.id;

                      return (
                        <div
                          key={chat.id}
                          onClick={() => {
                            setSelectedChatId(chat.id);
                            setIsDirectChatOpen(false);
                          }}
                          className={`flex items-center gap-3.5 p-3.5 cursor-pointer border-l-3 transition hover:bg-[#202c33] ${
                            isHighlighted ? 'bg-[#2a3942] border-[#00a884]' : 'border-transparent'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-[#202c33] flex items-center justify-center font-bold text-[#00a884] text-lg shrink-0">
                            {chat.avatar}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline mb-0.5">
                              <h4 className="text-xs font-bold text-gray-200 truncate">{chat.name}</h4>
                              <span className="text-[8px] text-slate-400 shrink-0 font-mono">{finalTime}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 truncate leading-relaxed font-sans">
                              {finalPreview}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>

                {/* 2. CHAT VIEW WINDOW (Workspace for current active message flows) - Span 65% */}
                <div className="flex-1 flex flex-col h-full bg-[#0b141a]">
                  {selectedChatId && currentChatObj ? (
                    <div className="flex-1 flex flex-col justify-between h-full relative">
                      
                      {/* Chat Header details */}
                      <div className="p-3.5 bg-[#202c33] flex items-center justify-between shrink-0 select-none">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#0b141a] flex items-center justify-center font-bold text-lg text-[#00a884]">
                            {currentChatObj.avatar}
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-gray-200 leading-tight">
                              {currentChatObj.name}
                            </h4>
                            <p className="text-[9px] text-[#00a884] font-mono font-semibold block tracking-wider">
                              {currentChatObj.phone ? `+${currentChatObj.phone}` : 'SYSTEM INTERNAL CLIENT'}
                            </p>
                          </div>
                        </div>

                        <span className="text-[8.5px] text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-md font-mono bg-emerald-950/20">
                          E2EE TU_CHANNEL ACTIVE
                        </span>
                      </div>

                      {/* Msg history scroll area */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
                        {currentChatObj.messages.map((msg) => {
                          const isMe = msg.sender === 'me';
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[70%] p-2.5 rounded-xl text-xs leading-relaxed ${
                                  isMe
                                    ? 'bg-[#005c4b] text-white rounded-tr-none'
                                    : 'bg-[#202c33] text-gray-200 rounded-tl-none'
                                }`}
                              >
                                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                                <div className="flex justify-end items-center gap-1 mt-1 text-[8px] text-slate-400 font-mono">
                                  <span>{msg.timestamp}</span>
                                  {isMe && (
                                    <CheckCheck className={`w-3 h-3 ${msg.status === 'read' ? 'text-emerald-400' : 'text-slate-400'}`} />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Send message text form */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSendMessage();
                        }}
                        className="p-3 bg-[#202c33] flex items-center gap-2 shrink-0 border-t border-slate-800"
                      >
                        <input
                          type="text"
                          required
                          value={webMessageInput}
                          onChange={(e) => setWebMessageInput(e.target.value)}
                          placeholder={language === 'bn' ? 'মেসেজ লিখুন...' : 'Type a message...'}
                          className="flex-1 bg-[#2a3942] border border-transparent focus:border-[#00a884] rounded-lg py-2 px-3 text-xs focus:outline-none text-gray-100 placeholder:text-slate-500"
                        />
                        <button
                          type="submit"
                          className="p-2 rounded-lg bg-[#00a884] hover:bg-[#00c298] text-gray-950 transition flex items-center justify-center cursor-pointer"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </form>

                    </div>
                  ) : (
                    // Default screen when NO chat is selected
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none space-y-6 overflow-y-auto">
                      <div className="w-16 h-16 rounded-full bg-[#202c33] flex items-center justify-center text-[#00a884] border border-slate-800 animate-pulse shrink-0">
                        <MessageSquare className="w-8 h-8" />
                      </div>
                      <div className="max-w-xs space-y-2 shrink-0">
                        <h3 className="text-sm font-bold text-gray-200">
                          {language === 'bn' ? 'হোয়াটসঅ্যাপ মেসেঞ্জার' : 'WhatsApp Messenger'}
                        </h3>
                        <p className="text-xs text-gray-400 leading-normal">
                          {language === 'bn'
                            ? 'বাম দিকের তালিকা থেকে কোনো চ্যাট নির্বাচন করুন অথবা নতুন নম্বর দিয়ে মেসেজ পাঠানো শুরু করুন।'
                            : 'Select a chat conversation from the sidebar or initiate a direct thread to begin messaging.'}
                        </p>
                      </div>

                      {/* Integrated Fast Checker block inside default main panel */}
                      <div className="bg-[#111b21] p-5 rounded-2xl border border-slate-800/85 max-w-sm w-full space-y-3.5 shadow-lg select-text text-left shrink-0">
                        <div className="flex items-center gap-2 text-[#00a884] font-bold text-xs font-mono uppercase tracking-wide">
                          <CheckCheck className="w-4 h-4" />
                          <span>{language === 'bn' ? 'হোয়াটসঅ্যাপ অ্যাকাউন্ট চেকার' : 'WhatsApp Account Checker'}</span>
                        </div>
                        
                        {/* Tab Headers */}
                        <div className="flex border-b border-slate-800 pb-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCheckerTab('single');
                              setCheckerResult(null);
                              setCheckerError('');
                            }}
                            className={`flex-1 pb-1.5 text-center text-xs font-extrabold transition border-b-2 ${
                              checkerTab === 'single'
                                ? 'border-[#00a884] text-[#00a884]'
                                : 'border-transparent text-slate-400 hover:text-slate-350'
                            }`}
                          >
                            {language === 'bn' ? 'একটি নম্বর' : 'Single'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCheckerTab('bulk');
                              setBulkResult(null);
                              setBulkError('');
                            }}
                            className={`flex-1 pb-1.5 text-center text-xs font-extrabold transition border-b-2 ${
                              checkerTab === 'bulk'
                                ? 'border-[#00a884] text-[#00a884]'
                                : 'border-transparent text-slate-400 hover:text-slate-350'
                            }`}
                          >
                            {language === 'bn' ? 'বাল্ক (১০-১০০০)' : 'Bulk Check'}
                          </button>
                        </div>

                        {checkerTab === 'single' ? (
                          <>
                            <p className="text-[11px] text-gray-400 leading-normal font-sans">
                              {language === 'bn'
                                ? 'যেকোনো ফোন নম্বরে হোয়াটসঅ্যাপ অ্যাকাউন্ট খোলা আছে কি না তা দ্রুত যাচাই করতে এখানে নম্বরটি লিখুন।'
                                : 'Quickly query if a custom phone number possesses an active WhatsApp presence.'}
                            </p>

                            <form onSubmit={handleCheckWhatsAppAccount} className="flex gap-2">
                              <input
                                type="tel"
                                required
                                placeholder="যেমন: 8801712345678"
                                value={checkerPhoneNum}
                                onChange={(e) => {
                                  setCheckerPhoneNum(e.target.value);
                                  setCheckerResult(null);
                                  setCheckerError('');
                                }}
                                className="bg-[#202c33] border border-slate-755 focus:border-[#00a884] rounded-xl flex-1 px-3 py-2 text-xs font-mono focus:outline-none text-gray-200 placeholder:text-slate-600"
                              />
                              <button
                                type="submit"
                                disabled={isCheckingAccount}
                                className="bg-[#00a884] hover:bg-[#00c298] text-gray-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center justify-center min-w-[70px] cursor-pointer select-none transition disabled:opacity-50"
                              >
                                {isCheckingAccount ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <span>{language === 'bn' ? 'যাচাই' : 'Verify'}</span>
                                )}
                              </button>
                            </form>

                            {checkerResult && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`p-3 rounded-xl border text-[11px] leading-relaxed font-sans ${
                                  checkerResult.exists 
                                    ? 'bg-emerald-950/40 border-emerald-800/30 text-emerald-300' 
                                    : 'bg-rose-950/40 border-rose-850/20 text-rose-300'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {checkerResult.exists ? (
                                    <>
                                      <CheckCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-none animate-pulse" />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold">
                                          {language === 'bn' ? 'অ্যাকাউন্ট সচল রয়েছে!' : 'WhatsApp Member Exists!'}
                                        </p>
                                        <p className="text-[10px] text-emerald-400/80 font-mono truncate select-all block mb-1.5">
                                          JID: {checkerResult.jid}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleCreateChatFromChecker(checkerResult.phone)}
                                          className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#00c298] text-gray-950 font-black text-[10px] transition cursor-pointer select-none"
                                        >
                                          {language === 'bn' ? '💬 সরাসরি চ্যাট শুরু করুন' : '💬 Start Direct Chat'}
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 flex-none" />
                                      <div>
                                        <p className="font-bold">
                                          {language === 'bn' ? 'অ্যাকাউন্ট রেজিস্টার্ড নাই!' : 'No Active Account!'}
                                        </p>
                                        <p className="text-[10px] text-rose-400/95 leading-normal">
                                          {language === 'bn' ? 'এই নম্বরে কোনো সক্রিয় হোয়াটসঅ্যাপ অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।' : 'This phone number is not registered on WhatsApp.'}
                                        </p>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </motion.div>
                            )}

                            {checkerError && (
                              <div className="bg-amber-950/40 border border-amber-900/30 text-amber-300 p-2.5 rounded-xl flex items-start gap-1.5 leading-relaxed font-sans text-xs">
                                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-none" />
                                <span>{checkerError}</span>
                              </div>
                            )}
                          </>
                        ) : (
                          // Bulk view inside the main panel
                          <>
                            <p className="text-[11px] text-gray-400 leading-normal font-sans">
                              {language === 'bn'
                                ? 'যেকোনো ১০ থেকে সর্বোচ্চ ১০০০টি নম্বর প্রতি লাইনে বা কমা দিয়ে লিখে একসাথে চেক করুন কোনটি অ্যাক্টিভ আছে।'
                                : 'Check 10 up to 1000 numbers at once. Copy and paste your list to identify registered accounts.'}
                            </p>

                            <form onSubmit={handleCheckBulkAccounts} className="space-y-2.5">
                              <textarea
                                rows={4}
                                required
                                placeholder={language === 'bn' ? "01712345678\n01800000000\n+8801912345678" : "01712345678\n01800000000\n+8801912345678"}
                                value={bulkInputText}
                                onChange={(e) => {
                                  setBulkInputText(e.target.value);
                                  setBulkResult(null);
                                  setBulkError('');
                                }}
                                className="w-full bg-[#202c33] border border-slate-755 rounded-xl p-2.5 text-xs font-mono placeholder:text-slate-600 focus:outline-none text-gray-200 resize-none focus:border-[#00a884]"
                              />

                              {bulkInputText.trim() && (
                                <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1.5 mt-1 font-sans">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                                  <span>✓ {language === 'bn' ? `${getExtractedBulkCount()} টি ইউনিক নম্বর পাওয়া গেছে` : `${getExtractedBulkCount()} unique numbers extracted`}</span>
                                </div>
                              )}

                              <button
                                type="submit"
                                disabled={isBulkChecking}
                                className="w-full bg-[#00a884] hover:bg-[#00c298] text-gray-950 font-bold py-2 rounded-xl text-xs flex justify-center items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                              >
                                {isBulkChecking ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>{language === 'bn' ? 'যাচাই করা হচ্ছে...' : 'Checking list...'}</span>
                                  </>
                                ) : (
                                  <span>{language === 'bn' ? 'বাল্ক নম্বর যাচাই করুন' : 'Verify Bulk List'}</span>
                                )}
                              </button>
                            </form>

                            {bulkResult && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="space-y-3"
                              >
                                <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                                  <div className="bg-[#2a3942]/60 p-2 rounded-xl border border-slate-800">
                                    <p className="text-gray-400 text-[9px]">{language === 'bn' ? 'ইউনিক নম্বর' : 'Unique Count'}</p>
                                    <p className="font-bold text-gray-150 mt-0.5">{bulkResult.total}</p>
                                  </div>
                                  <div className="bg-emerald-950/45 p-2 rounded-xl border border-emerald-900/30 text-emerald-300">
                                    <p className="text-emerald-400 text-[9px]">{language === 'bn' ? 'অ্যাকাউন্ট আছে' : 'Registered'}</p>
                                    <p className="font-bold mt-0.5">{bulkResult.exists.length}</p>
                                  </div>
                                  <div className="bg-rose-950/30 p-2 rounded-xl border border-rose-900/20 text-rose-300">
                                    <p className="text-rose-455 text-[9px]">{language === 'bn' ? 'অ্যাকাউন্ট নেই' : 'Not Found'}</p>
                                    <p className="font-bold mt-0.5">{bulkResult.notExists.length}</p>
                                  </div>
                                </div>

                                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                                  {bulkResult.exists.length > 0 && (
                                    <div className="bg-emerald-950/20 border border-emerald-900/20 p-2.5 rounded-xl space-y-1 font-sans">
                                      <div className="flex justify-between items-center text-[10px]">
                                        <span className="font-bold text-emerald-400">{language === 'bn' ? 'হোয়াটসঅ্যাপ আছে:' : 'Registered WA:'}</span>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleDownloadBulkResult('exists')}
                                            className="text-[#00a884] hover:text-[#00c298] font-bold flex items-center gap-0.5 cursor-pointer text-[10px]"
                                          >
                                            <Download className="w-2.5 h-2.5" />
                                            {language === 'bn' ? 'ডাউনলোড' : 'Download'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleCopyBulkResult('exists')}
                                            className="text-slate-300 hover:text-white font-bold flex items-center gap-0.5 cursor-pointer text-[10px]"
                                          >
                                            {copiedType === 'exists' ? (
                                              <span className="text-emerald-400 font-bold block">Copied!</span>
                                            ) : (
                                              <>
                                                <Copy className="w-2.5 h-2.5" />
                                                {language === 'bn' ? 'কপি' : 'Copy'}
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                      <div className="max-h-[60px] overflow-y-auto whitespace-pre font-mono text-[9px] bg-[#111b21]/70 p-2 rounded text-emerald-300/85 scrollbar-thin">
                                        {bulkResult.exists.map(item => item.phone).join('\n')}
                                      </div>
                                    </div>
                                  )}

                                  {bulkResult.notExists.length > 0 && (
                                    <div className="bg-rose-950/25 border border-rose-900/20 p-2.5 rounded-xl space-y-1 font-sans">
                                      <div className="flex justify-between items-center text-[10px]">
                                        <span className="font-bold text-rose-455">{language === 'bn' ? 'হোয়াটসঅ্যাপ নেই:' : 'Not Registered:'}</span>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleDownloadBulkResult('notExists')}
                                            className="text-rose-400 hover:text-rose-300 font-bold flex items-center gap-0.5 cursor-pointer text-[10px]"
                                          >
                                            <Download className="w-2.5 h-2.5" />
                                            {language === 'bn' ? 'ডাউনলোড' : 'Download'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleCopyBulkResult('notExists')}
                                            className="text-slate-300 hover:text-white font-bold flex items-center gap-0.5 cursor-pointer text-[10px]"
                                          >
                                            {copiedType === 'notExists' ? (
                                              <span className="text-emerald-400 font-bold block">Copied!</span>
                                            ) : (
                                              <>
                                                <Copy className="w-2.5 h-2.5" />
                                                {language === 'bn' ? 'কপি' : 'Copy'}
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                      <div className="max-h-[60px] overflow-y-auto whitespace-pre font-mono text-[9px] bg-[#111b21]/70 p-2 rounded text-rose-300/85 scrollbar-thin">
                                        {bulkResult.notExists.map(item => item.phone || item.original).join('\n')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}






                          </>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-850 max-w-xs w-full flex justify-center text-slate-600 font-mono text-[9px] gap-1 shrink-0">
                        <Lock className="w-3.5 h-3.5 text-slate-650" />
                        <span>End-to-End Encrypted Live Handshakes</span>
                      </div>
                    </div>
                  )}
                </div>

              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer info links inside workspace */}
        <footer className="py-6 text-center text-slate-600 text-xs shrink-0 mt-6 select-none leading-relaxed border-t border-slate-850/40">
          <p>© 2026 WhatsApp Session Web Client. Developed with real pairing WebSocket socket integrations.</p>
          <p className="font-mono text-[9px] text-[#00a884]/60">Secure Ingress active | No telemetry metadata active | Premium Workspace</p>
        </footer>

      </div>
    </div>
  );
}
