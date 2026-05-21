import db from "$lib/server/database";
import { redirect, type Actions } from "@sveltejs/kit";
import type { Connection } from "../../../types";

export function load({ cookies }) {
    const connection = db.prepare<string, Connection>(
        'SELECT * FROM connections WHERE id = ?'
    ).get(cookies.get('sessionId')!);

    return { connection };
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