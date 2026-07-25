export interface Message {
  id: string;
  sender: 'me' | 'them';
  text: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  unreadCount?: number;
  lastMessage?: string;
  messages: Message[];
  status: 'online' | 'offline' | 'typing';
  phone?: string;
}

export interface LinkedDevice {
  id: string;
  name: string;
  location: string;
  lastActive: string;
  os: 'Windows' | 'macOS' | 'Linux' | 'ChromeOS';
  browser: 'Chrome' | 'Safari' | 'Firefox' | 'Edge';
  linkedAt: string;
}

export type ConnectionState = 'disconnected' | 'qr-ready' | 'phone-code-ready' | 'linking' | 'connected';
