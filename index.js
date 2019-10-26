const isRunning = require('is-running')
const Resource = require('nanoresource')
const pidusage = require('pidusage')
const pidtree = require('pidtree')
const assert = require('assert')
const Batch = require('batch')
const spawn = require('cross-spawn')
const fkill = require('fkill')
const pfind = require('find-process')

// quick util
const errback = (p, cb) => void p.then((res) => cb(null, res), cb)
const find = (pid, cb) => errback(pfind('pid', pid), cb)
const kill = (pid, cb) => errback(fkill(pid), cb)

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
  }

  /**
   * @accessor
   */
  get isRunning() {
    return this.pids.concat(this.pid).some((isRunning))
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
    assert('string' === typeof command && command.length > 0)

    if ('string' === typeof args) {
      args = args.split('  ')
    }

    this.options = options || {}
    this.command = command
    this.process = null
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
   * Implements the `_open()` methods for the `nanoresource` class.
   * @protected
   */
  _open(callback) {
    const { command, args } = this
    const child = spawn(command, args, this.options)

    if (child.error) {
      return callback(child.error)
    }

    child.once('close', () => {
      this.close()
    })

    this.process = child
    process.nextTick(callback, null)
  }

  /**
   * Implements the `_close()` methods for the `nanoresource` class.
   * @protected
   */
  _close(callback) {
    this.stat((err, stats) => {
      // ignore `stat()` err as the process may have already
      // shutdown on its own
      const kills = new Batch()

      // ignore kill errors as the process may be shutdown
      // and `fkill()` will throw an error
      kills.push((next) => kill(this.process.pid, () => next()))

      if (stats) {
        for (const pid of stats.pids) {
          // ignore `fkill` errors for child processes too
          kills.push((next) => kill(pid, () => next()))
        }
      }

      kills.end((err) => {
        this.process = null
        callback(err)
      })
    })
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

    assert('function' == typeof callback)
    assert(opts && 'object' === typeof opts)

    if (this.closed) {
      return process.nextTick(callback, new PROCESS_CLOSED_ERR())
    }

    const { pid = this.process.pid } = opts
    const stats = new Stats(pid)
    const self = this

    find(pid, onfind)

    function onfind(err, results) {
      if (err) { return callback(err) }

      if (Array.isArray(results)) {
        for (const result of results) {
          if (result && pid === result.pid) {
            stats.bin = result.bin
            stats.uid = result.uid
            stats.gid = result.gid
            stats.name = result.name
            if (result.pid === self.process.pid) {
              stats.command = self.command
            } else {
              stats.command = result.cmd
            }
            break;
          }
        }
      }

      if (true === opts.shallow) {
        pidusage([ pid ], onusage)
      } else {
        pidtree(pid, { root: true }, onpids)
      }
    }

    function onpids(err, pids) {
      if (err) { return callback(err) }
      stats.pids = pids.filter((p) => p !== pid)
      pidusage(pids, onusage)
    }

    function onusage(err, usages) {
      clearTimeout(pidusageClearTimer)
      pidusageClearTimer = setTimeout(pidusage.clear, PIDUSAGE_CLEAR_TIMEOUT)

      if (err) {
        return callback(err)
      }

      usages = Object.values(usages)

      for (const usage of usages) {
        stats.memory += usage.memory
        if (pid === usage.pid) {
          stats.cpu = usage.cpu
          stats.ppid = usage.ppid
          stats.uptime = usage.elapsed
        }
      }

      callback(null, stats)
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

module.exports = Object.assign(createProcess, {
  Process
})
