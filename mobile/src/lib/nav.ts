import type { Href, useRouter } from 'expo-router';
import type { PlanAction, ViewId } from './copilotPlan';

type R = ReturnType<typeof useRouter>;

const ROUTES: Record<ViewId, string> = {
  home: '/',
  'digital-twin': '/twin',
  recommendations: '/recommendations',
  analytics: '/analytics',
  'ai-insights': '/insights',
  reports: '/reports',
};

export function runAction(router: R, act: PlanAction) {
  if (act.kind === 'focus') router.push('/focus' as Href);
  else router.push(ROUTES[act.view] as Href);
}