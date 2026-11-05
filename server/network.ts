import { networkInterfaces } from 'node:os';

export function getLanAddresses(interfaces = networkInterfaces()): string[] {
  return [...new Set(Object.values(interfaces).flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))
    .map(entry => entry.address))];
}
