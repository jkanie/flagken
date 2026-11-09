import { SetMetadata } from '@nestjs/common';
import type { ApiKeyKind, Role } from '@flagken/shared';

export const PUBLIC = 'flagken:public';
export const MIN_ROLE = 'flagken:min-role';
export const SDK_KEY = 'flagken:sdk-key';
export const LOGIN_THROTTLE = 'flagken:login-throttle';

/** No sign-in needed (health checks, login, metrics with its own token). */
export const Public = () => SetMetadata(PUBLIC, true);

/** Lowest console role that may call the route. Without it, any signed-in user may. */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

/** The route takes an environment API key instead of a console session. */
export const SdkKey = (...kinds: ApiKeyKind[]) => SetMetadata(SDK_KEY, kinds);

export const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/** Adds the stricter LOGIN_RATE_LIMIT_PER_MINUTE limit to a route, on top of the general limit. */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE, true);
