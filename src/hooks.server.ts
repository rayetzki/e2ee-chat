import { fail, redirect } from '@sveltejs/kit';

export async function handle({ event, resolve }) {
  const sessionId = event.cookies.get('sessionId');
  const protectedRoutes = ['', 'chat'];

  if (!sessionId) {
    const currentPathname = event.url.pathname.split('/')[1]!;

    if (protectedRoutes.includes(currentPathname)) {
      throw redirect(303, '/auth');
    }
  } else {
    const authorizedChatId = event.cookies.get('chatId');

    if (event.url.pathname.startsWith('/chat')) {
      const [_, chatId] = event.url.pathname.split('/chat/');

      if (authorizedChatId !== chatId) {
        throw fail(404);
      }
    } else {
      throw redirect(303, `/chat/${authorizedChatId}`);
    }
  }

  return await resolve(event);
}