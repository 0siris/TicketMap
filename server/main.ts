import { createApp } from './app.js';
import { GitLabService } from './gitlab.js';
import { GlabClient } from './glab.js';
import { getLanAddresses } from './network.js';
import { ConfigurationError, loadLocalGitLabConfig, loadRuntimeConfig } from './config.js';
import { downloadImage } from './images.js';
import { ApplicationUpdates, loadDistribution } from './updates.js';

let app: ReturnType<typeof createApp> | undefined;
try {
  const target = loadLocalGitLabConfig();
  const runtime = loadRuntimeConfig();
  const lanAddresses = runtime.host === '0.0.0.0' ? getLanAddresses() : [];
  app = createApp(new GitLabService(new GlabClient(target), target), {
    lanAddresses, target, port: runtime.port, updates: new ApplicationUpdates(loadDistribution()),
    developmentOrigins: !process.env.TICKETMAP_DISTRIBUTION_FILE,
    imageLoader: (secret, filename) => downloadImage(secret, filename, target),
  });
  await app.listen(runtime);
  console.log(`Ticket Map: http://127.0.0.1:${runtime.port}`);
  for (const address of lanAddresses) console.log(`Ticket Map LAN: http://${address}:${runtime.port}`);
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message
    : 'Ticket Map could not start. Check the local configuration and running instances.');
  await app?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => { await app?.close(); process.exit(0); });
