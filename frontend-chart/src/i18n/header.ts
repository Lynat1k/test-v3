/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AuthTexts {
  title: string;
  subtitle: string;
  loginTab: string;
  registerTab: string;
  usernameLabel: string;
  emailLabel: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  cancelBtn: string;
  authBtn: string;
  regBtn: string;
  orInstant: string;
  autoLogin: string;
  googleAuth: string;
  errorUserNotFound: string;
  errorPasswordMismatch: string;
  errorUsernameExists: string;
  errorEmptyFields: string;
}

export const authTexts: Record<"RU" | "EN" | "KZ", AuthTexts> = {
  RU: {
    title: "Авторизация Терминала",
    subtitle: "Войдите, чтобы сохранять лимитные ордера и синхронизировать настройки footprint на устройствах.",
    loginTab: "Вход",
    registerTab: "Регистрация",
    usernameLabel: "Логин / Никнейм",
    emailLabel: "Электронная почта",
    passwordLabel: "Пароль",
    confirmPasswordLabel: "Повторите пароль",
    cancelBtn: "Отмена",
    authBtn: "Войти",
    regBtn: "Зарегистрироваться",
    orInstant: "Или моментальный вход",
    autoLogin: "Войти авто-сессией как admin",
    googleAuth: "Войти через Google",
    errorUserNotFound: "Пользователь не найден или неверный пароль",
    errorPasswordMismatch: "Пароли не совпадают!",
    errorUsernameExists: "Этот логин уже занят!",
    errorEmptyFields: "Пожалуйста, заполните все обязательные поля."
  },
  EN: {
    title: "Terminal Authorization",
    subtitle: "Sign in to save custom limit orders and sync footprint layouts across devices.",
    loginTab: "Log In",
    registerTab: "Register",
    usernameLabel: "Username / Login",
    emailLabel: "Email Address",
    passwordLabel: "Password",
    confirmPasswordLabel: "Confirm Password",
    cancelBtn: "Cancel",
    authBtn: "Log In",
    regBtn: "Sign Up",
    orInstant: "Or Instant Authorization",
    autoLogin: "Auto-login as admin",
    googleAuth: "Continue with Google",
    errorUserNotFound: "User not found or invalid password",
    errorPasswordMismatch: "Passwords do not match!",
    errorUsernameExists: "Username is already taken!",
    errorEmptyFields: "Please fill in all required fields."
  },
  KZ: {
    title: "Терминал авторизациясы",
    subtitle: "Лимиттік тапсырыстарды сақтау және құрылғылар арасында footprint баптауларын синхрондау үшін кіріңіз.",
    loginTab: "Кіру",
    registerTab: "Тіркелу",
    usernameLabel: "Логин / Никнейм",
    emailLabel: "Электрондық пошта",
    passwordLabel: "Құпия сөз",
    confirmPasswordLabel: "Құпия сөзді растаңыз",
    cancelBtn: "Бас тарту",
    authBtn: "Кіру",
    regBtn: "Тіркелу",
    orInstant: "Немесе жылдам кіру",
    autoLogin: "admin ретінде жылдам кіру",
    googleAuth: "Google арқылы кіру",
    errorUserNotFound: "Пайдаланушы табылмады немесе құпия сөз қате",
    errorPasswordMismatch: "Құпия сөздер сәйкес келмейді!",
    errorUsernameExists: "Бұл логин бос емес!",
    errorEmptyFields: "Барлық өрістерді толтырыңыз."
  }
};

export const headerUiTexts = {
  RU: {
    roadmapTooltip: "Открыть дорожную карту проекта",
    adminPanelTooltip: "Панель администратора",
    adminLabel: "Админка",
    enableDarkTheme: "Включить темную тему",
    enableLightTheme: "Включить светлую тему",
    profileAvatar: "Профиль и аватар",
    home: "Главная",
    foundError: "Нашли ошибку?",
    copy: "КОПИРОВАТЬ",
    language: "ЯЗЫК",
    subRole: "РОЛЬ И ДОСТУП",
    logout: "Выйти"
  },
  EN: {
    roadmapTooltip: "Open Project Roadmap",
    adminPanelTooltip: "Admin Panel",
    adminLabel: "Admin",
    enableDarkTheme: "Enable Dark Theme",
    enableLightTheme: "Enable Light Theme",
    profileAvatar: "Profile & avatar",
    home: "Home",
    foundError: "Found an error?",
    copy: "COPY",
    language: "LANGUAGE",
    subRole: "SUBSCRIPTION ROLE",
    logout: "Logout"
  },
  KZ: {
    roadmapTooltip: "Жобаның жол картасын ашу",
    adminPanelTooltip: "Әкімшілік панелі",
    adminLabel: "Әкімшілік",
    enableDarkTheme: "Түнгі режим",
    enableLightTheme: "Күндізгі режим",
    profileAvatar: "Профиль және аватар",
    home: "Басты бет",
    foundError: "Қате таптыңыз ба?",
    copy: "КӨШІРУ",
    language: "ТІЛ",
    subRole: "ТІРКЕЛГІ ДӘРЕЖЕСІ",
    logout: "Шығу"
  }
};
