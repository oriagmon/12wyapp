export {
  LOCALES,
  LOCALE_DIR,
  LOCALE_LABELS,
  LOCALE_TAGS,
  DEFAULT_LOCALE,
  isLocale,
  negotiateLocale,
  type Locale,
  type AreaDict,
  type Dict,
} from './locales';

export { getActiveLocale, setActiveLocale } from './activeLocale';
export { translateActive } from './translateActive';

export {
  LocaleProvider,
  useTranslation,
  resolveInitialLocale,
  readStoredLocale,
  type LocaleContextValue,
} from './LocaleProvider';

export { interpolate, createTranslator, type Translator, type TParams } from './translate';

export { dictionaries, AREAS } from './dict';
