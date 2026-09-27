import type { AuthUser } from '../context/AuthContext';
import type { PartnerInfo } from '../lib/types';
import { personLabel } from '../lib/people';
import { Avatar } from './Avatar';
import { useTranslation } from '../i18n';
import styles from './CompetitionBanner.module.css';

type Props = {
  user: AuthUser;
  partner: PartnerInfo;
  ownAverage: number | null;
  partnerAverage: number | null;
};

function formatAverage(value: number | null) {
  return value === null ? '—' : `${value}%`;
}

export function CompetitionBanner({ user, partner, ownAverage, partnerAverage }: Props) {
  const { t } = useTranslation();
  const bothScored = ownAverage !== null && partnerAverage !== null;
  const gap = bothScored ? Math.round(Math.abs(ownAverage - partnerAverage) * 10) / 10 : null;
  const ownLeads = bothScored && ownAverage > partnerAverage;
  const partnerLeads = bothScored && partnerAverage > ownAverage;
  const message =
    !bothScored
      ? t('dashboard.competition.awaiting')
      : gap === 0
        ? t('dashboard.competition.tied')
        : ownLeads
          ? t('dashboard.competition.ahead', { gap: gap ?? 0 })
          : t('dashboard.competition.behind', { gap: gap ?? 0 });

  return (
    <section className={`card ${styles.banner}`} aria-label={t('dashboard.competition.label')}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t('dashboard.competition.eyebrow')}</span>
          <h2>{t('dashboard.competition.title')}</h2>
        </div>
        <span className={styles.vs} aria-hidden="true">VS</span>
      </div>

      <div className={styles.competitors}>
        <div className={`${styles.competitor} ${ownLeads ? styles.leading : ''}`}>
          <Avatar
            userId={user.id}
            displayName={user.displayName}
            email={user.email}
            hasAvatar={user.hasAvatar}
            avatarVersion={user.avatarVersion}
            size="md"
          />
          <div className={styles.identity}>
            <strong>{t('dashboard.competition.you')}</strong>
            <span>{personLabel(user)}</span>
          </div>
          <strong className={styles.score}>{formatAverage(ownAverage)}</strong>
        </div>

        <div className={styles.divider} aria-hidden="true" />

        <div className={`${styles.competitor} ${partnerLeads ? styles.leading : ''}`}>
          <Avatar
            userId={partner.id}
            displayName={partner.displayName}
            email={partner.email}
            hasAvatar={partner.hasAvatar ?? false}
            avatarVersion={partner.avatarVersion ?? 0}
            size="md"
          />
          <div className={styles.identity}>
            <strong>{t('dashboard.competition.partner')}</strong>
            <span>{personLabel(partner)}</span>
          </div>
          <strong className={styles.score}>{formatAverage(partnerAverage)}</strong>
        </div>
      </div>

      <div className={styles.challenge}>
        <strong>{message}</strong>
        <span>{t('dashboard.competition.averageNote')}</span>
      </div>
    </section>
  );
}
