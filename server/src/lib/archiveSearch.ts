import type Database from 'better-sqlite3';
import { getAcceptedPartnershipForUser, otherUserId } from './wam.js';

export type ArchiveSearchCategory = 'cycles' | 'goals' | 'tactics' | 'wams' | 'commitments' | 'punishments' | 'reminders';

export type ArchiveSearchTarget =
  | { kind: 'cycle'; userId: number; cycleId: number; week: number; goalId?: number; tacticId?: number }
  | { kind: 'wam'; userId: number; cycleId: number | null; wamId: number; week: number; commitmentId?: number; punishmentId?: number }
  | { kind: 'reminder'; reminderId: number };

export interface ArchiveSearchItem {
  id: number;
  title: string;
  snippet: string;
  matchedField: string;
  cycleName: string | null;
  isArchived: boolean | null;
  ownership: 'mine' | 'partner' | 'shared';
  target: ArchiveSearchTarget;
}

interface SearchRow {
  id: number;
  title: string;
  matchedText: string;
  matchedField: string;
  userId: number;
  cycleId: number | null;
  cycleName: string | null;
  isArchived: number | null;
  week: number;
  goalId?: number;
  wamId?: number;
}

interface SearchSource {
  category: ArchiveSearchCategory;
  from: string;
  where: string;
  columns: string;
  fields: readonly (readonly [column: string, label: string])[];
  order: string;
}

