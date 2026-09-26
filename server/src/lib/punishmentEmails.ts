import type Database from 'better-sqlite3';
import { getEmailConfig } from '../config.js';
import { renderBrandedEmail, type BrandedEmail } from './emailBranding.js';
import { sendEmail } from './emailSender.js';
import { t } from './i18n/index.js';
import type { Locale } from './i18n/core.js';

type Participant = {
  id: number;
  email: string;
  label: string;
  locale: Locale;
};

type PunishmentEmailDetails = {
  authorLabel: string;
  assignedLabel: string;
  label: string;
  week: number;
};

function loadParticipants(
  db: Database.Database,
  participantIds: [number, number],
): [Participant, Participant] {
  const rows = db
    .prepare('SELECT id, email, display_name, locale FROM users WHERE id IN (?, ?)')
    .all(...participantIds) as {
      id: number;
      email: string;
      display_name: string | null;
      locale: string | null;
    }[];
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        email: row.email,
        label: row.display_name?.trim() || row.email,
        locale: row.locale === 'he' ? 'he' : 'en',
      } satisfies Participant,
    ]),
  );
  const first = byId.get(participantIds[0]);
  const second = byId.get(participantIds[1]);
  if (!first || !second) throw new Error('punishment email participant not found');
  return [first, second];
}

export function buildPunishmentEmail(
  appUrl: string,
  details: PunishmentEmailDetails,
  locale: Locale,
): BrandedEmail {
  const tl = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  return renderBrandedEmail(
    {
      subject: tl('emails.punishment.subject'),
      eyebrow: tl('emails.punishment.eyebrow'),
      title: tl('emails.punishment.title', { week: details.week }),
      preheader: tl('emails.punishment.preheader', { author: details.authorLabel }),
      paragraphs: [
        tl('emails.punishment.intro', {
          author: details.authorLabel,
          assignee: details.assignedLabel,
        }),
      ],
      callout: {
        title: tl('emails.punishment.calloutTitle'),
        text: details.label,
      },
      cta: { label: tl('emails.cta.openApp'), url: appUrl },
      footer: tl('emails.punishment.footer'),
    },
    locale,
  );
}

export function schedulePunishmentCreatedEmails(
  db: Database.Database,
  input: {
    participantIds: [number, number];
    authorUserId: number;
    assignedUserId: number;
    label: string;
    week: number;
  },
) {
  setImmediate(() => {
    let participants: [Participant, Participant];
    let author: Participant;
    let assigned: Participant;
    let appUrl: string;
    try {
      participants = loadParticipants(db, input.participantIds);
      const foundAuthor = participants.find((participant) => participant.id === input.authorUserId);
      const foundAssigned = participants.find(
        (participant) => participant.id === input.assignedUserId,
      );
      if (!foundAuthor || !foundAssigned) {
        throw new Error('punishment email author or assignee not found');
      }
      author = foundAuthor;
      assigned = foundAssigned;
      appUrl = getEmailConfig().appUrl;
    } catch (error) {
      console.error(
        `[punishment-email] preparation error: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }

    for (const recipient of participants) {
      const email = buildPunishmentEmail(
        appUrl,
        {
          authorLabel: author.label,
          assignedLabel: assigned.label,
          label: input.label,
          week: input.week,
        },
        recipient.locale,
      );
      void sendEmail({ to: recipient.email, ...email }).catch((error: unknown) => {
        console.error(
          `[punishment-email] send failed for user ${recipient.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }
  });
}
