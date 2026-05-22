import type { ViteDevServer } from "vite";
import { WebSocketServer } from "ws";

export default function(server: ViteDevServer) {
    const wss = new WebSocketServer({ noServer: true });

    server.httpServer?.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
    
    wss.on('connection', (ws) => {
        ws.on('message', (msg) => ws.send(msg));

        ws.on('error', (error) => {
            console.error(error);
            ws.close();
        });
    });
}