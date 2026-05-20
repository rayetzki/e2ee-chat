import { fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';

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

        const chatId = randomBytes(4).toString('hex');
    
        cookies.set('chatId', chatId, {
            path: '/',
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        return chatId;
	}
} satisfies Actions;