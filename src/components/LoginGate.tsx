import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, HelpCircle, ArrowRight } from 'lucide-react';

const AUTH_STORAGE_KEY = 'mailforge_auth_date_v1';

/**
 * Generates all valid date tokens for a given Date object (YYYYMMDD, MMDD, ROC, etc.)
 */
function getValidPasswordsForDate(d: Date): Set<string> {
  const yyyy = String(d.getFullYear());
  const roc = String(d.getFullYear() - 1911);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const m = String(d.getMonth() + 1);
  const dd = String(d.getDate()).padStart(2, '0');
  const day = String(d.getDate());

  const dateVariants = [
    `${yyyy}${mm}${dd}`,       // 20261011
    `${yyyy}${m}${day}`,       // 20261011 (unpadded)
    `${mm}${dd}`,              // 1011
    `${m}${day}`,              // 1011 (unpadded)
    `${yyyy}-${mm}-${dd}`,     // 2026-10-11
    `${yyyy}/${mm}/${dd}`,     // 2026/10/11
    `${yyyy}-${m}-${day}`,     // 2026-10-11
    `${yyyy}/${m}/${day}`,     // 2026/10/11
    `${mm}/${dd}`,             // 10/11
    `${mm}-${dd}`,             // 10-11
    `${roc}${mm}${dd}`,        // 1151011 (Minguo)
    `${roc}/${mm}/${dd}`,      // 115/10/11
    `${roc}-${mm}-${dd}`,      // 115-10-11
  ];

  const validSet = new Set<string>();
  for (const variant of dateVariants) {
    validSet.add(`DV${variant}`);
    validSet.add(`DV+${variant}`);
    validSet.add(`DV-${variant}`);
  }
  return validSet;
}

/**
 * Returns today's canonical YYYYMMDD key for session storage validation.
 */
export function getTodayDateStamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Validates whether the user's input matches "DV + 今日日期" (checks both local timezone and Asia/Taipei).
 */
export function verifyDailyPassword(rawInput: string): boolean {
  const cleaned = rawInput.trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned) return false;

  const now = new Date();
  const localValid = getValidPasswordsForDate(now);
  if (localValid.has(cleaned)) return true;

  // Also check Asia/Taipei (UTC+8) in case user's browser timezone differs
  try {
    const taipeiStr = now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
    const taipeiDate = new Date(taipeiStr);
    const taipeiValid = getValidPasswordsForDate(taipeiDate);
    if (taipeiValid.has(cleaned)) return true;
  } catch {
    // ignore timezone conversion fallback
  }

  return false;
}

/**
 * Checks if user is already authenticated for today.
 */
export function isAuthenticatedForToday(): boolean {
  try {
    const savedStamp = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
    return savedStamp === getTodayDateStamp();
  } catch {
    return false;
  }
}

/**
 * Saves today's authentication state.
 */
export function saveAuthenticationForToday(): void {
  try {
    const stamp = getTodayDateStamp();
    sessionStorage.setItem(AUTH_STORAGE_KEY, stamp);
    localStorage.setItem(AUTH_STORAGE_KEY, stamp);
  } catch {
    // ignore
  }
}

/**
 * Clears authentication state (Logout / Lock).
 */
export function clearAuthentication(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface LoginGateProps {
  onSuccess: () => void;
}

export function LoginGate({ onSuccess }: LoginGateProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyDailyPassword(password)) {
      saveAuthenticationForToday();
      setError(false);
      onSuccess();
    } else {
      setError(true);
      setShowHint(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-50 px-4 py-12 text-slate-900">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            MailForge 系統存取驗證
          </h1>
          <p className="text-xs text-slate-500">
            請輸入今日授權登錄密碼以進入高級郵件草稿生成工具
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="login-password-input"
                className="text-xs font-semibold text-slate-700"
              >
                登錄密碼
              </label>
              <button
                type="button"
                onClick={() => setShowHint((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                密碼提示
              </button>
            </div>

            <div className="relative">
              <input
                id="login-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoFocus
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(false);
                }}
                placeholder="請輸入登錄密碼..."
                className={`w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none transition-colors ${
                  error
                    ? 'border-rose-500 focus:border-rose-600'
                    : 'border-slate-300 focus:border-indigo-600'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Password Hint Box */}
          {(showHint || error) && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                error
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <AlertCircle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  error ? 'text-rose-600' : 'text-indigo-600'
                }`}
              />
              <div className="space-y-0.5">
                {error && (
                  <p className="font-semibold text-rose-900">
                    密碼驗證失敗，請確認後重新輸入。
                  </p>
                )}
                <p className="font-medium">
                  密碼提示：<strong className="underline underline-offset-4">請聯絡開發者</strong>
                </p>
              </div>
            </div>
          )}

          {/* Always-visible subtle hint footer */}
          {!showHint && !error && (
            <p className="text-xs text-slate-500 text-center">
              密碼提示：請聯絡開發者
            </p>
          )}

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] rounded-xl transition-all cursor-pointer shadow-xs"
          >
            <span>驗證並進入系統</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
