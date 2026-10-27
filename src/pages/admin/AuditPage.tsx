import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { Pagination, QueryView, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, Panel } from '@/components/admin/adminUi';
import type { Dict } from '@/i18n/en';

const PAGE_SIZE = 25;

export interface AuditRow {
  id: number;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  changed_fields: string[] | null;
  created_at: string;
}

const TABLES = [
  'notices',
  'events',
  'gallery_items',
  'downloadable_documents',
  'institution_settings',
  'role_assignments',
  'user_profiles',
  'reports',
  'notification_events',
] as const;

function tableLabel(t: Dict, table: string) {
  const map: Record<string, string> = {
    notices: t.admin.menu.notices,
    events: t.admin.menu.events,
    gallery_items: t.admin.menu.gallery,
    documents: t.admin.menu.documents,
    downloadable_documents: t.admin.menu.documents,
    institution_settings: t.admin.menu.settings,
    role_assignments: t.admin.users.roles,
    user_profiles: t.admin.menu.users,
    reports: t.admin.menu.reports,
    notification_events: t.admin.menu.notifications,
  };
  return map[table] ?? table;
}

/** Exports log the report name as the record; show it by name. */
function recordLabel(t: Dict, row: Pick<AuditRow, 'table_name' | 'record_id'>) {
  if (!row.record_id) return null;
  if (row.table_name === 'reports') return t.admin.reports.kinds[row.record_id as keyof Dict['admin']['reports']['kinds']]?.title ?? row.record_id;
  return row.record_id.slice(0, 8);
}

/** Resolves user ids to names where the viewer may read those profiles (RLS); others stay unresolved. */
export function useActorNames(ids: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (!supabase || !key) return;
    supabase
      .from('user_profiles')
      .select('id,full_name,email')
      .in('id', key.split(','))
      .then(({ data }) => {
        if (data) setNames(Object.fromEntries(data.map((p) => [p.id, p.full_name || p.email || p.id])));
      });
  }, [key]);
  return names;
}

export function AuditTable({ rows, compact = false }: { rows: AuditRow[]; compact?: boolean }) {
  const { t, formatDate } = useLang();
  const a = t.admin.audit;
  const names = useActorNames(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)));
  const actionTone: Record<string, string> = {
    insert: 'bg-emerald-100 text-emerald-800',
    update: 'bg-royal-50 text-royal-700',
    delete: 'bg-red-100 text-red-700',
    export: 'bg-gold-100 text-gold-600',
  };

  if (compact) {
    return (
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', actionTone[r.action])}>{a.actions[r.action] ?? r.action}</span>
            <span className="font-medium text-navy-900">{tableLabel(t, r.table_name)}</span>
            <span className="text-slate-500">· {r.actor_id ? names[r.actor_id] ?? '…' : a.system}</span>
            <span className="ml-auto text-xs text-slate-500">
              {formatDate(r.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">{a.time}</th>
            <th className="px-3 py-2 font-semibold">{a.actor}</th>
            <th className="px-3 py-2 font-semibold">{a.action}</th>
            <th className="px-3 py-2 font-semibold">{a.table}</th>
            <th className="px-3 py-2 font-semibold">{a.fields}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                {formatDate(r.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </td>
              <td className="px-3 py-2.5 text-navy-900">{r.actor_id ? names[r.actor_id] ?? r.actor_id.slice(0, 8) : a.system}</td>
              <td className="px-3 py-2.5">
                <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', actionTone[r.action])}>{a.actions[r.action] ?? r.action}</span>
              </td>
              <td className="px-3 py-2.5">
                <span className="text-navy-900">{tableLabel(t, r.table_name)}</span>
                {r.record_id && <span className="block font-mono text-xs text-slate-400">{recordLabel(t, r)}</span>}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.changed_fields?.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { t } = useLang();
  const a = t.admin.audit;
  usePageMeta(a.title, undefined, { noindex: true });
  const [params, setParams] = useSearchParams();
  const table = (TABLES as readonly string[]).includes(params.get('table') ?? '') ? params.get('table')! : '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const { state, retry } = useQuery<AuditRow[]>(
    (db) => {
      let query = db
        .from('audit_logs')
        .select('id,actor_id,action,table_name,record_id,changed_fields,created_at', { count: 'exact' });
      if (table) query = query.eq('table_name', table);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    },
    [table, page],
  );

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <AdminPageHeader title={a.title} subtitle={a.subtitle} />
      <Panel>
        <div className="mb-4">
          <select aria-label={a.table} value={table} onChange={(e) => set({ table: e.target.value || null, page: null })} className={inputClass + ' sm:w-64'}>
            <option value="">{a.allTables}</option>
            {TABLES.map((tb) => (
              <option key={tb} value={tb}>
                {tableLabel(t, tb)}
              </option>
            ))}
          </select>
        </div>
        <QueryView state={state} retry={retry} empty={t.admin.dashboard.noActivity}>
          {(rows, count) => (
            <>
              <AuditTable rows={rows} />
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(p) => set({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}
