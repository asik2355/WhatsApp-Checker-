import React, { useState, useEffect } from 'react';
import { Copy, Check, Download, FileCode, Play, Terminal, ExternalLink } from 'lucide-react';

interface BotCodeViewerProps {
  language: 'bn' | 'en';
  onSwitchToVps: () => void;
}

export const BotCodeViewer: React.FC<BotCodeViewerProps> = ({ language, onSwitchToVps }) => {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/vps/bot-code')
      .then(res => res.json())
      .then(data => {
        if (data.code) {
          setCode(data.code);
        }
      })
      .catch(err => {
        console.error('Failed to load bot code:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleCopyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCommand = (cmd: string, key: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleDownload = (filename: string = 'bot.js') => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPackageJson = () => {
    const pkg = {
      name: "linkify-telegram-whatsapp-bot",
      version: "1.0.0",
      private: true,
      type: "module",
      main: "index.js",
      scripts: {
        start: "node index.js",
        bot: "node bot.js"
      },
      dependencies: {
        "@whiskeysockets/baileys": "^7.0.0-rc13",
        "pino": "^10.3.1",
        "telegram": "^2.26.22"
      }
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'package.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full space-y-4 font-sans text-left">
      
      {/* 1. Header Banner & Actions */}
      <div className="bg-[#111b21] p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-800/40 text-emerald-400 flex items-center justify-center shrink-0">
            <FileCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm md:text-base font-bold text-gray-100 flex items-center gap-2">
              <span>index.js / bot.js</span>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                Standalone Node.js ESM
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {language === 'bn' 
                ? 'Zero-Bot বা প্যানেলে হোস্ট করতে নিচের সবুজ বাটন থেকে index.js এবং package.json ডাউনলোড করে আপলোড করুন।' 
                : 'Self-contained standalone single file with Baileys + Telegram bot engine.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleDownload('index.js')}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-gray-950 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{language === 'bn' ? 'index.js ডাউনলোড (Zero-Bot)' : 'Download index.js'}</span>
          </button>

          <button
            onClick={handleDownloadPackageJson}
            className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-gray-950 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{language === 'bn' ? 'package.json ডাউনলোড' : 'Download package.json'}</span>
          </button>

          <button
            onClick={() => handleDownload('bot.js')}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{language === 'bn' ? 'bot.js ডাউনলোড' : 'Download bot.js'}</span>
          </button>

          <button
            onClick={handleCopyCode}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{language === 'bn' ? 'কপি হয়েছে!' : 'Copied!'}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{language === 'bn' ? 'কোড কপি' : 'Copy Code'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Quick VPS Run Instructions Guide */}
      <div className="bg-[#111b21] p-4 rounded-2xl border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          <span>{language === 'bn' ? 'আপনার নিজস্ব VPS এ চালানোর ৩-ধাপের নির্দেশিকা:' : 'How to run on your own Linux / Windows VPS:'}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {/* Step 1 */}
          <div className="bg-[#0b141a] p-3 rounded-xl border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-200">
                1. {language === 'bn' ? 'ডিপেন্ডেন্সি ইন্সটল' : 'Install Dependencies'}
              </span>
              <button
                onClick={() => handleCopyCommand('npm install @whiskeysockets/baileys pino qrcode-terminal', 'step1')}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                {copiedCmd === 'step1' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <code className="text-[10px] text-emerald-400 font-mono block bg-black/40 p-2 rounded break-all select-all">
              npm install @whiskeysockets/baileys pino qrcode-terminal
            </code>
          </div>

          {/* Step 2 */}
          <div className="bg-[#0b141a] p-3 rounded-xl border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-200">
                2. {language === 'bn' ? 'বট টোকেন সেট' : 'Set Telegram Token'}
              </span>
              <button
                onClick={() => handleCopyCommand('export TG_TOKEN="8887360085:AAGFnQjUY1lnmDwHJTFo3T7O56xFEW9poGU"', 'step2')}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                {copiedCmd === 'step2' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <code className="text-[10px] text-emerald-400 font-mono block bg-black/40 p-2 rounded break-all select-all">
              export TG_TOKEN="8887360085:AAGFnQjUY1lnmDwHJTFo3T7O56xFEW9poGU"
            </code>
          </div>

          {/* Step 3 */}
          <div className="bg-[#0b141a] p-3 rounded-xl border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-200">
                3. {language === 'bn' ? 'রান করুন' : 'Run Script'}
              </span>
              <button
                onClick={() => handleCopyCommand('node bot.js', 'step3')}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                {copiedCmd === 'step3' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <code className="text-[10px] text-emerald-400 font-mono block bg-black/40 p-2 rounded break-all select-all">
              node bot.js
            </code>
          </div>
        </div>
      </div>

      {/* 3. Code View Screen */}
      <div className="bg-[#090d10] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="bg-[#111b21] px-4 py-2 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
            <span className="ml-2 font-bold text-slate-300">bot.js</span>
            <span className="text-slate-600">({code.split('\n').length} lines)</span>
          </div>

          <button
            onClick={handleCopyCode}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono font-bold flex items-center gap-1 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[500px] overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 bg-[#070b0e] select-all">
          {loading ? 'Loading bot.js source...' : code}
        </pre>
      </div>

    </div>
  );
};
