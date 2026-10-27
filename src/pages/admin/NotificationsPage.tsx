import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, RotateCcw, Send } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functions';
import { Pagination, QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, InlineNotice, Panel, useToast } from '@/components/admin/adminUi';

const PAGE_SIZE = 25;
const STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
type OutboxStatus = (typeof STATUSES)[number];

const STATUS_TONES: Record<OutboxStatus, string> = {
  queued: 'bg-royal-50 text-royal-700',
  sending: 'bg-royal-50 text-royal-700',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-600',
};

interface EventRow {
  event: string;
  enabled: boolean;
  updated_at: string;
}

interface OutboxRow {
  id: string;
  event: string;
  recipient_email: string;
  recipient_name: string | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  send_after: string;
  sent_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const { t, formatDate } = useLang();
  const n = t.admin.notifications;
  usePageMeta(n.title, undefined, { noindex: true });
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as OutboxStatus) : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const events = useQuery<EventRow[]>((db) => db.from('notification_events').select('event,enabled,updated_at').order('event'), []);
  const outbox = useQuery<OutboxRow[]>(
    (db) => {
      let q = db
        .from('notification_outbox')
        .select('id,event,recipient_email,recipient_name,status,attempts,last_error,send_after,sent_at,created_at', { count: 'exact' });
      if (status) q = q.eq('status', status);
      const from = (page - 1) * PAGE_SIZE;
      return q.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    },
    [status, page],
  );

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const toggle = async (row: EventRow) => {
    if (!supabase) return;
    setBusyId(row.event);
    const { error } = await supabase.from('notification_events').update({ enabled: !row.enabled }).eq('event', row.event);
    setBusyId(null);
    if (error) return toast('error', t.admin.common.saveFailed);
    events.retry();
    toast('success', !row.enabled ? n.switchedOn : n.switchedOff);
  };

  const sendNow = async () => {
    setSending(true);
    const res = await invokeFunction<{ claimed: number; sent: number; failed: number }>('send-notifications', {});
    setSending(false);
    outbox.retry();
    if (!res.ok) return toast('error', n.sendErrors[res.code] ?? n.sendErrors.generic);
    toast('success', n.sendResult(res.data.sent ?? 0, res.data.failed ?? 0));
  };

  const retry = async (row: OutboxRow) => {
    if (!supabase) return;
    setBusyId(row.id);
    const { error } = await supabase.rpc('retry_notification', { p_id: row.id });
    setBusyId(null);
    if (error) return toast('error', t.admin.common.saveFailed);
    outbox.retry();
    toast('success', n.requeued);
  };

  const dateTime = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <AdminPageHeader
        title={n.title}
        subtitle={n.subtitle}
        actions={
          <button type="button" onClick={sendNow} disabled={sending} className={buttonClass('primary')}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {n.sendNow}
          </button>
        }
      />
      <InlineNotice tone="warning">{n.setupNote}</InlineNotice>

      <Panel title={n.eventsTitle} className="mt-6">
        <QueryView state={events.state} retry={events.retry} empty={t.admin.common.noRecords}>
          {(rows) => (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.event} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold text-navy-900">{n.events[row.event]?.title ?? row.event}</p>
                    <p className="text-sm text-slate-600">{n.events[row.event]?.description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-label={n.events[row.event]?.title ?? row.event}
                    disabled={busyId === row.event}
                    onClick={() => toggle(row)}
                    className={cx(
                      'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60',
                      row.enabled ? 'bg-emerald-600' : 'bg-slate-300',
                    )}
                  >
                    <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition', row.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>

      <Panel
        title={n.logTitle}
        className="mt-6"
        actions={
          <select
            aria-label={t.admin.common.status}
            value={status}
            onChange={(e) => setParam({ status: e.target.value || null, page: null })}
            className={inputClass + ' w-auto'}
          >
            <option value="">{t.admin.common.allStatuses}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {n.statuses[s]}
              </option>
            ))}
          </select>
        }
      >
        <p className="mb-4 text-xs text-slate-500">{n.logHelp}</p>
        <QueryView state={outbox.state} retry={outbox.retry} empty={n.empty}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{n.columns.created}</th>
                      <th className="px-3 py-2 font-semibold">{n.columns.event}</th>
                      <th className="px-3 py-2 font-semibold">{n.columns.recipient}</th>
                      <th className="px-3 py-2 font-semibold">{t.admin.common.status}</th>
                      <th className="px-3 py-2 font-semibold">{n.columns.detail}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.id} className="align-top">
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{dateTime(row.created_at)}</td>
                        <td className="px-3 py-2.5 text-navy-900">{n.events[row.event]?.title ?? row.event}</td>
                        <td className="px-3 py-2.5">
                          <span className="block text-navy-900">{row.recipient_name ?? '—'}</span>
                          <span className="block break-all text-xs text-slate-500">{row.recipient_email}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TONES[row.status])}>{n.statuses[row.status]}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {row.status === 'sent' && row.sent_at && n.sentAt(dateTime(row.sent_at))}
                          {row.status === 'queued' && new Date(row.send_after) > new Date() && n.waitsUntil(dateTime(row.send_after))}
                          {row.last_error && <span className="block">{n.reasons[row.last_error] ?? row.last_error}</span>}
                          {row.attempts > 0 && <span className="block text-slate-400">{n.attempts(row.attempts)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {(row.status === 'failed' || row.status === 'skipped') && (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => retry(row)}
                              className={buttonClass('ghost', 'px-2 py-1 text-xs')}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              {n.retry}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(p) => setParam({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}
