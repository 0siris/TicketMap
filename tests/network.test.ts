import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { getLanAddresses } from '../server/network.js';

it('discovers only private IPv4 interface addresses and deduplicates them', () => {
  const addresses = ['192.168.1.10', '10.1.2.3', '172.16.0.1', '172.31.255.1',
    '192.168.1.10', '127.0.0.1', '172.32.0.1', '8.8.8.8', 'fe80::1'];
  const entries = addresses.map(address => ({ address, family: address.includes(':') ? 'IPv6' : 'IPv4',
    internal: address === '127.0.0.1' }) as NetworkInterfaceInfo);
  expect(getLanAddresses({ Ethernet: entries, Disabled: undefined }))
    .toEqual(['192.168.1.10', '10.1.2.3', '172.16.0.1', '172.31.255.1']);
});
