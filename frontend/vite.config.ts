import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: true,
    watch: {
      /**
       * Poll for changes instead of relying on filesystem events.
       *
       * The dev server runs in a Linux container with the project bind-mounted
       * from a Windows host. Docker Desktop does not forward inotify events
       * across that boundary, so Vite's watcher never fires: edited files are
       * present on disk and inside the container, but the module graph keeps
       * serving the transforms it built at startup. The symptom is a UI frozen
       * at whatever the code looked like when the container launched.
       *
       * Polling costs a little CPU and is dev-server-only — it has no effect on
       * `vite build` or on anything shipped.
       */
      usePolling: true,
      interval: 300,
    },
  },
});
