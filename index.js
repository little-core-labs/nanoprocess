const isRunning = require('is-running')
const Resource = require('nanoresource')
const pidusage = require('pidusage')
const pidtree = require('pidtree')
const assert = require('nanoassert')
const Batch = require('batch')
const spawn = require('cross-spawn')
const fkill = require('fkill')
const pfind = require('find-process')
const once = require('once')
const { PassThrough } = require('stream')

// quick util
const errback = (p, cb) => void p.then((r) => cb(null, r), cb).catch(cb)
const noop = () => void 0
const find = (pid, cb) => errback(pfind('pid', pid), cb)
const kill = (pid, o, cb) => errback(fkill(pid, o), cb)

// timeout in milliseconds to wait before calling `pidusage.clear()`
// after the usage of `pidusage()`. Timers are cleared on each use
// of the `pidusage()` function.
const PIDUSAGE_CLEAR_TIMEOUT = 1100

// timer from `setTimeout()` uses to call `pidusage.clear()` for
// event loop clean (https://github.com/soyuka/pidusage#pidusageclear)
// which is called
let pidusageClearTimer = 0

/**
 * `PROCESS_CLOSED_ERR` is thrown when the `Process` instance
 * is used after being closed.
 * @private
 */
class PROCESS_CLOSED_ERR extends Error {
  constructor() {
    super('Process is closed.')
  }
}

/**
 * `PROCESS_NOT_RUNNING_ERR` is thrown when the `Process` instance
 * is not yet running (typically when opening).
 * @private
 */
class PROCESS_NOT_RUNNING_ERR extends Error {
  constructor() {
    super('Process not running.')
  }
}

/**
 * The `Stats` class represents a container of information
 * about the runtime of the process.
 * @private
 */
class Stats {

  /**
   * `Stats` class constructor.
   * @private
   * @param {Number} pid
   */
  constructor(pid) {
    this.bin = null // initial binary used invoke the child process
    this.uid = 0 // user ID
    this.gid = 0 // group ID
    this.cpu = 0 // CPU usage as a percentage
    this.pid = pid // child process ID
    this.ppid = 0 // parent process ID of the child process
    this.pids = [] // child process IDs of the child process
    this.name = null // the name of process
    this.atime = Date.now() // access time
    this.uptime = 0 // time in milliseconds since process started
    this.memory = 0 // memory usage bytes
    this.command = null // the command used to start the child process
    this._stdout = null
    this._stderr = null
  }

  /**
   * Accessor to return `true` if any process in the process tree
   * is still running.
   * @accessor
   */
  get isRunning() {
    return this.pids.concat(this.pid).some(isRunning)
  }
}

/**
 * The `Process` class represents an abstraction over a spawned child
 * process managed by a `nanoresource` instance.
 * @public
 * @class
 * @extends nanoresource
 */
class Process extends Resource {

  /**
   * `Process` class constructor
   * @public
   * @param {String} command
   * @param {?(Array|String)} args
   * @param {?(Object)} options
   */
  constructor(command, args, options) {
    super()

    assert('string' === typeof command && command.length > 0,
      'Command is not a string.')

    if (args && 'object' === typeof args && !Array.isArray(args)) {
      options = args
      args = null
    }

    if ('string' === typeof args) {
      args = args.split('  ')
    }

    this.options = options || {}
    this.command = command
    this.killedByProcess = false
    this.process = null
    this.exited = false
    this.signal = null
    this.code = null
    this.ppid = null
    this.args = Array.isArray(args) ? args : []
  }

  /**
   * Accessor for getting the process pid.
   * @accessor
   */
  get pid() {
    return this.process && this.process.pid
  }

  /**
   * Accessor for getting the process stdin.
   * @accessor
   */
  get stdin() {
    return this.process && this.process.stdin
  }

  /**
   * Accessor for getting the process stdout.
   * @accessor
   */
  get stdout() {
    return this._stdout
  }

  /**
   * Accessor for getting the process stderr.
   * @accessor
   */
  get stderr() {
    return this._stderr
  }

  /**
   * Accessor for getting the process channel.
   * @accessor
   */
  get channel() {
    return this.process && this.process.channel
  }

  /**
   * Accessor for getting the process connection state.
   * @accessor
   */
  get connected() {
    return Boolean(this.process && this.process.connected)
  }

  /**
   * Accessor for getting the process killed state.
   * @accessor
   */
  get killed() {
    const killed = Boolean(this.process && this.process.killed)
    if (killed) {
      this.killedByProcess = true
    }

    return this.killedByProcess || killed
  }

