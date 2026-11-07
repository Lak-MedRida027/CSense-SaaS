import { pino, type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.refreshToken',
        '*.accessToken',
        '*.currentTokenHash',
        '*.previousTokenHashes',
        'req.body.password',
      ],
      censor: '[REDACTED]',
    },
  });
}
