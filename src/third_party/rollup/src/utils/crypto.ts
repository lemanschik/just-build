import { createHash as cryptoCreateHash, type Hash } from 'node:crypto';
console.error('deprecated: ', import.meta.url, 'Use Web Crypto crypto.webcrypto.subtile'  )
export const createHash = (): Hash => cryptoCreateHash('sha1');
