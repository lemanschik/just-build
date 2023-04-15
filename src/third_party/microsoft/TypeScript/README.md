# TypeScript

## Usecases
Mainly used to Transiple Legacy TypeScript and NodeJS Modules into ECMAScript it allows to transpil nodeJs modules via the bundler config and build flag
into ESMModules with Type Declarations. it does so via creation of a TypeScript Bundle via a tsconfig.json and a additional tsconfig.types.js tsconfig.module.js they get used together with the tsconfig.json and allowJs checkJs flags to Produce ECMAScript Modules with the correct type exports
added to the extra declaration d.ts file with the same name as the module 

module-name/tsconfig.json,tsconfig.module.js tsconfig.types.js<ts> depending on your needs if you want dynamic resolve able types use js + JSDOC typedef if you hard transpile use .ts export types * from 'me' with moduleResolution: bundle

[TypeScript](https://www.typescriptlang.org/) is a set of modules to transpil the esoteric typescript lang into ECMAScript ESNext as also
contains vairus integration and tools for ECMAScript and JSDOC Components. It also got support for a own bundler package format called tsconfig.json
the tsconfig.json is equal to a configurable package.json abstraction 

This exists mostly as dependency of the rollup loader which is able to load typescript packages aka tsconfig.json and typescript esoteric syntax into ECMAScript Modules.

## CJS ES
ESM Wrapper.
```js
// prepend 
const cjsBundel = `exports.hi = 'uh'`
const load = (cjsBundel) => new Function(`const module = { exports: {}};
const { exports } = module;
{${cjsBundel}}
return Object.assign(module.exports,exports);`)
// attach

```

## TypeCheck Individual Cached Modules
tsconfig.json can form abstract module shims and even now index.types.ts exports *,{type b } from 'x'  works to export only the types after you got
the cleaned ts.


## Roadmap

For details on our planned features and future direction please refer to our [roadmap](https://github.com/microsoft/TypeScript/wiki/Roadmap).
