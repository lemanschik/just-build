import sha1 from 'hash.js/lib/hash/sha/1.js';

export const createHash = (): {
	digest: (format: string) => string;
	update: (data: unknown) => void;
} => sha1();
