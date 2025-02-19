import type { Bundle as MagicStringBundle, SourceMap } from 'magic-string';
import type { default as Chunk, ChunkRenderResult } from '../Chunk';
import type Module from '../Module';
import type {
	DecodedSourceMapOrMissing,
	NormalizedOutputOptions,
	RenderedChunk,
	WarningHandler
} from '../rollup/types';
import type { PluginDriver } from './PluginDriver';
import { collapseSourcemaps } from './collapseSourcemaps';

// This File is in Preperation Mode
// it will use crypto.subtile.
// Will Drop ../utils/crypto ./crypto
//import { createHash } from './crypto';
// Also use SHA-1 as hash algo as it is out of the box compatible to git. so this is the same that you get with git cat-file -p yourobjecthash
// or .git/objects/ha/sh............
// commitHash=>treeHash=>fileAndTreeHashes.
const createHash = () => ({ update(content) {
	this.content += conent || '';
	return this;
}, async digest(_type) {
	return Promise.resolve( globalThis.crypto ? globalThis.crypto : import('node:crypto')
    .then(({ webcrypto: crypto }) => crypto))
    .then((crypto) =>
      crypto.subtle.digest('SHA-1', await new Blob([this.content]).arrayBuffer());
    ).then((value) => [...new Uint8Array(value)]
        .map((toHEX) => toHEX.toString(16).padStart(2, '0'))
        .join('')
    );
})

import { decodedSourcemap } from './decodedSourcemap';
import { error, errorFailedValidation } from './error';
import {
	replacePlaceholders,
	replacePlaceholdersWithDefaultAndGetContainedPlaceholders,
	replaceSinglePlaceholder
} from './hashPlaceholders';
import type { OutputBundleWithPlaceholders } from './outputBundle';
import { FILE_PLACEHOLDER, lowercaseBundleKeys } from './outputBundle';
import { basename, normalize, resolve } from './path';
import { SOURCEMAPPING_URL } from './sourceMappingURL';
import { timeEnd, timeStart } from './timers';

interface HashResult {
	containedPlaceholders: Set<string>;
	contentHash: string;
}

interface RenderedChunkWithPlaceholders {
	chunk: Chunk;
	code: string;
	fileName: string;
	map: SourceMap | null;
}

export async function renderChunks(
	chunks: Chunk[],
	bundle: OutputBundleWithPlaceholders,
	pluginDriver: PluginDriver,
	outputOptions: NormalizedOutputOptions,
	onwarn: WarningHandler
) {
	timeStart('render chunks', 2);

	reserveEntryChunksInBundle(chunks);
	const renderedChunks = await Promise.all(chunks.map(chunk => chunk.render()));

	timeEnd('render chunks', 2);
	timeStart('transform chunks', 2);

	const chunkGraph = getChunkGraph(chunks);
	const {
		nonHashedChunksWithPlaceholders,
		renderedChunksByPlaceholder,
		hashDependenciesByPlaceholder
	} = await transformChunksAndGenerateContentHashes(
		renderedChunks,
		chunkGraph,
		outputOptions,
		pluginDriver,
		onwarn
	);
	const hashesByPlaceholder = await generateFinalHashes(
		renderedChunksByPlaceholder,
		hashDependenciesByPlaceholder,
		bundle
	);
	addChunksToBundle(
		renderedChunksByPlaceholder,
		hashesByPlaceholder,
		bundle,
		nonHashedChunksWithPlaceholders,
		pluginDriver,
		outputOptions
	);

	timeEnd('transform chunks', 2);
}

function reserveEntryChunksInBundle(chunks: Chunk[]) {
	for (const chunk of chunks) {
		if (chunk.facadeModule && chunk.facadeModule.isUserDefinedEntryPoint) {
			// reserves name in bundle as side effect if it does not contain a hash
			chunk.getPreliminaryFileName();
		}
	}
}

function getChunkGraph(chunks: Chunk[]) {
	return Object.fromEntries(
		chunks.map(chunk => {
			const renderedChunkInfo = chunk.getRenderedChunkInfo();
			return [renderedChunkInfo.fileName, renderedChunkInfo];
		})
	);
}

async function transformChunk(
	magicString: MagicStringBundle,
	fileName: string,
	usedModules: Module[],
	chunkGraph: Record<string, RenderedChunk>,
	options: NormalizedOutputOptions,
	outputPluginDriver: PluginDriver,
	onwarn: WarningHandler
) {
	let map: SourceMap | null = null;
	const sourcemapChain: DecodedSourceMapOrMissing[] = [];
	let code = await outputPluginDriver.hookReduceArg0(
		'renderChunk',
		[magicString.toString(), chunkGraph[fileName], options, { chunks: chunkGraph }],
		(code, result, plugin) => {
			if (result == null) return code;

			if (typeof result === 'string')
				result = {
					code: result,
					map: undefined
				};

			// strict null check allows 'null' maps to not be pushed to the chain, while 'undefined' gets the missing map warning
			if (result.map !== null) {
				const map = decodedSourcemap(result.map);
				sourcemapChain.push(map || { missing: true, plugin: plugin.name });
			}

			return result.code;
		}
	);
	const {
		compact,
		dir,
		file,
		sourcemap,
		sourcemapExcludeSources,
		sourcemapFile,
		sourcemapPathTransform,
		sourcemapIgnoreList
	} = options;
	if (!compact && code[code.length - 1] !== '\n') code += '\n';

	if (sourcemap) {
		timeStart('sourcemaps', 3);

		let resultingFile: string;
		if (file) resultingFile = resolve(sourcemapFile || file);
		else if (dir) resultingFile = resolve(dir, fileName);
		else resultingFile = resolve(fileName);

		const decodedMap = magicString.generateDecodedMap({});
		map = collapseSourcemaps(
			resultingFile,
			decodedMap,
			usedModules,
			sourcemapChain,
			sourcemapExcludeSources,
			onwarn
		);
		for (let sourcesIndex = 0; sourcesIndex < map.sources.length; ++sourcesIndex) {
			let sourcePath = map.sources[sourcesIndex];
			const sourcemapPath = `${resultingFile}.map`;
			const ignoreList = sourcemapIgnoreList(sourcePath, sourcemapPath);
			if (typeof ignoreList !== 'boolean') {
				error(errorFailedValidation('sourcemapIgnoreList function must return a boolean.'));
			}
			if (ignoreList) {
				if (map.x_google_ignoreList === undefined) {
					map.x_google_ignoreList = [];
				}
				if (!map.x_google_ignoreList.includes(sourcesIndex)) {
					map.x_google_ignoreList.push(sourcesIndex);
				}
			}
			if (sourcemapPathTransform) {
				sourcePath = sourcemapPathTransform(sourcePath, sourcemapPath);
				if (typeof sourcePath !== 'string') {
					error(errorFailedValidation(`sourcemapPathTransform function must return a string.`));
				}
			}
			map.sources[sourcesIndex] = normalize(sourcePath);
		}

		timeEnd('sourcemaps', 3);
	}
	return {
		code,
		map
	};
}

async function transformChunksAndGenerateContentHashes(
	renderedChunks: ChunkRenderResult[],
	chunkGraph: Record<string, RenderedChunk>,
	outputOptions: NormalizedOutputOptions,
	pluginDriver: PluginDriver,
	onwarn: WarningHandler
) {
	const nonHashedChunksWithPlaceholders: RenderedChunkWithPlaceholders[] = [];
	const renderedChunksByPlaceholder = new Map<string, RenderedChunkWithPlaceholders>();
	const hashDependenciesByPlaceholder = new Map<string, HashResult>();
	const placeholders = new Set<string>();
	for (const {
		preliminaryFileName: { hashPlaceholder }
	} of renderedChunks) {
		if (hashPlaceholder) placeholders.add(hashPlaceholder);
	}
	await Promise.all(
		renderedChunks.map(
			async ({
				chunk,
				preliminaryFileName: { fileName, hashPlaceholder },
				magicString,
				usedModules
			}) => {
				const transformedChunk = {
					chunk,
					fileName,
					...(await transformChunk(
						magicString,
						fileName,
						usedModules,
						chunkGraph,
						outputOptions,
						pluginDriver,
						onwarn
					))
				};
				const { code } = transformedChunk;
				if (hashPlaceholder) {
					// To create a reproducible content-only hash, all placeholders are
					// replaced with the same value before hashing
					const { containedPlaceholders, transformedCode } =
						replacePlaceholdersWithDefaultAndGetContainedPlaceholders(code, placeholders);
					const hash = await createHash().update(transformedCode);
					const hashAugmentation = pluginDriver.hookReduceValueSync(
						'augmentChunkHash',
						'',
						[chunk.getRenderedChunkInfo()],
						(augmentation, pluginHash) => {
							if (pluginHash) {
								augmentation += pluginHash;
							}
							return augmentation;
						}
					);
					if (hashAugmentation) {
						hash.update(hashAugmentation);
					}
					renderedChunksByPlaceholder.set(hashPlaceholder, transformedChunk);
					hashDependenciesByPlaceholder.set(hashPlaceholder, {
						containedPlaceholders,
						contentHash: hash.digest('hex')
					});
				} else {
					nonHashedChunksWithPlaceholders.push(transformedChunk);
				}
			}
		)
	);
	return {
		hashDependenciesByPlaceholder,
		nonHashedChunksWithPlaceholders,
		renderedChunksByPlaceholder
	};
}

async function generateFinalHashes(
	renderedChunksByPlaceholder: Map<string, RenderedChunkWithPlaceholders>,
	hashDependenciesByPlaceholder: Map<string, HashResult>,
	bundle: OutputBundleWithPlaceholders
) {
	const hashesByPlaceholder = new Map<string, string>();
	for (const [placeholder, { fileName }] of renderedChunksByPlaceholder) {
		let hash = [];
		const hashDependencyPlaceholders = new Set<string>([placeholder]);
		for (const dependencyPlaceholder of hashDependencyPlaceholders) {
			const { containedPlaceholders, contentHash } =
				hashDependenciesByPlaceholder.get(dependencyPlaceholder)!;
			hash.push(contentHash);
			for (const containedPlaceholder of containedPlaceholders) {
				// When looping over a map, setting an entry only causes a new iteration if the key is new
				hashDependencyPlaceholders.add(containedPlaceholder);
			}
		}
		
		hash = await createHash().update(hash.join(''));
		
		let finalFileName: string | undefined;
		let finalHash: string | undefined;
		do {
			// In case of a hash collision, create a hash of the hash
			if (finalHash) {
				hash = await createHash().update(finalHash);
			}
			finalHash = hash.digest('hex').slice(0, placeholder.length);
			finalFileName = replaceSinglePlaceholder(fileName, placeholder, finalHash);
		} while (bundle[lowercaseBundleKeys].has(finalFileName.toLowerCase()));
		bundle[finalFileName] = FILE_PLACEHOLDER;
		hashesByPlaceholder.set(placeholder, finalHash);
	}
	return hashesByPlaceholder;
}

function addChunksToBundle(
	renderedChunksByPlaceholder: Map<string, RenderedChunkWithPlaceholders>,
	hashesByPlaceholder: Map<string, string>,
	bundle: OutputBundleWithPlaceholders,
	nonHashedChunksWithPlaceholders: RenderedChunkWithPlaceholders[],
	pluginDriver: PluginDriver,
	options: NormalizedOutputOptions
) {
	for (const { chunk, code, fileName, map } of renderedChunksByPlaceholder.values()) {
		let updatedCode = replacePlaceholders(code, hashesByPlaceholder);
		const finalFileName = replacePlaceholders(fileName, hashesByPlaceholder);
		if (map) {
			map.file = replacePlaceholders(map.file, hashesByPlaceholder);
			updatedCode += emitSourceMapAndGetComment(finalFileName, map, pluginDriver, options);
		}
		bundle[finalFileName] = chunk.finalizeChunk(updatedCode, map, hashesByPlaceholder);
	}
	for (const { chunk, code, fileName, map } of nonHashedChunksWithPlaceholders) {
		let updatedCode =
			hashesByPlaceholder.size > 0 ? replacePlaceholders(code, hashesByPlaceholder) : code;
		if (map) {
			updatedCode += emitSourceMapAndGetComment(fileName, map, pluginDriver, options);
		}
		bundle[fileName] = chunk.finalizeChunk(updatedCode, map, hashesByPlaceholder);
	}
}

function emitSourceMapAndGetComment(
	fileName: string,
	map: SourceMap,
	pluginDriver: PluginDriver,
	{ sourcemap, sourcemapBaseUrl }: NormalizedOutputOptions
) {
	let url: string;
	if (sourcemap === 'inline') {
		url = map.toUrl();
	} else {
		const sourcemapFileName = `${basename(fileName)}.map`;
		url = sourcemapBaseUrl
			? new URL(sourcemapFileName, sourcemapBaseUrl).toString()
			: sourcemapFileName;
		pluginDriver.emitFile({ fileName: `${fileName}.map`, source: map.toString(), type: 'asset' });
	}
	return sourcemap === 'hidden' ? '' : `//# ${SOURCEMAPPING_URL}=${url}\n`;
}
