//TODO: see: https://github.com/lemanschik/just-build/tree/main/src/just-build
//TODO: see: https://github.com/lemanschik/just-build/tree/main/just.d.ts
const boot = () => {
  function wrapHRTime (just) {
    const { hrtime } = just
    const u64 = hrtime()
    const u32 = new Uint32Array(u64.buffer)
    const start = Number(just.start)
    return () => {
      hrtime()
      return ((u32[1] * 0x100000000) + u32[0]) - start
    }
  }

  function wrapMemoryUsage (memoryUsage) {
    const mem = new BigUint64Array(16)
    return () => {
      memoryUsage(mem)
      return {
        rss: mem[0],
        total_heap_size: mem[1],
        used_heap_size: mem[2],
        external_memory: mem[3],
        heap_size_limit: mem[5],
        total_available_size: mem[10],
        total_heap_size_executable: mem[11],
        total_physical_size: mem[12]
      }
    }
  }

  function wrapCpuUsage (cpuUsage) {
    const cpu = new Uint32Array(4)
    const result = { elapsed: 0, user: 0, system: 0, cuser: 0, csystem: 0 }
    const clock = cpuUsage(cpu)
    const last = { user: cpu[0], system: cpu[1], cuser: cpu[2], csystem: cpu[3], clock }
    return () => {
      const clock = cpuUsage(cpu)
      result.elapsed = clock - last.clock
      result.user = cpu[0] - last.user
      result.system = cpu[1] - last.system
      result.cuser = cpu[2] - last.cuser
      result.csystem = cpu[3] - last.csystem
      last.user = cpu[0]
      last.system = cpu[1]
      last.cuser = cpu[2]
      last.csystem = cpu[3]
      last.clock = clock
      return result
    }
  }

  function wrapgetrUsage (getrUsage) {
    const res = new Float64Array(16)
    return () => {
      getrUsage(res)
      return {
        user: res[0],
        system: res[1],
        maxrss: res[2],
        ixrss: res[3],
        idrss: res[4],
        isrss: res[5],
        minflt: res[6],
        majflt: res[7],
        nswap: res[8],
        inblock: res[9],
        outblock: res[10],
        msgsnd: res[11],
        msgrcv: res[12],
        ssignals: res[13],
        nvcsw: res[14],
        nivcsw: res[15]
      }
    }
  }

  function wrapHeapUsage (heapUsage) {
    const heap = (new Array(16)).fill(0).map(v => new Float64Array(4))
    return () => {
      const usage = heapUsage(heap)
      usage.spaces = Object.keys(usage.heapSpaces).map(k => {
        const space = usage.heapSpaces[k]
        return {
          name: k,
          size: space[2],
          used: space[3],
          available: space[1],
          physicalSize: space[0]
        }
      })
      delete usage.heapSpaces
      return usage
    }
  }

  function wrapEnv (env) {
    return () => {
      return env()
        .map(entry => entry.split('='))
        .reduce((e, pair) => { e[pair[0]] = pair[1]; return e }, {})
    }
  }

  function wrapLibrary (cache = {}) {
    const loadLibrary = (path, name) => {
      if (cache[name]) return cache[name]
      if (!globalThis.just.sys.dlopen) return {}
      const handle = globalThis.just.sys.dlopen(path, just.sys.RTLD_LAZY)
      if (!handle) return {}
      const ptr = globalThis.just.sys.dlsym(handle, `_register_${name}`)
      if (!ptr) return {}
      const lib = globalThis.just.load(ptr)
      if (!lib) return {}
      lib.close = () => globalThis.just.sys.dlclose(handle)
      lib.type = 'module-external'
      cache[name] = lib
      return lib
    }

    function library (name, path) {
      if (cache[name]) return cache[name]
      const lib = just.load(name)
      if (!lib) {
        if (path) return loadLibrary(path, name)
        return loadLibrary(`${name}.so`, name)
      }
      lib.type = 'module'
      cache[name] = lib
      return lib
    }

    return { library, cache }
  }

  function wrapRequire (cache = {}) {
    const appRoot = just.sys.cwd()
    const { HOME, JUST_TARGET } = just.env()
    const justDir = JUST_TARGET || `${HOME}/.just`

    function requireNative (path) {
      path = `lib/${path}.js`
      if (cache[path]) return cache[path].exports
      const { vm } = just
      const params = ['exports', 'require', 'module']
      const exports = {}
      const module = { exports, type: 'native', dirName: appRoot }
      module.text = just.builtin(path)
      if (!module.text) return
      const fun = vm.compile(module.text, path, params, [])
      module.function = fun
      cache[path] = module
      fun.call(exports, exports, p => just.require(p, module), module)
      return module.exports
    }

    function require (path, parent = { dirName: appRoot }) {
      const { join, baseName, fileName } = just.path
      if (path[0] === '@') path = `${appRoot}/lib/${path.slice(1)}/${fileName(path.slice(1))}.js`
      const ext = path.split('.').slice(-1)[0]
      if (ext === 'js' || ext === 'json') {
        let dirName = parent.dirName
        const fileName = join(dirName, path)
        if (cache[fileName]) return cache[fileName].exports
        dirName = baseName(fileName)
        const params = ['exports', 'require', 'module']
        const exports = {}
        const module = { exports, dirName, fileName, type: ext }
        // todo: this is not secure
        if (just.fs.isFile(fileName)) {
          module.text = just.fs.readFile(fileName)
        } else {
          path = fileName.replace(appRoot, '')
          if (path[0] === '/') path = path.slice(1)
          module.text = just.builtin(path)
          if (!module.text) {
            path = `${justDir}/${path}`
            if (!just.fs.isFile(path)) return
            module.text = just.fs.readFile(path)
            if (!module.text) return
          }
        }
        cache[fileName] = module
        if (ext === 'js') {
          const fun = just.vm.compile(module.text, fileName, params, [])
          module.function = fun
          fun.call(exports, exports, p => require(p, module), module)
        } else {
          module.exports = JSON.parse(module.text)
        }
        return module.exports
      }
      return requireNative(path, parent)
    }

    return { requireNative, require, cache }
  }

  function setTimeout (callback, timeout, repeat = 0, loop = just.factory.loop) {
    const buf = new ArrayBuffer(8)
    const timerfd = just.sys.timer(repeat, timeout)
    loop.add(timerfd, (fd, event) => {
      callback()
      just.fs.read(fd, buf, 0, buf.byteLength)
      if (repeat === 0) {
        loop.remove(fd)
        just.fs.close(fd)
      }
    })
    return timerfd
  }

  function setInterval (callback, timeout, loop = just.factory.loop) {
    return setTimeout(callback, timeout, timeout, loop)
  }

  function clearTimeout (fd, loop = just.factory.loop) {
    loop.remove(fd)
    just.fs.close(fd)
  }

  class SystemError extends Error {
    constructor (syscall) {
      const { sys } = just
      const errno = sys.errno()
      const message = `${syscall} (${errno}) ${sys.strerror(errno)}`
      super(message)
      this.errno = errno
      this.name = 'SystemError'
    }
  }

  function setNonBlocking (fd) {
    let flags = just.fs.fcntl(fd, just.sys.F_GETFL, 0)
    if (flags < 0) return flags
    flags |= just.net.O_NONBLOCK
    return just.fs.fcntl(fd, just.sys.F_SETFL, flags)
  }

  function parseArgs (args) {
    const opts = {}
    args = args.filter(arg => {
      if (arg.slice(0, 2) === '--') {
        opts[arg.slice(2)] = true
        return false
      }
      return true
    })
    opts.args = args
    return opts
  }

  function main (opts) {
    const { library, cache } = wrapLibrary()
    let debugStarted = false

    delete globalThis.console

    globalThis.onUnhandledRejection = err => {
      just.error('onUnhandledRejection')
      if (err) just.error(err.stack)
    }

    // load the builtin modules
    globalThis.just.vm = library('vm').vm
    globalThis.just.loop = library('epoll').epoll
    globalThis.just.fs = library('fs').fs
    globalThis.just.net = library('net').net
    globalThis.just.sys = library('sys').sys
    globalThis.just.env = wrapEnv(just.sys.env)

    // todo: what about sharedarraybuffers?
    ArrayBuffer.prototype.writeString = function(str, off = 0) { // eslint-disable-line
      return globalThis.just.sys.writeString(this, str, off)
    }
    ArrayBuffer.prototype.readString = function (len = this.byteLength, off = 0) { // eslint-disable-line
      return globalThis.just.sys.readString(this, len, off)
    }
    ArrayBuffer.prototype.getAddress = function () { // eslint-disable-line
      return globalThis.just.sys.getAddress(this)
    }
    ArrayBuffer.prototype.copyFrom = function (src, off = 0, len = src.byteLength, soff = 0) { // eslint-disable-line
      return globalThis.just.sys.memcpy(this, src, off, len, soff)
    }
    ArrayBuffer.fromString = str => globalThis.just.sys.calloc(1, str)
    String.byteLength = globalThis.just.sys.utf8Length

    const { requireNative, require } = wrapRequire(cache)

    
    Object.assign(globalThis.just.fs, requireNative('fs'))
    
    globalThis.just.SystemError = SystemError
    globalThis.just.config = requireNative('config')
    globalThis.just.path = requireNative('path')
    globalThis.just.factory = requireNative('loop').factory
    globalThis.just.factory.loop = just.factory.create(128)
    globalThis.just.process = requireNative('process')
    globalThis.just.setTimeout = setTimeout
    globalThis.just.setInterval = setInterval
    globalThis.just.clearTimeout = just.clearInterval = clearTimeout
    globalThis.just.library = library
    globalThis.just.requireNative = requireNative
    globalThis.just.net.setNonBlocking = setNonBlocking
    globalThis.just.require = global.require = require
    globalThis.just.require.cache = cache
    globalThis.just.hrtime = wrapHRTime(just)
    globalThis.just.memoryUsage = wrapMemoryUsage(just.memoryUsage)
    globalThis.just.cpuUsage = wrapCpuUsage(just.sys.cpuUsage)
    globalThis.just.rUsage = wrapgetrUsage(just.sys.getrUsage)
    globalThis.just.heapUsage = wrapHeapUsage(just.sys.heapUsage)

    function startup () {
      if (!globalThis.just.args.length) return true
      if (globalThis.just.workerSource) {
        const scriptName = just.path.join(just.sys.cwd(), just.args[0] || 'thread')
        globalThis.just.main = just.workerSource
        delete globalThis.just.workerSource
        just.vm.runScript(just.main, scriptName)
        return
      }
      if (globalThis.just.args.length === 1) {
        const replModule = globalThis.just.require('repl')
        if (!replModule) {
          throw new Error('REPL not enabled. Maybe I should be a standalone?')
        }
        replModule.repl()
        return
      }
      if (globalThis.just.args[1] === '--') {
        // todo: limit size
        // todo: allow streaming in multiple scripts with a separator and running them all
        const buf = new ArrayBuffer(4096)
        const chunks = []
        let bytes = globalThis.just.net.read(just.sys.STDIN_FILENO, buf, 0, buf.byteLength)
        while (bytes > 0) {
          chunks.push(buf.readString(bytes))
          bytes = globalThis.just.net.read(just.sys.STDIN_FILENO, buf, 0, buf.byteLength)
        }
        globalThis.just.vm.runScript(chunks.join(''), 'stdin')
        return
      }
      if (globalThis.just.args[1] === 'eval') {
        globalThis.just.vm.runScript(globalThis.just.args[2], 'eval')
        return
      }
      if (globalThis.just.args[1] === 'build') {
        const buildModule = globalThis.just.require('build')
        if (!buildModule) throw new Error('Build not Available')
        let config
        if (globalThis.just.opts.config) {
          config = require(globalThis.just.args[2]) || {}
        } else {
          if (just.args.length > 2) {
            config = just.require('configure').run(globalThis.just.args[2], opts)
          } else {
            config = require(globalThis.just.args[2] || 'config.json') || require('config.js') || {}
          }
        }
        buildModule.run(config, opts)
          .then(cfg => {
            if (opts.dump) globalThis.just.print(JSON.stringify(cfg, null, '  '))
          })
          .catch(err => globalThis.just.error(err.stack))
        return
      }
      if (just.args[1] === 'init') {
        const buildModule = globalThis.just.require('build')
        if (!buildModule) throw new Error('Build not Available')
        buildModule.init(just.args[2] || 'hello')
        return
      }
      if (just.args[1] === 'clean') {
        const buildModule = globalThis.just.require('build')
        if (!buildModule) throw new Error('Build not Available')
        buildModule.clean()
        return
      }
      const scriptName = globalThis.just.path.join(just.sys.cwd(), just.args[1])
      just.main = just.fs.readFile(just.args[1])
      if (opts.esm) {
        just.vm.runModule(just.main, scriptName)
      } else {
        just.vm.runScript(just.main, scriptName)
      }
    }
    if (opts.inspector) {
      const inspectorLib = globalThis.just.library('inspector')
      if (!inspectorLib) throw new SystemError('inspector module is not enabled')
      just.inspector = inspectorLib.inspector
      // TODO: this is ugly
      Object.assign(just.inspector, require('inspector'))
      just.encode = library('encode').encode
      just.sha1 = library('sha1').sha1
      global.process = {
        pid: just.sys.pid(),
        version: 'v15.6.0',
        arch: 'x64',
        env: just.env()
      }
      const _require = globalThis.require
      globalThis.require = (name, path) => {
        if (name === 'module') return ['fs', 'process', 'repl','sys']
        return _require(name, path)
      }
      global.inspector = globalThis.just.inspector.createInspector({
        title: 'Just!',
        onReady: () => {
          if (debugStarted) return globalThis.just.factory.run()
          debugStarted = true
          if (!startup()) globalThis.just.factory.run()
        }
      })
      globalThis.just.inspector.enable()
      globalThis.just.factory.run(1)
      return
    }
    if (!startup()) globalThis.just.factory.run()
  }

  globalThis.just.opts = parseArgs(globalThis.just.args)
  globalThis.just.args = globalThis.just.opts.args
   
  if (globalThis.just.opts.bare) {
    globalThis.just.load('vm').vm.runScript(globalThis.just.args[1], 'eval')
  } else {
    main(opts)
  }
};

boot();
