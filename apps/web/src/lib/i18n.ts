import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocal, setLocal } from './storage';

// English strings are the keys themselves; Hindi maps English -> Hindi and is loaded only when chosen.
const saved = getLocal('hh-lang');
const initial = saved === 'hi' ? 'hi' : 'en';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  resources: { en: { translation: {} } },
});

async function load(lng: 'en' | 'hi') {
  if (lng === 'hi' && !i18n.hasResourceBundle('hi', 'translation')) {
    const hi = (await import('@/locales/hi.json')).default;
    i18n.addResourceBundle('hi', 'translation', hi, true, true);
  }
  document.documentElement.lang = lng;
  await i18n.changeLanguage(lng);
}

if (initial === 'hi') void load('hi');

export function setLanguage(lng: 'en' | 'hi') {
  setLocal('hh-lang', lng);
  void load(lng);
}

export default i18n;
