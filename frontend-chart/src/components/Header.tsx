/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { CryptoPair } from "../types";
import { TrendingUp, RefreshCw, Layers, ShieldCheck, Zap, User, LogIn, LogOut, ChevronDown, Shield, Home, Bug, Copy, Check, Sun, Moon, Sliders, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { authTexts, headerUiTexts } from "../i18n/header";
import {
  getCurrentUser,
  seedAdminAccount,
  loginUser,
  registerUser,
  authenticateWithGoogle,
  authenticateWithAdmin,
  logoutUser,
  AuthUser
} from "../auth/stubs";

interface HeaderProps {
  isTickingAll: boolean;
  onToggleTicking: () => void;
  connectionStatus: "connected" | "syncing" | "stale";
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onOpenAdmin?: () => void;
  language: "RU" | "EN" | "KZ";
  onLanguageChange: (lang: "RU" | "EN" | "KZ") => void;
  userRole: "Guest" | "Free" | "Pro" | "VIP" | "Admin";
  onChangeUserRole: (role: "Guest" | "Free" | "Pro" | "VIP" | "Admin") => void;
  onOpenProfile?: () => void;
  onOpenHome?: () => void;
  onOpenRoadmap?: () => void;
}

export default function Header({
  isTickingAll,
  onToggleTicking,
  connectionStatus,
  theme = "dark",
  onToggleTheme,
  onOpenAdmin,
  language,
  onLanguageChange,
  userRole,
  onChangeUserRole,
  onOpenProfile,
  onOpenHome,
  onOpenRoadmap
}: HeaderProps) {
  
  const isLight = theme === "light";
  
  // Real-time simulated authorized profile state matching email/name from request, loading from localStorage
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());

  // Listen for external profile updates from local storage or profile page
  useEffect(() => {
    const handleUpdate = () => {
      setUser(getCurrentUser());
    };
    window.addEventListener("procluster_user_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("procluster_user_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  // Custom inputs for login inside clean modal
  const [loginEmail, setLoginEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");

  const [copied, setCopied] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Seed default admin account on startup so the user can test login immediately
  useEffect(() => {
    seedAdminAccount();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync logout
  const handleLogout = () => {
    logoutUser();
    setUser(null);
    setDropdownOpen(false);
  };

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    
    const langTexts = authTexts[language] || authTexts.EN;

    if (authTab === "login") {
      const result = loginUser(loginName, loginPassword, langTexts);
      if (result.success && result.user) {
        setUser(result.user);
        setShowLoginModal(false);
        // Clear fields
        setLoginName("");
        setLoginPassword("");
        setLoginEmail("");
        setConfirmPassword("");
      } else {
        setAuthError(result.error || "");
      }
    } else {
      const result = registerUser(loginName, loginEmail, loginPassword, confirmPassword, langTexts);
      if (result.success && result.user) {
        setUser(result.user);
        setShowLoginModal(false);
        // Clear fields
        setLoginName("");
        setLoginPassword("");
        setLoginEmail("");
        setConfirmPassword("");
      } else {
        setAuthError(result.error || "");
      }
    }
  };

  // Google Authentication Simulation with primary email
  const handleGoogleAuth = () => {
    const gUser = authenticateWithGoogle();
    setUser(gUser);
    setShowLoginModal(false);
  };

  // PROCLUSTER Logo — imported image
  const Logo = () => (
    <div className="flex items-center gap-3 select-none cursor-pointer group hover:opacity-95 transition-all duration-200">
      <img 
        src="/src/assets/images/procluster_logo_1779485281399.png" 
        alt="ProCluster" 
        className="h-10 w-auto object-contain group-hover:scale-105 active:scale-95 transition-all duration-200"
      />
    </div>
  );

  return (
    <header className={`border-b px-6 py-3 flex flex-wrap items-center justify-between gap-4 z-50 sticky top-0 transition-all duration-300 relative ${
      isLight ? "border-slate-200/50 shadow-sm" : "border-white/10 shadow-2xl"
    }`}>
      {/* Background layer decoupled to avoid nested backdrop-filter browser rendering conflicts */}
      <div className={`absolute inset-0 z-0 pointer-events-none rounded-none transition-all duration-300 ${
        isLight ? "bg-white/55 backdrop-blur-3xl saturate-150" : "bg-slate-950/45 backdrop-blur-md"
      }`} />

      <div className="flex items-center gap-8 relative z-10">
        <Logo />
      </div>

      {/* Centered BETA Badge with dynamic styling and link to project roadmap */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center">
        <button
          onClick={onOpenRoadmap}
          className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all duration-300 hover:scale-105 active:scale-98 select-none ${
            isLight
              ? "bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/30 text-amber-600 shadow-sm"
              : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-500 shadow-md shadow-amber-500/5 animate-pulse"
          }`}
          style={{ animationDuration: "2.5s" }}
          title={headerUiTexts[language].roadmapTooltip}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300" />
          <span>BETA</span>
        </button>
      </div>

      {/* Right Controls: Simple & Clean Authorized Profile / Login Section */}
      <div className="flex items-center gap-3 relative z-10" ref={dropdownRef}>
        {/* ADMIN MODAL TRIGGER */}
        {user && (user.name === "Admin" || user.email === "admin@procluster.io") && (
          <button
            onClick={onOpenAdmin}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all text-xs font-bold leading-none select-none ${
              isLight
                ? "bg-red-50 hover:bg-red-105 border-red-200 text-red-700 shadow-sm"
                : "bg-red-950/20 hover:bg-red-900/40 border-red-900/30 text-red-400 shadow-inner hover:text-red-300"
            }`}
            title={headerUiTexts[language].adminPanelTooltip}
          >
            <Sliders className="w-3.5 h-3.5 animate-pulse" />
            <span className="hidden sm:inline">
              {headerUiTexts[language].adminLabel}
            </span>
          </button>
        )}

        {/* LIGHT/DARK THEME TOGGLE BUTTON right next to the profile chip */}
        <button
          onClick={onToggleTheme}
          className={`flex items-center justify-center p-2 rounded-xl border cursor-pointer hover:scale-105 active:scale-95 transition-all ${
            isLight
              ? "bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800 shadow-sm"
              : "bg-slate-950/40 hover:bg-slate-900/60 border-white/5 text-yellow-400 hover:text-yellow-300 shadow-inner"
          }`}
          title={isLight 
            ? headerUiTexts[language].enableDarkTheme
            : headerUiTexts[language].enableLightTheme
          }
        >
          {isLight ? (
            <Moon className="w-4 h-4 text-slate-700 font-bold" />
          ) : (
            <Sun className="w-4 h-4 text-yellow-500 fill-yellow-500/10" />
          )}
        </button>

        {user ? (
          // USER IS LOGGED IN: Beautiful glassy profile chip
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200 cursor-pointer border shadow-inner hover:scale-[1.01] active:scale-[0.99] ${
                isLight
                  ? "border-slate-200 bg-slate-100 hover:bg-slate-200/80"
                  : "border-white/5 bg-slate-950/40 hover:bg-slate-900/60"
              }`}
            >
              <img
                src={user.avatar}
                alt={user.name}
                referrerPolicy="no-referrer"
                className={`w-6 h-6 rounded-lg object-cover select-none shadow border ${
                  isLight ? "border-slate-300" : "border-white/25"
                }`}
              />
              <div className="text-left hidden sm:block">
                <div className={`text-[11px] font-sans font-black leading-tight ${
                  isLight ? "text-slate-900" : "text-slate-200"
                }`}>
                  {user.name}
                </div>
                <div className={`text-[9px] font-mono leading-none ${
                  isLight ? "text-slate-600 font-bold" : "text-slate-400"
                }`}>
                  PRO MEMBER
                </div>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isLight ? "text-slate-700" : "text-slate-400"
              } ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className={`absolute right-0 mt-2.5 w-64 rounded-[28px] p-5 z-[99] text-left select-none font-sans transition-all border ${
                    isLight
                      ? "bg-white border-slate-200 text-slate-800 shadow-2xl"
                      : "muddy-glass-popover text-slate-100"
                  }`}
                >
                  {/* User Profile Header section */}
                  <div className={`flex items-center gap-3.5 pb-4 mb-4 border-b ${
                    isLight ? "border-slate-100" : "border-white/5"
                  }`}>
                    <img
                      src={user.avatar}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className={`w-11 h-11 rounded-full object-cover border-2 shadow-sm ${
                        isLight ? "border-slate-200" : "border-white/10"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className={`text-[14px] font-black flex items-center gap-1.5 leading-none ${
                        isLight ? "text-slate-800" : "text-slate-100"
                      }`}>
                        {user.name.toLowerCase()}
                      </div>
                      <div className={`text-[10px] font-mono mt-1 leading-none truncate ${
                        isLight ? "text-slate-500" : "text-slate-400"
                      }`}>
                        {user.email.toLowerCase()}
                      </div>
                    </div>
                  </div>

                  {/* Options List */}
                  <div className="flex flex-col gap-1">
                    <button 
                      onClick={() => {
                        setDropdownOpen(false);
                        if (onOpenProfile) onOpenProfile();
                      }}
                      className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? "text-slate-700 hover:text-slate-900 hover:bg-slate-100" : "text-slate-300 hover:text-white hover:bg-white/5"
                    }`}>
                      <User className="w-4 h-4 text-slate-500" />
                      <span>{headerUiTexts[language].profileAvatar}</span>
                    </button>

                    <button 
                      onClick={() => {
                        setDropdownOpen(false);
                        if (onOpenHome) onOpenHome();
                      }}
                      className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? "text-slate-700 hover:text-slate-900 hover:bg-slate-100" : "text-slate-300 hover:text-white hover:bg-white/5"
                    }`}>
                      <Home className="w-4 h-4 text-slate-500" />
                      <span>{headerUiTexts[language].home}</span>
                    </button>

                    <button className={`flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-bold cursor-pointer transition text-left ${
                      isLight ? "text-slate-700 hover:bg-red-50 hover:text-rose-600" : "text-slate-300 hover:text-white hover:bg-white/5"
                    }`}>
                      <Bug className="w-4 h-4 text-rose-500" />
                      <span>{headerUiTexts[language].foundError}</span>
                    </button>

                    {/* Copyable Workspace Segment */}
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText("7D53CEC5");
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className={`flex items-center justify-between gap-3 w-full px-3 py-2 rounded-2xl text-[12px] font-mono font-bold cursor-pointer transition text-left ${
                        isLight ? "text-slate-605 hover:text-slate-800 hover:bg-slate-100" : "text-slate-400 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Copy className="w-4 h-4 text-slate-500" />
                        <span className={`tracking-wider text-[11px] ${isLight ? "text-slate-800 font-bold" : "text-slate-300"}`}>7D53CEC5</span>
                      </div>
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <span className={`text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border ${
                          isLight ? "bg-slate-200 border-slate-300 text-slate-700" : "bg-white/5 border-white/5 text-slate-500"
                        }`}>
                          {headerUiTexts[language].copy}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Language selection block */}
                  <div className={`mt-4 pt-3.5 border-t ${isLight ? "border-slate-100" : "border-white/5"}`}>
                    <span className={`text-[9px] font-mono font-extrabold tracking-widest uppercase block mb-2 px-1 ${
                      isLight ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {headerUiTexts[language].language}
                    </span>
                    <div className={`grid grid-cols-3 gap-1.5 p-[3px] rounded-2xl border shadow-inner ${
                      isLight ? "bg-slate-100/80 border-slate-200/50" : "bg-slate-950/60 border-white/5"
                    }`}>
                      {["RU", "EN", "KZ"].map((lang) => {
                        const isSelected = language === lang;
                        return (
                          <button
                            key={lang}
                            onClick={() => onLanguageChange(lang as any)}
                            className="py-1.5 rounded-xl text-[10.5px] font-bold font-mono cursor-pointer text-center relative border-0 outline-none"
                          >
                            {isSelected && (
                              <motion.div
                                layoutId="activeLanguage"
                                className={`absolute inset-0 rounded-xl ${
                                  isLight 
                                    ? "bg-slate-300 border border-slate-400 shadow-sm"
                                    : "bg-slate-800 border border-white/10 shadow-md"
                                }`}
                                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                style={{ zIndex: 0 }}
                              />
                            )}
                            <span className={`relative z-10 transition-colors duration-200 ${
                              isSelected
                                ? isLight ? "text-slate-900 font-extrabold" : "text-white font-extrabold"
                                : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
                            }`}>
                              {lang}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* VIP & Admin Role Selector (Simulating subscription tier overrides) */}
                  {userRole === "Admin" && (
                    <div className={`mt-4 pt-3.5 border-t ${isLight ? "border-slate-100" : "border-white/5"}`}>
                      <span className={`text-[9px] font-mono font-extrabold tracking-widest uppercase block mb-2 px-1 ${
                        isLight ? "text-slate-500" : "text-slate-400"
                      }`}>
                        {headerUiTexts[language].subRole}
                      </span>
                      <div className={`grid ${
                        user && (user.name === "Admin" || user.email === "admin@procluster.io") ? "grid-cols-5" : "grid-cols-3"
                      } gap-1 p-[3px] rounded-2xl border shadow-inner ${
                        isLight ? "bg-slate-100/80 border-slate-200/50" : "bg-slate-950/60 border-white/5"
                      }`}>
                        {(user && (user.name === "Admin" || user.email === "admin@procluster.io") 
                          ? ["Guest", "Free", "Pro", "VIP", "Admin"] 
                          : ["Guest", "VIP", "Admin"]
                        ).map((roleOption) => {
                          const isSelected = userRole === roleOption;
                          let roleLabel = roleOption;
                          if (roleOption === "Guest") roleLabel = language === "RU" ? "Гость" : language === "KZ" ? "Қонақ" : "Guest";
                          if (roleOption === "Admin") roleLabel = language === "RU" ? "Админ" : language === "KZ" ? "Админ" : "Admin";
                          
                          return (
                            <button
                              key={roleOption}
                              onClick={() => onChangeUserRole(roleOption as any)}
                              className="py-1.5 rounded-xl text-[9px] font-black cursor-pointer text-center relative border-0 outline-none"
                            >
                              {isSelected && (
                                <motion.div
                                  layoutId="activeRole"
                                  className={`absolute inset-0 rounded-xl ${
                                    roleOption === "Admin"
                                      ? "bg-rose-500/25 border border-rose-500/35"
                                      : roleOption === "VIP"
                                        ? "bg-amber-500/25 border border-amber-500/35"
                                        : roleOption === "Pro"
                                          ? "bg-blue-500/25 border border-blue-500/35"
                                          : roleOption === "Free"
                                            ? "bg-slate-400/20 border border-slate-400/30"
                                            : "bg-purple-500/25 border border-purple-500/35"
                                  }`}
                                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                  style={{ zIndex: 0 }}
                                />
                              )}
                              <span className={`relative z-10 transition-colors duration-200 ${
                                isSelected
                                  ? roleOption === "Admin"
                                    ? "text-rose-500 font-extrabold"
                                    : roleOption === "VIP"
                                      ? "text-amber-500 font-extrabold"
                                      : roleOption === "Pro"
                                        ? "text-blue-500 font-extrabold"
                                        : roleOption === "Free"
                                          ? "text-slate-500 font-extrabold"
                                          : isLight ? "text-purple-650 font-extrabold" : "text-purple-400 font-extrabold"
                                  : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
                              }`}>
                                {roleLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Exiting separator */}
                  <div className={`mt-4 pt-3 border-t text-left ${isLight ? "border-slate-100" : "border-white/5"}`}>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-2xl text-[11px] font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50/55 cursor-pointer transition duration-150 text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{headerUiTexts[language].logout}</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          // USER IS NOT LOGGED IN: Beautiful glassy Sign In Button next to the light/dark toggle
          <button
            onClick={() => {
              setAuthError("");
              setAuthTab("login");
              setShowLoginModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide cursor-pointer text-yellow-600 hover:scale-[1.02] active:scale-[0.98] transition-all border liquid-glass-active"
          >
            <LogIn className="w-4 h-4 text-yellow-500" />
            Sign In
          </button>
        )}
      </div>

      {/* Glassy Login Modal overlay adapted for dark/light themes */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Backdrop Blur screen shadow */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLoginModal(false)}
              className={`absolute inset-0 backdrop-blur-md transition-opacity duration-300 ${
                isLight ? "bg-slate-900/30" : "bg-[#020617]/75"
              }`}
            />

            {/* Modal Body with deep glassy premium design, optimized for theme transparency */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={`relative w-full max-w-sm rounded-[24px] p-6 border transition-all duration-300 muddy-glass-popover ${
                isLight 
                  ? "border-slate-200/80 text-slate-900" 
                  : "border-white/5 text-slate-100"
              }`}
            >
              {/* Modal Header */}
              <div className="text-center mb-5">
                <div className={`inline-flex p-3 rounded-2xl mb-3 shadow-md ${
                  isLight 
                    ? "bg-amber-500/10 border border-amber-500/20 text-amber-600" 
                    : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.15)]"
                }`}>
                  <User className="w-6 h-6" />
                </div>
                <h3 className={`text-base font-black tracking-tight leading-none mb-1.5 uppercase ${
                  isLight ? "text-slate-900" : "text-slate-100"
                }`}>
                  {(authTexts[language] || authTexts.EN).title}
                </h3>
                <p className={`text-[10px] leading-snug font-semibold max-w-[250px] mx-auto ${
                  isLight ? "text-slate-600" : "text-slate-400"
                }`}>
                  {(authTexts[language] || authTexts.EN).subtitle}
                </p>
              </div>

              {/* Dynamic Tabs Indicator Selection */}
              <div className={`grid grid-cols-2 p-1 rounded-2xl border mb-5 ${
                isLight ? "bg-slate-200 border-slate-300" : "bg-slate-950/60 border-white/10"
              }`}>
                {(["login", "register"] as const).map((tab) => {
                  const isSelected = authTab === tab;
                  const label = tab === "login" 
                    ? (authTexts[language] || authTexts.EN).loginTab
                    : (authTexts[language] || authTexts.EN).registerTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setAuthError("");
                        setAuthTab(tab);
                      }}
                      className={`py-1.5 rounded-xl text-xs font-black uppercase transition-all relative border-0 outline-none cursor-pointer ${
                        isSelected 
                          ? isLight 
                            ? "bg-white text-slate-900 border border-slate-300 shadow-sm" 
                            : "bg-yellow-500/10 border border-yellow-500/25 text-yellow-500"
                          : isLight 
                            ? "text-slate-600 hover:text-slate-900" 
                            : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Error messages block */}
              {authError && (
                <div className={`px-3 py-2.5 rounded-xl text-center text-[10px] font-black mb-4 border ${
                  isLight 
                    ? "bg-rose-50 border-rose-200 text-rose-700" 
                    : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                }`}>
                  {authError}
                </div>
              )}

              {/* Form implementation */}
              <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4 font-sans text-xs">
                <div>
                  <label className={`text-[9px] font-extrabold uppercase tracking-widest block mb-1 ${
                    isLight ? "text-slate-700" : "text-slate-400"
                  }`}>
                    {(authTexts[language] || authTexts.EN).usernameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={authTab === "login" ? "e.g. admin" : "e.g. user1"}
                    value={loginName}
                    onChange={(e) => {
                      setAuthError("");
                      setLoginName(e.target.value);
                    }}
                    className={`w-full rounded-xl px-4 py-2.5 outline-none transition font-black ${
                      isLight 
                        ? "bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500/80 shadow-inner" 
                        : "bg-slate-950/60 border border-white/15 text-slate-200 placeholder-slate-600 focus:border-yellow-500/50"
                    }`}
                  />
                </div>

                {authTab === "register" && (
                  <div>
                    <label className={`text-[9px] font-extrabold uppercase tracking-widest block mb-1 ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>
                      {(authTexts[language] || authTexts.EN).emailLabel}
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. email@domain.com"
                      value={loginEmail}
                      onChange={(e) => {
                        setAuthError("");
                        setLoginEmail(e.target.value);
                      }}
                      className={`w-full rounded-xl px-4 py-2.5 outline-none transition font-black font-mono ${
                        isLight 
                          ? "bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500/80 shadow-inner" 
                          : "bg-slate-950/60 border border-white/15 text-slate-200 placeholder-slate-600 focus:border-yellow-500/50"
                      }`}
                    />
                  </div>
                )}

                <div>
                  <label className={`text-[9px] font-extrabold uppercase tracking-widest block mb-1 ${
                    isLight ? "text-slate-700" : "text-slate-400"
                  }`}>
                    {(authTexts[language] || authTexts.EN).passwordLabel}
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => {
                      setAuthError("");
                      setLoginPassword(e.target.value);
                    }}
                    className={`w-full rounded-xl px-4 py-2.5 outline-none transition font-black font-mono ${
                      isLight 
                        ? "bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500/80 shadow-inner" 
                        : "bg-slate-950/60 border border-white/15 text-slate-200 placeholder-slate-600 focus:border-yellow-500/50"
                    }`}
                  />
                </div>

                {authTab === "register" && (
                  <div>
                    <label className={`text-[9px] font-extrabold uppercase tracking-widest block mb-1 ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>
                      {(authTexts[language] || authTexts.EN).confirmPasswordLabel}
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => {
                        setAuthError("");
                        setConfirmPassword(e.target.value);
                      }}
                      className={`w-full rounded-xl px-4 py-2.5 outline-none transition font-black font-mono ${
                        isLight 
                          ? "bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500/80 shadow-inner" 
                          : "bg-slate-950/60 border border-white/15 text-slate-200 placeholder-slate-600 focus:border-yellow-500/50"
                      }`}
                    />
                  </div>
                )}

                {/* Form cancel/authorize triggers */}
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowLoginModal(false)}
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wide cursor-pointer transition liquid-glass-button"
                  >
                    {(authTexts[language] || authTexts.EN).cancelBtn}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-extrabold uppercase tracking-wide cursor-pointer transition liquid-glass-gold-button"
                  >
                    {authTab === "login" 
                      ? (authTexts[language] || authTexts.EN).authBtn
                      : (authTexts[language] || authTexts.EN).regBtn
                    }
                  </button>
                </div>
              </form>

              {/* OAuth and Prepopulated Quick-Sign-Ins */}
              <div className={`mt-5 pt-4 border-t flex flex-col gap-2 ${
                isLight ? "border-slate-200" : "border-white/5"
              }`}>
                <span className={`text-[8px] font-mono font-bold tracking-widest uppercase block text-center mb-1 ${
                  isLight ? "text-slate-500" : "text-slate-400/80"
                }`}>
                  {(authTexts[language] || authTexts.EN).orInstant}
                </span>

                {/* Google Authentication Integration */}
                <button
                  onClick={handleGoogleAuth}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[10.5px] font-bold cursor-pointer transition-all border ${
                    isLight 
                      ? "bg-white hover:bg-slate-50 border-slate-300 text-slate-800 shadow-sm" 
                      : "bg-white/5 hover:bg-white/10 border-white/5 text-slate-200"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                  </svg>
                  <span>{(authTexts[language] || authTexts.EN).googleAuth}</span>
                </button>

                {/* Prepopulated admin quick-action triggers */}
                <button
                  type="button"
                  onClick={() => {
                    const adminUser = authenticateWithAdmin();
                    setUser(adminUser);
                    setShowLoginModal(false);
                  }}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold cursor-pointer transition-all border ${
                    isLight 
                      ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700" 
                      : "bg-white/5 hover:bg-white/10 border-white/5 text-slate-200"
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-yellow-500" />
                  <span>{(authTexts[language] || authTexts.EN).autoLogin}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
}
