import { stopBackend } from './backendProcess';

export default async function globalTeardown(): Promise<void> {
  await stopBackend();
}
