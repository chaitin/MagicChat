import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;
const base = process.env.PUBLIC_BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  integrations: [
    react(),
    icon({
      include: {
        tabler: [
          'arrow-down',
          'arrow-left',
          'arrow-right',
          'arrow-up',
          'arrow-up-right',
          'bolt',
          'brain',
          'brand-android',
          'brand-apple',
          'brand-ubuntu',
          'brand-windows',
          'brand-github-filled',
          'chart-line',
          'checkbox',
          'check',
          'code',
          'database',
          'download',
          'device-mobile',
          'edit',
          'eye',
          'file-text',
          'filter',
          'layout-kanban',
          'list-check',
          'lock',
          'message-circle',
          'messages',
          'minus',
          'microphone',
          'paperclip',
          'pointer-2',
          'plug-connected',
          'plus',
          'receipt',
          'robot',
          'search',
          'send',
          'server',
          'shield-check',
          'sparkles',
          'user',
          'users',
          'x',
        ],
      },
    }),
  ],
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
