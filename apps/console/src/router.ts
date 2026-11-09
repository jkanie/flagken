import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/flags' },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: 'Sign in' } },
    { path: '/flags', name: 'flags', component: () => import('./views/FlagsView.vue'), meta: { title: 'Flags' } },
    { path: '/flags/:flagKey', name: 'flag', component: () => import('./views/FlagEditorView.vue'), props: true, meta: { title: 'Flag' } },
    {
      path: '/environments',
      name: 'environments',
      component: () => import('./views/EnvironmentsView.vue'),
      meta: { title: 'Environments and API keys' },
    },
    { path: '/webhooks', name: 'webhooks', component: () => import('./views/WebhooksView.vue'), meta: { title: 'Webhooks' } },
    { path: '/audit', name: 'audit', component: () => import('./views/AuditView.vue'), meta: { title: 'Audit log' } },
    { path: '/users', name: 'users', component: () => import('./views/UsersView.vue'), meta: { title: 'Users' } },
    { path: '/:rest(.*)*', redirect: '/flags' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.checked) await session.load();
  if (!to.meta.public && !session.user) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'login' && session.user) return { name: 'flags' };
  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? 'Console')} · flagken`;
});
