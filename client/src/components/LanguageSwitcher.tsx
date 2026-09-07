import { LOCALES, LOCALE_LABELS, type Locale } from '../i18n/locales';
import { useTranslation } from '../i18n';
import styles from './LanguageSwitcher.module.css';

/**
 * Two languages means a segmented toggle beats a dropdown: both options stay visible and
 * it is one tap. Each option is labelled in its own language, so someone who cannot read
 * the current interface can still find their way out of it.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div
      className={`${styles.switcher} ${className ?? ''}`}
      role="group"
      aria-label={t('common.language.switch')}
    >
      {LOCALES.map((option: Locale) => (
        <button
          key={option}
          type="button"
          lang={option}
          className={`${styles.option} ${option === locale ? styles.active : ''}`}
          aria-pressed={option === locale}
          onClick={() => setLocale(option)}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
