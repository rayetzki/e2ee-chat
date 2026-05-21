import { fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import db from '$lib/server/database';
import { hash } from '$lib/utils';

export const actions = {
	default: async ({ request, cookies }) => {
        const errors = { name: "", password: "" };
        const data = await request.formData();
        const name = data.get('name');
        const password = data.get('password') as string | null;
        
        if (!name || !name.toString().trim()) {
            errors["name"] = "Ім'я обов'язкове";
        }

        if (!password || !password.toString().trim()) {
            errors["password"] = "Пароль обов'язковий";
        }

        if (Object.values(errors).some((value) => value)) {
            return fail(400, { errors });
        }

        const sessionId = randomBytes(32).toString('hex');

        cookies.set('sessionId', sessionId, {
            path: '/',
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        const roomHash = hash(password?.toString()!, 6);

        cookies.set('chatId', roomHash, {
            path: '/',
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        db.prepare<[string, string]>(
            'INSERT INTO connections (id, name) VALUES (?, ?)'
        ).run(sessionId, password?.toString()!);

        return roomHash;
	}
} satisfies Actions;