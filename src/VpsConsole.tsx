import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, Server, Play, Cpu, HardDrive, 
  Send, RefreshCw, CheckCircle2, AlertTriangle, 
  Trash2, Copy, Check, Smartphone, Search, HelpCircle,
  Activity, ArrowDown
} from 'lucide-react';

interface VpsLogEntry {
  id: number;
  time: string;
  level: 'info' | 'warn' | 'error' | 'cmd' | 'bot' | 'wa';
  message: string;
}

interface VpsStatus {
  uptime: number;
  memoryMb: number;
  heapMb: number;
  nodeVersion: string;
  platform: string;
  tgBotInfo?: {
    username: string;
    id: string;
    name: string;
    status: string;
    token: string;
    lastPing: string;
  };
  activeSessionsCount: number;
  savedAccountsCount: number;
  activePhones: string[];
}

interface VpsConsoleProps {
  language: 'bn' | 'en';
  onSwitchToCode: () => void;
  onSwitchToWeb: () => void;
}

export const VpsConsole: React.FC<VpsConsoleProps> = ({
  language,
  onSwitchToCode,
  onSwitchToWeb,
}) => {
  const [logs, setLogs] = useState<VpsLogEntry[]>([]);
  const [lastLogId, setLastLogId] = useState<number>(0);
  const [status, setStatus] = useState<VpsStatus | null>(null);
  const [commandInput, setCommandInput] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Quick Action Dialogs
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginPhone, setLoginPhone] = useState<string>('');
  const [showCheckModal, setShowCheckModal] = useState<boolean>(false);
  const [checkPhone, setCheckPhone] = useState<string>('');

  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll handler
  useEffect(() => {
    if (autoScroll) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Initial load & periodic poll
  useEffect(() => {
    let isMounted = true;

    const fetchInitial = async () => {
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch('/api/vps/status'),
          fetch('/api/vps/logs')
        ]);
        if (statusRes.ok && isMounted) {
          const st = await statusRes.json();
          setStatus(st);
        }
        if (logsRes.ok && isMounted) {
          const lg = await logsRes.json();
          setLogs(lg.logs || []);
          setLastLogId(lg.lastId || 0);
        }
      } catch (err) {
        console.warn('VPS telemetry fetch error:', err);
      }
    };

    fetchInitial();

    // Poll updates every 1.5 seconds
    const interval = setInterval(async () => {
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch('/api/vps/status'),
          fetch(`/api/vps/logs?since=${lastLogId}`)
        ]);

        if (statusRes.ok && isMounted) {
          const st = await statusRes.json();
          setStatus(st);
        }

        if (logsRes.ok && isMounted) {
          const lg = await logsRes.json();
          if (lg.logs && lg.logs.length > 0) {
            setLogs(prev => {
              const existingIds = new Set(prev.map(l => l.id));
              const newEntries = lg.logs.filter((l: VpsLogEntry) => !existingIds.has(l.id));
              return [...prev, ...newEntries].slice(-600);
            });
            setLastLogId(lg.lastId);
          }
        }
      } catch (e) {
        // quiet retry
      }
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [lastLogId]);

  const handleRunCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun || commandInput).trim();
    if (!cmd) return;

    setCommandInput('');
    setIsExecuting(true);
    setCommandHistory(prev => [cmd, ...prev.slice(0, 30)]);
    setHistoryIndex(-1);

    try {
      const res = await fetch('/api/vps/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });

      if (res.ok) {
        // Fetch new logs immediately
        const logsRes = await fetch(`/api/vps/logs?since=${lastLogId}`);
        if (logsRes.ok) {
          const lg = await logsRes.json();
          if (lg.logs && lg.logs.length > 0) {
            setLogs(prev => [...prev, ...lg.logs]);
            setLastLogId(lg.lastId);
          }
        }
      }
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString('en-GB'),
          level: 'error',
          message: `Network error: ${err.message}`
        }
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIdx = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(nextIdx);
        setCommandInput(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setCommandInput(commandHistory[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommandInput('');
      }
    }
  };

  const getLogBadge = (level: VpsLogEntry['level']) => {
    switch (level) {
      case 'bot':
        return <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">BOT</span>;
      case 'wa':
        return <span className="text-[10px] bg-purple-950/80 text-purple-300 border border-purple-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">WHATSAPP</span>;
      case 'cmd':
        return <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">EXEC</span>;
      case 'warn':
        return <span className="text-[10px] bg-yellow-950/80 text-yellow-300 border border-yellow-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">WARN</span>;
      case 'error':
        return <span className="text-[10px] bg-rose-950/80 text-rose-300 border border-rose-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">ERR</span>;
      default:
        return <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">INFO</span>;
    }
  };

  const getLogColor = (level: VpsLogEntry['level']) => {
    switch (level) {
      case 'bot':
        return 'text-emerald-300';
      case 'wa':
        return 'text-purple-200';
      case 'cmd':
        return 'text-amber-300 font-bold';
      case 'warn':
        return 'text-yellow-300';
      case 'error':
        return 'text-rose-400 font-semibold';
      default:
        return 'text-slate-300';
    }
  };

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m ${seconds % 60}s`;
  };

  return (
    <div className="w-full space-y-4 font-sans text-left">
      
      {/* 1. TOP VPS TELEMETRY DASHBOARD */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        
        {/* Metric 1: OS / Node.js Engine */}
        <div className="bg-[#111b21] p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/50 border border-cyan-800/40 text-cyan-400 flex items-center justify-center shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase font-mono tracking-wider">
              {language === 'bn' ? 'লিনাক্স VPS হোস্ট' : 'VPS Environment'}
            </p>
            <p className="text-xs font-bold text-gray-100 truncate">
              Ubuntu (Node {status?.nodeVersion || 'v20'})
            </p>
            <p className="text-[9px] text-cyan-400/80 font-mono">
              Uptime: {status ? formatUptime(status.uptime) : '0s'}
            </p>
          </div>
        </div>

        {/* Metric 2: Memory & RSS */}
        <div className="bg-[#111b21] p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-950/50 border border-indigo-800/40 text-indigo-400 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase font-mono tracking-wider">
              {language === 'bn' ? 'র‍্যাম / মেমোরি' : 'RAM / Memory'}
            </p>
            <p className="text-xs font-bold text-gray-100 font-mono">
              {status?.memoryMb || 45} MB <span className="text-[10px] text-slate-500 font-normal">RSS</span>
            </p>
            <p className="text-[9px] text-indigo-400/80 font-mono">
              Heap: {status?.heapMb || 25} MB
            </p>
          </div>
        </div>

        {/* Metric 3: Telegram Bot Engine */}
        <div className="bg-[#111b21] p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/50 border border-emerald-800/40 text-emerald-400 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase font-mono tracking-wider flex items-center gap-1">
              <span>{language === 'bn' ? 'টেলিগ্রাম বট' : 'Telegram Bot'}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping"></span>
            </p>
            <p className="text-xs font-bold text-emerald-300 truncate font-mono">
              {status?.tgBotInfo?.username ? `@${status.tgBotInfo.username}` : '@Bot Polling'}
            </p>
            <p className="text-[9px] text-emerald-500/80 font-mono truncate" title={status?.tgBotInfo?.token}>
              Token: {status?.tgBotInfo?.token?.substring(0, 10)}...
            </p>
          </div>
        </div>

        {/* Metric 4: WhatsApp Baileys Gateway */}
        <div className="bg-[#111b21] p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-950/50 border border-purple-800/40 text-purple-400 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase font-mono tracking-wider">
              {language === 'bn' ? 'হোয়াটসঅ্যাপ সেশন' : 'WhatsApp Sessions'}
            </p>
            <p className="text-xs font-bold text-gray-100 font-mono">
              {status?.activeSessionsCount || 0} {language === 'bn' ? 'সক্রিয়' : 'Active'}
            </p>
            <p className="text-[9px] text-purple-400/80 font-mono">
              {status?.savedAccountsCount || 0} {language === 'bn' ? 'ডাটাবেজে সংরক্ষিত' : 'in DB store'}
            </p>
          </div>
        </div>

      </div>

      {/* 2. QUICK TEST CONTROLS BAR */}
      <div className="bg-[#111b21] p-3 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-gray-400 font-mono px-1">
            {language === 'bn' ? 'কুইক অ্যাকশন টেস্ট:' : 'Quick Tests:'}
          </span>

          <button
            onClick={() => handleRunCommand('test-tg')}
            disabled={isExecuting}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/40 hover:bg-emerald-900/50 text-emerald-300 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Ping Telegram API and verify token handshake"
          >
            <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
            <span>⚡ {language === 'bn' ? 'বট পিং টেস্ট' : 'Ping Bot (getMe)'}</span>
          </button>

          <button
            onClick={() => setShowLoginModal(true)}
            disabled={isExecuting}
            className="px-2.5 py-1.5 rounded-lg bg-purple-950/60 border border-purple-800/40 hover:bg-purple-900/50 text-purple-300 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Pair WhatsApp using pairing code via terminal"
          >
            <Smartphone className="w-3 h-3 text-purple-400" />
            <span>🔑 /login (হোয়াটসঅ্যাপ লিঙ্ক)</span>
          </button>

          <button
            onClick={() => setShowCheckModal(true)}
            disabled={isExecuting}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/40 hover:bg-cyan-900/50 text-cyan-300 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Verify any mobile number directly from terminal"
          >
            <Search className="w-3 h-3 text-cyan-400" />
            <span>🔍 /check (নম্বর চেক)</span>
          </button>

          <button
            onClick={() => handleRunCommand('menu')}
            disabled={isExecuting}
            className="px-2.5 py-1.5 rounded-lg bg-blue-950/60 border border-blue-800/40 hover:bg-blue-900/50 text-blue-300 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Inspect Telegram ReplyKeyboardMarkup buttons"
          >
            <span>📱 {language === 'bn' ? 'মেনু বাটন (Menu)' : 'Menu KB'}</span>
          </button>

          <button
            onClick={() => handleRunCommand('status')}
            disabled={isExecuting}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/50 text-slate-300 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <span>📊 status</span>
          </button>

          <button
            onClick={() => handleRunCommand('help')}
            disabled={isExecuting}
            className="px-2 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/50 text-slate-400 font-mono text-xs flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
          >
            <HelpCircle className="w-3 h-3" />
            <span>help</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition cursor-pointer flex items-center gap-1 ${
              autoScroll ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40' : 'bg-slate-900 text-slate-500'
            }`}
          >
            <ArrowDown className="w-3 h-3" />
            <span>Auto-scroll: {autoScroll ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={() => handleRunCommand('clear')}
            className="px-2 py-1 rounded-md bg-slate-900 hover:bg-rose-950/40 hover:text-rose-300 text-slate-400 border border-slate-800 text-[10px] font-mono transition cursor-pointer flex items-center gap-1"
            title="Clear terminal buffer"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* 3. INTERACTIVE LINUX VPS TERMINAL SCREEN */}
      <div className="bg-[#090d10] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-mono text-xs">
        
        {/* Terminal Title Bar */}
        <div className="bg-[#111b21] px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
            <span className="text-slate-400 text-[11px] font-bold ml-2">
              root@vps-bangla: /app/applet (bash - node bot.js)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>LIVE STREAM</span>
          </div>
        </div>

        {/* Console Log Area */}
        <div className="p-4 space-y-1.5 h-[380px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 text-left select-text bg-[#070b0e]">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic py-8 text-center font-mono">
              Waiting for incoming log streams from Telegram Bot and Baileys socket...
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed break-all font-mono">
                <span className="text-[10px] text-slate-600 shrink-0 select-none">
                  [{log.time}]
                </span>
                {getLogBadge(log.level)}
                <span className={`flex-1 ${getLogColor(log.level)} whitespace-pre-wrap`}>
                  {log.message}
                </span>
              </div>
            ))
          )}
          <div ref={terminalEndRef} />
        </div>

        {/* Terminal Interactive Prompt Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunCommand();
          }}
          className="bg-[#0e161c] border-t border-slate-800 p-2.5 flex items-center gap-2"
        >
          <span className="text-emerald-400 font-bold select-none text-xs shrink-0 flex items-center gap-1">
            <Terminal className="w-3.5 h-3.5 text-emerald-500" />
            <span>root@vps:~/bot#</span>
          </span>

          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              language === 'bn' 
                ? 'কমান্ড লিখুন (যেমন: /login 88017..., /check 88017..., node bot.js, status, help)' 
                : 'Type command (e.g., /login 88017..., /check 88017..., node bot.js, status, help)'
            }
            className="flex-1 bg-transparent text-emerald-300 font-mono text-xs focus:outline-none placeholder:text-slate-650"
          />

          <button
            type="submit"
            disabled={isExecuting || !commandInput.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-gray-950 font-bold px-3 py-1 rounded text-xs transition cursor-pointer disabled:opacity-40 flex items-center gap-1 shrink-0"
          >
            {isExecuting ? (
              <RefreshCw className="w-3 h-3 animate-spin text-gray-950" />
            ) : (
              <>
                <Send className="w-3 h-3" />
                <span>Run</span>
              </>
            )}
          </button>
        </form>

      </div>

      {/* 3.5. TELEGRAM BOT MENU BUILDER KEYBOARD PREVIEW (_MAIN_MENU_KB) */}
      <div className="bg-[#111b21] p-4 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base">📱</span>
            <div>
              <h4 className="text-xs font-bold text-gray-200 font-mono flex items-center gap-2">
                <span>_MAIN_MENU_KB</span>
                <span className="text-[10px] bg-slate-800 text-slate-350 px-1.5 py-0.5 rounded font-mono font-normal">
                  ReplyKeyboardMarkup (5 Rows)
                </span>
              </h4>
              <p className="text-[10px] text-slate-400">
                {language === 'bn' 
                  ? 'টেলিগ্রাম বটের লাইভ কাস্টম মেনু বাটন (ক্লিক করে টেস্ট করুন)' 
                  : 'Live custom Telegram bot keyboard layout (click any button to test)'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800/40 px-2 py-0.5 rounded-full">
              resize_keyboard=True
            </span>
            <button
              onClick={() => handleRunCommand('menu')}
              className="text-[10px] text-blue-400 hover:text-blue-300 font-mono hover:underline cursor-pointer"
            >
              $ menu
            </button>
          </div>
        </div>

        {/* 5 Rows Menu Grid */}
        <div className="space-y-2 max-w-xl mx-auto font-mono">
          
          {/* Row 1: CONNECT WS CHECKER */}
          <div>
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('CONNECT WS CHECKER')}
              className="w-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400 text-blue-300 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>🔗</span>
              <span>CONNECT WS CHECKER</span>
              <span className="text-[9px] text-blue-400/60 font-normal ml-auto hidden sm:inline">style: primary</span>
            </button>
          </div>

          {/* Row 2: CHECK WS NUMBER */}
          <div>
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('CHECK WS NUMBER')}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>🔍</span>
              <span>CHECK WS NUMBER</span>
              <span className="text-[9px] text-emerald-400/60 font-normal ml-auto hidden sm:inline">style: success</span>
            </button>
          </div>

          {/* Row 3: BUY WS API | HELP */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('BUY WS API')}
              className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400 text-blue-300 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>⚡</span>
              <span className="truncate">BUY WS API</span>
            </button>

            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('HELP')}
              className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400 text-blue-300 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>📖</span>
              <span className="truncate">HELP</span>
            </button>
          </div>

          {/* Row 4: MY PROFILE | MY PACKAGE */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('MY PROFILE')}
              className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>👤</span>
              <span className="truncate">MY PROFILE</span>
            </button>

            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('MY PACKAGE')}
              className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>📦</span>
              <span className="truncate">MY PACKAGE</span>
            </button>
          </div>

          {/* Row 5: ADMIN PANEL */}
          <div>
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => handleRunCommand('ADMIN PANEL')}
              className="w-full bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 hover:border-rose-400 text-rose-300 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
            >
              <span>⚙️</span>
              <span>ADMIN PANEL</span>
              <span className="text-[9px] text-rose-400/60 font-normal ml-auto hidden sm:inline">style: danger</span>
            </button>
          </div>

        </div>
      </div>
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#182229] border border-slate-800 rounded-2xl p-5 max-w-md w-full space-y-4 text-left shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <span>{language === 'bn' ? 'হোয়াটসঅ্যাপ পেয়ারিং টেস্ট (/login)' : 'WhatsApp Login Test (/login)'}</span>
              </h3>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-350 leading-relaxed font-sans">
              {language === 'bn'
                ? 'যে মোবাইল নম্বরটি হোয়াটসঅ্যাপে লিঙ্ক করতে চান সেটি আন্তর্জাতিক কোডসহ লিখুন। কনসোলে ৮-সংখ্যার পেয়ারিং কোড চলে আসবে:'
                : 'Enter mobile number with country code. The bot will initiate pairing and output the 8-digit code in the terminal:'}
            </p>

            <div className="space-y-1.5 font-sans">
              <input
                type="tel"
                required
                placeholder="যেমন: 8801712345678"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                className="w-full bg-[#111b21] border border-slate-800 focus:border-[#00a884] rounded-xl px-3 py-2 text-xs font-mono text-gray-100 placeholder:text-slate-650 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 font-mono">
                Command: /login {loginPhone.replace(/\D/g, '') || '<phone>'}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!loginPhone.trim()}
                onClick={() => {
                  setShowLoginModal(false);
                  handleRunCommand(`/login ${loginPhone.trim()}`);
                  setLoginPhone('');
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition cursor-pointer disabled:opacity-50"
              >
                {language === 'bn' ? 'কোড রিকোয়েস্ট করুন' : 'Request Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL: QUICK WHATSAPP /CHECK VIA TERMINAL */}
      {showCheckModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#182229] border border-slate-800 rounded-2xl p-5 max-w-md w-full space-y-4 text-left shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                <Search className="w-4 h-4 text-cyan-400" />
                <span>{language === 'bn' ? 'হোয়াটসঅ্যাপ নম্বর চেক (/check)' : 'WhatsApp Check (/check)'}</span>
              </h3>
              <button
                onClick={() => setShowCheckModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-350 leading-relaxed font-sans">
              {language === 'bn'
                ? 'যেকোনো মোবাইল নম্বর লিখুন। এটি চেক করে জানাবে ওই নম্বরে হোয়াটসঅ্যাপ খোলা আছে কিনা এবং অফিশিয়াল JID প্রিন্ট করবে:'
                : 'Enter a mobile number to verify if it is registered on WhatsApp:'}
            </p>

            <div className="space-y-1.5 font-sans">
              <input
                type="tel"
                required
                placeholder="যেমন: 8801712345678"
                value={checkPhone}
                onChange={(e) => setCheckPhone(e.target.value)}
                className="w-full bg-[#111b21] border border-slate-800 focus:border-[#00a884] rounded-xl px-3 py-2 text-xs font-mono text-gray-100 placeholder:text-slate-650 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 font-mono">
                Command: /check {checkPhone.replace(/\D/g, '') || '<phone>'}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCheckModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!checkPhone.trim()}
                onClick={() => {
                  setShowCheckModal(false);
                  handleRunCommand(`/check ${checkPhone.trim()}`);
                  setCheckPhone('');
                }}
                className="bg-cyan-600 hover:bg-cyan-700 text-gray-950 font-bold px-4 py-1.5 rounded-lg text-xs transition cursor-pointer disabled:opacity-50"
              >
                {language === 'bn' ? 'যাচাই করুন' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. BOTTOM HELPER NOTE */}
      <div className="bg-[#111b21] p-3 rounded-xl border border-slate-800/60 text-xs text-slate-400 flex items-center justify-between gap-2">
        <span className="leading-relaxed">
          💡 <span className="text-gray-200 font-bold">
            {language === 'bn' ? 'VPS পরামর্শ:' : 'VPS Tip:'}
          </span>{' '}
          {language === 'bn'
            ? 'টেলিগ্রামে আপনার বট (@' + (status?.tgBotInfo?.username || 'Bot') + ') কে সরাসরি /start, /login বা নম্বর পাঠালেও এই কনসোলে লাইভ ইভেন্ট দেখতে পাবেন।'
            : 'You can also interact directly with the bot on Telegram and see live streaming events here in this console.'}
        </span>

        <button
          onClick={onSwitchToCode}
          className="text-xs text-emerald-400 hover:underline font-bold shrink-0 cursor-pointer"
        >
          {language === 'bn' ? '📄 bot.js কোড দেখুন →' : '📄 View bot.js file →'}
        </button>
      </div>

    </div>
  );
};