// SQLite LIKE folds ASCII, not arbitrary Unicode. Keep excerpt/highlight matching identical.
function foldAscii(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function clip(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text;
}

function excerpt(text: string, query: string): string {
  const chars = Array.from(text);
  const position = foldAscii(text).indexOf(foldAscii(query));
  const matchStart = Array.from(text.slice(0, Math.max(0, position))).length;
  const start = Math.max(0, matchStart - 40);
  const end = Math.min(chars.length, start + 180);
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '…' : ''}`;
}

const cycleColumns = `c.user_id AS userId, c.id AS cycleId, c.name AS cycleName,
  1 - c.is_active AS isArchived, c.current_week AS week`;
const cycleScope = '(c.user_id = @viewerId OR c.user_id = @partnerId)';
const cycleOrder = 'c.is_active DESC, c.created_at DESC, c.id DESC';
const wamJoins = `LEFT JOIN cycles ca ON ca.id = w.initiator_cycle_id
  LEFT JOIN cycles cb ON cb.id = w.invitee_cycle_id`;
const wamColumns = `@viewerId AS userId, w.id AS wamId, w.week,
  CASE WHEN @viewerIsInitiator = 1 THEN w.initiator_cycle_id ELSE w.invitee_cycle_id END AS cycleId,
  CASE WHEN @viewerIsInitiator = 1 THEN ca.name ELSE cb.name END AS cycleName,
  CASE WHEN ca.is_active = 0 OR cb.is_active = 0 THEN 1 ELSE 0 END AS isArchived`;
const wamOrder = 'isArchived ASC, w.updated_at DESC, w.id DESC';

const sources: readonly SearchSource[] = [
  {
    category: 'cycles', from: 'cycles c', where: cycleScope,
    columns: `c.id, c.name AS title, ${cycleColumns}`,
    fields: [
      ['c.name', 'שם המחזור'], ['c.vision', 'חזון'], ['c.success_definition', 'הגדרת הצלחה'],
      ['c.why_it_matters', 'למה זה חשוב'], ['c.blockers', 'חסמים'], ['c.risks', 'סיכונים'],
      ['c.lag_measures', 'מדדי תוצאה'], ['c.lead_measures', 'מדדי ביצוע'], ['c.notes', 'הערות'],
    ],
    order: cycleOrder,
  },
  {
    category: 'goals', from: 'goals g JOIN cycles c ON c.id = g.cycle_id', where: cycleScope,
    columns: `g.id, g.title, ${cycleColumns}`, fields: [['g.title', 'מטרה']],
    order: `${cycleOrder}, g.sort_order ASC, g.id ASC`,
  },
  {
    category: 'tactics', from: 'tactics t JOIN goals g ON g.id = t.goal_id JOIN cycles c ON c.id = g.cycle_id',
    where: cycleScope,
    columns: `t.id, t.title, g.id AS goalId, c.user_id AS userId, c.id AS cycleId,
      c.name AS cycleName, 1 - c.is_active AS isArchived,
      MAX(t.start_week, MIN(t.end_week, c.current_week)) AS week`,
    fields: [['t.title', 'טקטיקה']], order: `${cycleOrder}, g.sort_order ASC, g.id ASC, t.id ASC`,
  },
  {
    category: 'wams', from: `wams w ${wamJoins}`, where: 'w.partnership_id = @partnershipId',
    columns: `w.id, '' AS title, ${wamColumns}`,
    fields: [
      ['w.wins', 'הצלחות'], ['w.misses', 'פספוסים'], ['w.blockers', 'חסמים'],
      ['w.lessons_learned', 'לקחים'], ['w.notes', 'הערות'], ['w.adjustment_notes', 'התאמות'],
    ],
    order: wamOrder,
  },
  {
    category: 'commitments', from: `wam_commitments m JOIN wams w ON w.id = m.wam_id ${wamJoins}`,
    where: 'w.partnership_id = @partnershipId', columns: `m.id, m.label AS title, ${wamColumns}`,
    fields: [['m.label', 'התחייבות']], order: `${wamOrder}, m.sort_order ASC, m.id ASC`,
  },
  {
    category: 'punishments', from: `wam_punishments p JOIN wams w ON w.id = p.source_wam_id ${wamJoins}`,
    where: 'w.partnership_id = @partnershipId', columns: `p.id, p.label AS title, ${wamColumns}`,
    fields: [['p.label', 'עונש']], order: `${wamOrder}, p.id ASC`,
  },
  {
    category: 'reminders', from: 'scheduled_email_reminders r', where: 'r.creator_user_id = @viewerId',
    columns: `r.id, r.title, r.creator_user_id AS userId, NULL AS cycleId, NULL AS cycleName,
      NULL AS isArchived, 0 AS week`,
    fields: [['r.title', 'כותרת התזכורת'], ['r.body', 'תוכן התזכורת']],
    order: `CASE WHEN r.status IN ('pending', 'failed') THEN 0 ELSE 1 END,
      r.scheduled_for ASC, r.id ASC`,
  },
];

function targetFor(category: ArchiveSearchCategory, row: SearchRow): ArchiveSearchTarget {
  if (category === 'reminders') return { kind: 'reminder', reminderId: row.id };
  if (category === 'wams' || category === 'commitments' || category === 'punishments') {
    return {
      kind: 'wam', userId: row.userId, cycleId: row.cycleId, wamId: row.wamId!, week: row.week,
      ...(category === 'commitments' ? { commitmentId: row.id } : {}),
      ...(category === 'punishments' ? { punishmentId: row.id } : {}),
    };
  }
  return {
    kind: 'cycle', userId: row.userId, cycleId: row.cycleId!, week: row.week,
    ...(category === 'goals' ? { goalId: row.id } : {}),
    ...(category === 'tactics' ? { goalId: row.goalId!, tacticId: row.id } : {}),
  };
}

/** Only fixed, reviewed identifiers enter SQL; all request values remain bound parameters.
 * Counts and capped excerpts share a read transaction, never counts of just the loaded page.
 * Punishments appear once, at their source WAM (also where the existing detail API exposes them). */
export function searchArchive(db: Database.Database, viewerId: number, query: string, limit: number) {
  return db.transaction(() => {
    const partnership = getAcceptedPartnershipForUser(db, viewerId);
    const bindings = {
      viewerId,
      partnerId: partnership ? otherUserId(partnership, viewerId) : null,
      partnershipId: partnership?.id ?? null,
      viewerIsInitiator: partnership?.initiatorId === viewerId ? 1 : 0,
      pattern: `%${query.replace(/[\\%_]/g, '\\$&')}%`,
      limit,
    };
    const groups = sources.map((source) => {
      const matches = source.fields.map(([column]) => `${column} LIKE @pattern ESCAPE '\\'`);
      const where = `${source.where} AND (${matches.join(' OR ')})`;
      const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${source.from} WHERE ${where}`)
        .get(bindings) as { count: number };
      const matchedText = `CASE ${source.fields.map(([column], index) => `WHEN ${matches[index]} THEN ${column}`).join(' ')} END`;
      const matchedField = `CASE ${source.fields.map(([, label], index) => `WHEN ${matches[index]} THEN '${label}'`).join(' ')} END`;
      const rows = db.prepare(`SELECT ${source.columns}, ${matchedText} AS matchedText, ${matchedField} AS matchedField
        FROM ${source.from} WHERE ${where} ORDER BY ${source.order} LIMIT @limit`).all(bindings) as SearchRow[];
      const items: ArchiveSearchItem[] = rows.map((row) => ({
        id: row.id,
        title: source.category === 'wams' ? `פגישת אחריותיות · שבוע ${row.week}` : clip(row.title, 96),
        snippet: excerpt(row.matchedText, query),
        matchedField: row.matchedField,
        cycleName: row.cycleName === null ? null : clip(row.cycleName, 96),
        isArchived: row.isArchived === null ? null : row.isArchived === 1,
        ownership: row.wamId !== undefined ? 'shared' : row.userId === viewerId ? 'mine' : 'partner',
        target: targetFor(source.category, row),
      }));
      return { category: source.category, count, hasMore: count > items.length, items };
    });
    return { query, limit, totalCount: groups.reduce((sum, group) => sum + group.count, 0), groups };
  })();
}
