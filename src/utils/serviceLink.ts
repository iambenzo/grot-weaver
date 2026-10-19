import { Owner, Signal } from '../api/types';
import { ROUTES } from '../constants';
import { appHref, prefixRoute } from './utils.routing';

export function serviceLink(owner: Owner, range: { from: string; to: string }, signal?: Signal): string {
  const params = new URLSearchParams({ service: owner.name, from: range.from, to: range.to });
  if (owner.namespace) {
    params.set('namespace', owner.namespace);
  }
  if (signal) {
    params.set('signal', signal);
  }
  return appHref(`${prefixRoute(ROUTES.Service)}?${params.toString()}`);
}

export function ownerName(owner: Owner): string {
  return owner.namespace ? `${owner.namespace}/${owner.name}` : owner.name;
}
