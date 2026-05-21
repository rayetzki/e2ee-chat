import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ViteDevServer } from 'vite';
import startWebsocketServer from './src/lib/server/ws/server';

const webSocketServer = {
    name: 'webSocketServer',
    configureServer(server: ViteDevServer) {
        return startWebsocketServer(server);
    }
};

export default defineConfig({
    plugins: [tailwindcss(), sveltekit(), webSocketServer],
    server: {
        hmr: {
            port: 443
        }
    }
});