  /**
   * `spawn()` implementation for extending classes to
   * overload and provide a `ChildProcess` from some
   * other means.
   * @protected
   * @param {String} command
   * @param {?(Array|String)} args
   * @param {?(Object)} options
   * @param {Function} callback
   */
  spawn(command, args, options, callback) {
    if ('function' === typeof this.options.spawn) {
      try {
        this.options.spawn(command, args, options, callback)
      } catch (err) {
        callback(err)
      }
    } else {
      try {
        callback(null, spawn(command, args, options))
      } catch (err) {
        // istanbul ignore next
        callback(err)
      }
    }
  }

  /**
   * Implements the `_open()` methods for the `nanoresource` class.
   * @protected
   */
  _open(callback) {
    const { command, options, args } = this
    this.spawn(command, args, options, (err, child) => {
      let bufferedError = Buffer.alloc(0)

      if (err) {
        return callback(err)
      }

      callback = once(callback)

      child.once('close', (code, signal) => {
        this.close()
      })

      child.once('exit', (code, signal) => {
        this.code = code || 0
        this.ppid = null
        this.signal = signal
        this.exited = true
        this.inactive()
      })

      child.once('error', callback)


      // Pipe the child's stdout and stderr into passthrough streams
      // so that all data right from the beginning is captured.
      // The open callback is only invoked after a nextTick (due to stats capturing)
      // and the stdout and stderr sockets do not buffer data after being closed.
      if (child.stdout) {
        this._stdout = new PassThrough()
        child.stdout.pipe(this._stdout)
      }

      if (child.stderr) {
        this._stderr = new PassThrough()
        child.stderr.pipe(this._stderr)
        child.stderr.on('data', onerrors)
      }

      // istanbul ignore next
      function onerrors(err) {
        bufferedError = Buffer.concat([bufferedError, Buffer.from('\n'), err])
      }

      this.stat(child, (err, stats) => {
        // process may have ended before a stat
        // is possible so `err` is `null` here
        if (err && /not?|found/i.test(err.message)) {
          err = null
        }

        if (child.stderr) {
          child.stderr.removeListener('data', onerrors)
        }

        child.removeListener('error', callback)

        if (this.exited) {
          // istanbul ignore next
          if (this.code && bufferedError.length) {
            return process.nextTick(callback, new Error(String(bufferedError)))
          }
        }

        process.nextTick(() => this.active())
        process.nextTick(callback, err)

        if (stats && stats.ppid) {
          this.ppid = stats.ppid
        }

        this.process = child
      })
    })
  }

  /**
   * Closes the child process and all decedent child process in the process
   * tree calling `callback(err)` when closed or if an error occurs during
   * the closing of the spawned child process. Setting `allowActive` to
   * `false` (default) will cause a `'SIGTERM'` to be sent to the child process
   * causing it to close. You can call `child.kill({ force: true })` prior to
   * calling this method if you want force the processed to be killed. Set
   * `allowActive` to `true` to wait for the process to close on its and mark
   * the [nanoresource][nanoresource] instance **inactive**.
   * @public
   * @param {?(Boolean)} allowActive
   * @param {?(Function)} callback
   */
  close(allowActive, callback) {
    if ('function' === typeof allowActive) {
      callback = allowActive
      allowActive = false
    }

    if ('boolean' !== typeof allowActive) {
      allowActive = false
    }

    if ('function' !== typeof callback) {
      callback = noop
    }

    if (false === allowActive && this.process && this.process.pid) {
      this.kill(noop)
    }

    return super.close(allowActive, callback)
  }

  /**
   * Kill the child process.
   * @public
   * @param {?(Object)} opts
   * @param {?(Boolean)} [opts.force = false]
   * @param {Function} callback
  */
  kill(opts, callback) {
    if ('function' === typeof opts) {
      callback = opts
      opts = {}
    }

    assert('function' == typeof callback, 'Callback must be a function.')

    if (null === this.process && (this.closed || this.closing)) {
      return process.nextTick(callback, new PROCESS_CLOSED_ERR())
    }

    if (null === this.process) {
      return process.nextTick(callback, new PROCESS_NOT_RUNNING_ERR())
    }

    if (undefined === opts.force) {
      opts.force = false
    }

    kill(this.process.pid, opts, callback)
  }

