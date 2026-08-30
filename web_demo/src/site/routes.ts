export const SITE_ROUTES = ['detector', 'technology', 'results', 'errors', 'about'] as const;

export type SiteRoute = (typeof SITE_ROUTES)[number];

export interface SiteRouteDefinition {
  readonly id: SiteRoute;
  readonly label: string;
  readonly href: string;
}

export const SITE_NAVIGATION: readonly SiteRouteDefinition[] = [
  { id: 'detector', label: 'Detector', href: '#/detector' },
  { id: 'technology', label: 'Technology', href: '#/technology' },
  { id: 'results', label: 'Results', href: '#/results' },
  { id: 'errors', label: 'Error Analysis', href: '#/errors' },
  { id: 'about', label: 'About', href: '#/about' },
];

export function routeFromHash(hash: string): SiteRoute {
  const candidate = hash.replace(/^#\/?/, '').split(/[?#]/, 1)[0];
  if (candidate === 'team') {
    return 'about';
  }
  return SITE_ROUTES.includes(candidate as SiteRoute) ? (candidate as SiteRoute) : 'detector';
}
