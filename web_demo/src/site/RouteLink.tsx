import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { flushSync } from 'react-dom';

interface RouteClickIntent {
  readonly button: number;
  readonly defaultPrevented: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function shouldAnimateRouteClick(intent: RouteClickIntent) {
  return intent.button === 0
    && !intent.defaultPrevented
    && !intent.metaKey
    && !intent.ctrlKey
    && !intent.shiftKey
    && !intent.altKey;
}

type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly href: `#/${string}`;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function commitHashRoute(href: string) {
  const oldURL = window.location.href;
  window.history.pushState(null, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
}

export function RouteLink({ href, onClick, target, ...props }: RouteLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!shouldAnimateRouteClick(event) || target === '_blank' || window.location.hash === href) return;

    const transitionDocument = document as ViewTransitionDocument;
    if (transitionDocument.startViewTransition === undefined) return;

    event.preventDefault();
    transitionDocument.startViewTransition(() => {
      flushSync(() => commitHashRoute(href));
    });
  };

  return <a {...props} href={href} target={target} onClick={handleClick} />;
}
