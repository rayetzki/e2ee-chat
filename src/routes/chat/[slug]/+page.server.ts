import db from "$lib/server/database";
import { error, redirect, type Actions } from "@sveltejs/kit";
import type { Connection } from "../../../types";

export function load({ cookies, params }) {
    const sessionId = cookies.get('sessionId');

    if (!sessionId) {
        error(404, `Session not found for the chat id: ${params.slug}`);
    }

    const connections = db.prepare<string, Connection>(
        'SELECT * FROM connections WHERE chat_id = (SELECT chat_id FROM connections WHERE id = ?)'
    ).all(sessionId);

    if (!connections || connections.length < 1) {
        error(404, `There is no session found for chat id: ${params.slug}`);
    }

    const fromConnection = connections.find((connection) => connection.id === sessionId);
    const toConnection = connections.find((connection) => connection.id !== sessionId);

    if (!fromConnection) {
        error(404, `You are not connected to the chat`);
    }

    return { fromConnection, toConnection, chatId: fromConnection.chat_id };
}

export const actions = {
    logout: async ({ cookies }) => {
        const sessionId = cookies.get('sessionId');
        cookies.delete('chatId', { path: '/' });
        cookies.delete('sessionId', { path: '/' });
        db.prepare('DELETE FROM connections WHERE id = ?').run(sessionId);
        throw redirect(302, '/auth');
    }
} satisfies Actions;