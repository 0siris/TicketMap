import { createApp } from './app.js';
import { GitLabService } from './gitlab.js';
import { GlabClient } from './glab.js';
import { getLanAddresses } from './network.js';
import { ConfigurationError, loadLocalGitLabConfig } from './config.js';
import { downloadImage } from './images.js';

const lanAddresses = getLanAddresses();
let app: ReturnType<typeof createApp> | undefined;
try {
  const target = loadLocalGitLabConfig();
  app = createApp(new GitLabService(new GlabClient(target), target), {
    lanAddresses, target, imageLoader: (secret, filename) => downloadImage(secret, filename, target),
  });
  await app.listen({ host: '0.0.0.0', port: 4310 });
  console.log('Ticket Map: http://127.0.0.1:4310 (development UI: http://127.0.0.1:5173)');
  for (const address of lanAddresses) console.log(`Ticket Map LAN: http://${address}:4310`);
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message
    : 'Ticket Map could not start on 0.0.0.0:4310. Check the local configuration and running instances.');
  await app?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => { await app?.close(); process.exit(0); });
