import { QueryClient } from '@tanstack/react-query';

// Single shared instance so store.js (login/logout) can clear it without
// creating an import cycle with main.jsx.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000, gcTime: 5 * 60 * 1000 },
  },
});
