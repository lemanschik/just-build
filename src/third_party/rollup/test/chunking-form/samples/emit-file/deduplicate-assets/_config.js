const assert = require('node:assert');
let string1Id,
	string2Id,
	stringSameSourceId,
	sameStringAsBufferId,
	otherStringId,
	bufferId,
	bufferSameSourceId,
	sameBufferAsStringId,
	otherBufferId;

module.exports = {
	description: 'deduplicates asset that have the same source',
	options: {
		input: ['main.js'],
		plugins: {
			buildStart() {
				// emit 'string' source in a random order
				stringSameSourceId = this.emitFile({
					type: 'asset',
					name: 'stringSameSource.txt',
					source: 'string'
				});
				string2Id = this.emitFile({ type: 'asset', name: 'string2.txt', source: 'string' });
				string1Id = this.emitFile({ type: 'asset', name: 'string1.txt', source: 'string' });
				sameStringAsBufferId = this.emitFile({
					type: 'asset',
					name: 'sameStringAsBuffer.txt',
					source: Buffer.from('string') // Test cross Buffer/string deduplication
				});

				// Different string source
				otherStringId = this.emitFile({
					type: 'asset',
					name: 'otherString.txt',
					source: 'otherString'
				});

				const bufferSource = () => Buffer.from([0x62, 0x75, 0x66, 0x66, 0x65, 0x72]);
				bufferId = this.emitFile({
					type: 'asset',
					name: 'buffer.txt',
					source: bufferSource()
				});
				bufferSameSourceId = this.emitFile({
					type: 'asset',
					name: 'bufferSameSource.txt',
					source: bufferSource()
				});
				sameBufferAsStringId = this.emitFile({
					type: 'asset',
					name: 'sameBufferAsString.txt',
					source: bufferSource().toString() // Test cross Buffer/string deduplication
				});
				// Different buffer source
				otherBufferId = this.emitFile({
					type: 'asset',
					name: 'otherBuffer.txt',
					source: Buffer.from('otherBuffer')
				});

				// specific file names will not be deduplicated
				this.emitFile({ type: 'asset', fileName: 'named/string.txt', source: 'named' });
				this.emitFile({
					type: 'asset',
					fileName: 'named/buffer.txt',
					source: bufferSource()
				});
				return null;
			},
			generateBundle() {
				assert.strictEqual(this.getFileName(string1Id), 'assets/string1-473287f8.txt', 'string1');
				assert.strictEqual(this.getFileName(string2Id), 'assets/string1-473287f8.txt', 'string2');
				assert.strictEqual(
					this.getFileName(stringSameSourceId),
					'assets/string1-473287f8.txt',
					'stringSameSource'
				);
				assert.strictEqual(
					this.getFileName(sameStringAsBufferId),
					'assets/string1-473287f8.txt',
					'sameStringAsBuffer'
				);
				assert.strictEqual(
					this.getFileName(otherStringId),
					'assets/otherString-e296c1ca.txt',
					'otherString'
				);
				assert.strictEqual(this.getFileName(bufferId), 'assets/buffer-d0ca8c2a.txt', 'buffer');
				assert.strictEqual(
					this.getFileName(bufferSameSourceId),
					'assets/buffer-d0ca8c2a.txt',
					'bufferSameSource'
				);
				assert.strictEqual(
					this.getFileName(sameBufferAsStringId),
					'assets/buffer-d0ca8c2a.txt',
					'sameBufferAsString'
				);
				assert.strictEqual(
					this.getFileName(otherBufferId),
					'assets/otherBuffer-e8d9b528.txt',
					'otherBuffer'
				);
			}
		}
	}
};
