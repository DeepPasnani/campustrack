import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notificationsAPI } from '../../services/api';
import { useStore } from '../../store';

export default function NotificationBell() {
  const { user } = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef();

  const { data: countData } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: notificationsAPI.unreadCount,
    refetchInterval: 30000,
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationsAPI.list({ page: 1, limit: 5 }),
    enabled: open,
  });

  const markReadMut = useMutation({
    mutationFn: notificationsAPI.markRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: notificationsAPI.markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
    },
  });

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Listen for WebSocket notifications
  useEffect(() => {
    const token = sessionStorage.getItem('pp_token');
    if (!token) return;

    let ws = null;
    let reconnectTimer = null;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
      ws = new WebSocket(`${host}/ws?token=${token}`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'NOTIFICATION') {
            queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
            queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queryClient]);

  const handleNotifClick = (notif) => {
    setOpen(false);
    markReadMut.mutate(notif.id);
    const d = notif.data || {};
    if (d.testId) {
      const role = user?.role;
      navigate(role === 'admin' || role === 'super_admin' ? `/admin/results/${d.testId}` : `/test/${d.testId}`);
    }
  };

  const unread = countData?.count || 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative btn-ghost-icon"
        aria-label={`Notifications ${unread > 0 ? `(${unread} unread)` : ''}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-alert text-panel text-2xs font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-panel border border-rim rounded-xl shadow-raised z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-rim">
            <span className="text-xs font-bold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => { markAllMut.mutate(); }}
                className="text-2xs text-clarify hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {(!notifData?.notifications || notifData.notifications.length === 0) ? (
              <div className="px-3 py-8 text-center">
                <svg className="w-8 h-8 mx-auto text-annotation/30 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-xs text-annotation">No notifications yet</p>
              </div>
            ) : (
              notifData.notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`w-full text-left px-3 py-2.5 border-b border-rim/50 hover:bg-sunken/50 transition-colors ${!n.is_read ? 'bg-accent/[0.03]' : ''}`}
                >
                  <div className="flex gap-2.5">
                    <div className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${!n.is_read ? 'bg-accent' : 'bg-transparent'}`} />
                    <div className="min-w-0">
                      <p className={`text-xs ${!n.is_read ? 'font-bold text-ink' : 'text-ink/80'}`}>{n.title}</p>
                      {n.body && <p className="text-2xs text-annotation/70 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-2xs text-annotation/40 mt-1">
                        {new Date(n.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