  /**
   * Implements the `_close()` methods for the `nanoresource` class.
   * @protected
   */
  _close(callback) {
    this.opened = false
    this.closed = true
    this.opening = false
    this.closing = false
    this.process = null

    process.nextTick(callback, null)
  }

  /**
   * Queries statistics about the running process.
   * @public
   * @param {?(Object)} opts
   * @param {?(Number)} opts.pid
   * @param {?(Boolean)} [opts.shallow = false]
   * @param {Function} callback
   */
  stat(opts, callback) {
    if ('function' === typeof opts) {
      callback = opts
      opts = {}
    }

    assert('function' == typeof callback, 'Callback must be a function.')
    assert(opts && 'object' === typeof opts, 'Options must be an object.')

    if (!opts || !opts.pid) {
      if (null === this.process && (this.closed || this.closing)) {
        return process.nextTick(callback, new PROCESS_CLOSED_ERR())
      }

      if (null === this.process) {
        return process.nextTick(callback, new PROCESS_NOT_RUNNING_ERR())
      }
    }

    // istanbul ignore next
    const { pid = this.process ? this.process.pid : null } = opts
    const stats = new Stats(pid)
    const self = this

    find(pid, onfind)

    function onfind(err, results) {
      // istanbul ignore next
      if (err) { return callback(err) }
      // istanbul ignore next
      if (!results || false === Array.isArray(results)) {
        return callback(null, new PROCESS_NOT_RUNNING_ERR())
      }

      const result = results[0]

      if (result) {
        Object.assign(stats, {
          bin: result.bin,
          uid: result.uid,
          gid: result.gid,
          name: result.name,
        })

        if (self.process && result.pid === self.process.pid) {
          stats.command = self.command
        } else {
          stats.command = result.cmd
        }
      }

      if (true === opts.shallow) {
        pidusage([ pid ], onusage)
      } else {
        pidtree(pid, { root: true }, onpids)
      }
    }

    function onpids(err, pids) {
      // istanbul ignore next
      if (err) { return callback(err) }
      stats.pids = pids.filter((p) => p !== pid)
      pidusage(pids, onusage)
    }

    function onusage(err, usages) {
      clearTimeout(pidusageClearTimer)
      pidusageClearTimer = setTimeout(pidusage.clear, PIDUSAGE_CLEAR_TIMEOUT)

      // istanbul ignore if
      if (err) {
        return callback(err)
      }

      usages = Object.values(usages)

      for (const usage of usages) {
        if (usage && pid === usage.pid) {
          stats.cpu = usage.cpu
          stats.ppid = usage.ppid
          stats.uptime = usage.elapsed
          stats.memory = usage.memory
        }
      }

      callback(null, stats)
    }
  }

  /**
   * Adds an event listener to the child process.
   * @protected
   */
  // istanbul ignore next
  addListener(event, callback) {
    if (this.process) {
      return this.process.addListener(event, callback)
    }

    return false
  }

  /**
   * Removes an event listener to the child process.
   * @protected
   */
  // istanbul ignore next
  removeListener(event, callback) {
    if (this.process) {
      return this.process.removeListener(event, callback)
    }

    return false
  }

  /**
   * Alias to `addListener()`.
   * @protected
   */
  on(event, callback) {
    // istanbul ignore next
    return this.addListener(event, callback)
  }

  /**
   * Alias to `removeListener()`.
   * @protected
   */
  off(event, callback) {
    // istanbul ignore next
    return this.removeListener(event, callback)
  }

  /**
   * Send a message to the child process.
   * @see {@link https://nodejs.org/api/child_process.html#child_process_subprocess_send_message_sendhandle_options_callback}
   * @return {Boolean}
   */
  send(...args) {
    // istanbul ignore next
    if (this.process && 'function' === typeof this.process.send) {
      return this.process.send(...args)
    }

    // istanbul ignore next
    return false
  }

  /**
   * Disconnect the child process.
   * @see {@link https://nodejs.org/api/child_process.html#child_process_subprocess_disconnect}
   */
  disconnect() {
    // istanbul ignore next
    if (this.process && 'function' === typeof this.process.disconnect) {
      this.process.disconnect()
    }
  }
}

/**
 * Factory for creating `Process` instances.
 * @public
 * @default
 * @param {String} command
 * @param {?(Array)} args
 * @param {?(Object)} opts
 * @return {Process}
 */
function createProcess(...args) {
  return new Process(...args)
}

/**
 * Module exports.
 */
module.exports = Object.assign(createProcess, {
  Process,
})
