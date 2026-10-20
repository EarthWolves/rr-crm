import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Attribute, type Pipeline, type User } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User }>('/auth/me').then((r) => r.user),
    retry: false,
    staleTime: Infinity,
  });
}

export function useUsers() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/users').then((r) => r.users) });
  const users = q.data || [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return { users, byId, ...q };
}

export function usePipelines() {
  const q = useQuery({ queryKey: ['pipelines'], queryFn: () => api.get<{ pipelines: Pipeline[] }>('/pipelines').then((r) => r.pipelines) });
  const pipelines = q.data || [];
  const stageById = Object.fromEntries(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s])));
  return { pipelines, stageById, ...q };
}

export function useAttributes() {
  const q = useQuery({ queryKey: ['attributes'], queryFn: () => api.get<{ attributes: Attribute[] }>('/attributes').then((r) => r.attributes) });
  return { attributes: q.data || [], ...q };
}

// Subscribes to server-sent events; whenever a teammate changes something, refetch.
export function useLiveUpdates(myId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!myId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.by === myId) return; // our own mutations already invalidate locally
      } catch {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries(), 400);
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [myId, qc]);
}
