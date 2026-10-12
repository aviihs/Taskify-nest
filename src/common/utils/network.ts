import { networkInterfaces } from 'os';

/** IPv4 addresses of this machine on its local networks (Wi-Fi, Ethernet), excluding loopback. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

export interface ServerUrl {
  label: string;
  url: string;
}

/**
 * URLs the API answers on. LAN addresses are listed outside production only:
 * they let a phone on the same Wi-Fi reach a dev server, while on a hosted
 * service they would be internal container addresses.
 */
export function serverUrls(port: number, environment: string): ServerUrl[] {
  const urls: ServerUrl[] = [
    { label: 'Local', url: `http://localhost:${port}` },
  ];
  if (environment !== 'production') {
    for (const address of lanAddresses()) {
      urls.push({ label: 'Network', url: `http://${address}:${port}` });
    }
  }
  return urls;
}
