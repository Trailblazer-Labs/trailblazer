import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import App from './App'
import './styles.css'

const ONE_HOUR = 1000 * 60 * 60
const ONE_DAY = ONE_HOUR * 24

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Show cached data immediately, but treat anything older than 60s as stale and refetch.
      staleTime: 60_000,
      // Keep data around in memory long enough for cache restore to be useful.
      gcTime: ONE_DAY,
      refetchOnWindowFocus: false,
      // Even with cached data, fetch on first mount of a query to reconcile.
      refetchOnMount: 'always',
      // Don't retry endlessly on transient network blips.
      retry: 1
    }
  }
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'trailblazer-query-cache',
  throttleTime: 1000
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={qc}
      persistOptions={{
        persister,
        maxAge: ONE_DAY,
        buster: 'v2',
        // Persist only GitHub-derived queries; skip volatile or PII-heavy keys.
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => {
            const k = q.queryKey?.[0]
            return k === 'issues' || k === 'pulls' || k === 'projects' || k === 'repos'
          }
        }
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </React.StrictMode>
)
