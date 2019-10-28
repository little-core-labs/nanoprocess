nanoprocess
===========

> Maintain a child process as a [nanoresource][nanoresource]

<a name="installation"></a>
## Installation

```sh
$ npm install nanoprocess
```

<a name="status"></a>
## Status

> **Stable**
[![Actions Status](https://github.com/little-core-labs/nanoprocess/workflows/Node%20CI/badge.svg)](https://github.com/little-core-labs/nanoprocess/actions)

<a name="usage"></a>
## Usage

```js
const nanoprocess = require('nanoprocess')

// spawn a comand
const child = nanoprocess(command, args, opts)

// open process and query for stats
child.open((err) => {
  child.stat((err, stats) => {
    console.log(stats)
  })
})
```

<a name="example"></a>
## Example

The following example spawns a node process that spawns a `sleep`
command running for 2 seconds while also doing a lot of work
(`Array(10e7).fill(crypto.randomBytes(1024));`). The example will query
for process stats and leverage the [progress][progress] module to output
process memory and CPU usage.

```js
const prettyBytes = require('pretty-bytes')
const nanoprocess = require('nanoprocess')
const prettyTime = require('pretty-ms')
const Progress = require('progress')

const template = [
  '> :name (:pid)',
  'up for :uptime',
  'CPU: :cpu%',
  'MEM: :mem',
  ':pidsCount child process(es)'
].join(' | ')

const sleep = nanoprocess('node', [
  '-e',
  'process.title = "sleep";' +
  'require("cross-spawn")("sleep", [2]);' +
  'Array(10e7).fill(crypto.randomBytes(1024));'
])

const bar = new Progress(template, {
  width: 20,
  total: 1
})

sleep.open((err) => {
  console.log('> opened')

  let timer = 0
  sleep.stat(function onstat(err, stats) {
    if (stats) {
      bar.update(0, {
        pidsCount: stats.pids.length,
        uptime: prettyTime(stats.uptime),
        name: stats.name,
        mem: prettyBytes(stats.memory),
        cpu: Math.floor(stats.cpu),
        pid: stats.pid,
      })
    }

    if (stats && stats.uptime > 2000 && 0 === stats.cpu) {
      bar.update(1, stats)
      sleep.close()
    } else if (!err) {
      clearTimeout(timer)
      timer = setTimeout(() => sleep.stat(onstat), 100)
    }
  })

  sleep.process.on('close', () => {
    console.log('')
    console.log('> closed')
  })
})
```

```sh
$ node example.js
> opened
> sleep (33153) | up for 5.2s | CPU: 99% | MEM: 1.25 GB | 1 child process(es)
> closed
```

<a name="api"></a>
## API

<a name="require-nanoprocess"></a>
### `const nanoprocess = require('nanoprocess')`

The `nanoprocess` function returns a new [`Process`](#child-process) instance
that extends [nanoresource][nanoresource].

```js
const child = nanoprocess('sleep', [2])
child.open((err) => {
  // process is opened
})
```

<a name="nanoprocess"></a>
### `const child = nanoprocess(command[, args[, options]])`

Create a new [`Process`](#child-process) instance from `command` with
optional `args` and `options` that are given to
[cross-spawn][cross-spawn] when the [child process is
opened](#child-open).

```js
const ls = nanoprocess('ls', ['.'])
ls.open((err) => {
  ls.process.stdout.pipe(process.stdout)
})
```

<a name="require-process"></a>
### `const { Process } = require('nanoprocess')`

The `nanoprocess` exports the [`Process`](#child-process) class that can
be extended.

```js
const { Process } = require('nanoprocess')

class InstallDependencies extends Process {
  constructor(dirname) {
    super('npm', ['install'], { cwd: dirname })
  }
}

const install = new InstallDependencies('path/to/dir')
install.open(() => {
  // stat loop
  install.stat(function onstat(err, stats) {
    console.log(stats) // Stats { cpu: 14.23, ... }
    install.stat(onstat)
  })

  install.process.on('close', (err) => {
    console.log('closed')
  })
})
```

<a name="child-process"></a>
### `const child = new Process(command[, args[, options]])`

Create a new [`Process`](#child-process) instance from `command` with
optional `args` and `options` that are given to
[cross-spawn][cross-spawn] when the [child process is
opened](#child-open).

<a name="child-options"></a>
#### `child.options`

The initial `options` given to the [`Process`](#child-process) instance
constructor which are given to [cross-spawn][cross-spawn] when
the [child process is opened](#child-open).

<a name="child-command"></a>
#### `child.command`

The command to [spawn][cross-spawn] when the
[child process is opened](#child-open).

<a name="child-process"></a>
#### `child.process`

When the child process is opened, this will be an instance of
[`child_process.ChildProcess`](
https://nodejs.org/api/child_process.html#child_process_class_childprocess).

<a name="child-pid"></a>
#### `child.pid`

The child process ID.

<a name="child-signal"></a>
#### `child.signal`

The child process exit signal. This value can be `null`. Check this
after the child process has closed.

<a name="child-code"></a>
#### `child.code`

The child process exit code. This value can be `null`. Check this after
the child process has closed.

<a name="child-args"></a>
#### `child.args`

The arguments for the child process [command](#child-command) given to
[cross-spawn][cross-spawn] when the [child process is opened](#child-open).

<a name="child-open"></a>
#### `child.open(callback)`

Opens the child process by [spawning][cross-spawn] a
[command](#child-command) with optional [arguments](#child-args) and
[options](#child-options) calling `callback(err)` when opened or if an
error occurs during the spawning of the child process.

<a name="child-close"></a>
#### `child.close([allowActive[, callback]])`

Closes the child process and all decedent child process in the process
tree calling `callback(err)` when closed or if an error occurs during
the closing of the spawned child process. Setting `allowActive` to
`false` (default) will cause a `'SIGTERM'` to be sent to the child process
causing it to close. You can call `child.kill({ force: true })` prior to
calling this method if you want force the processed to be killed. Set
`allowActive` to `true` to wait for the process to close on its and mark
the [nanoresource][nanoresource] instance **inactive**.

<a name="child-kill"></a>
#### `child.kill([opts], callback)`

Kill the child process calling `callback` when killed or if can error
occurs. Set `opts.true` to force the processed to be killed.

<a name="child-stat"></a>
#### `child.stat(callback)`

Queries for statistics about the running child process for information
like [cpu usage](#child-stat-cpu) and [memory
consumption](#child-stat-memory) calling `callback(err, stats)` with a
stats object or if an error occurs.

```js
child.stat((err, stats) => {
  // handle stats
})
```

The output of the `stats` object may look something like:

```js
Stats {
  bin: 'sleep',
  uid: 1000,
  gid: 1000,
  cpu: 138.46153845657875,
  pid: 33792,
  ppid: 33785,
  pids: [ 33810 ],
  name: 'sleep',
  atime: 1572118184405,
  uptime: 680,
  memory: 241070080,
  command: 'node' }
```

<a name="child-stat-bin"></a>
##### `stats.bin`

The initial binary used invoke the child process.

<a name="child-stat-uid"></a>
##### `stats.uid`

The user ID of the child process.

<a name="child-stat-gid"></a>
##### `stats.gid`

The group ID of the child process.

<a name="child-stat-cpu"></a>
##### `stats.cpu`

The current CPU usage as a percentage of the child process.

<a name="child-stat-pid"></a>
##### `stats.pid`

The child process ID.

<a name="child-stat-ppid"></a>
##### `stats.ppid`

The parent process ID of the child process.

<a name="child-stat-pids"></a>
##### `stats.pids`

The child process IDs of the child process

<a name="child-stat-name"></a>
##### `stats.name`

The name of process

<a name="child-stat-atime"></a>
##### `stats.atime`

The time stamp in milliseconds this stat was accessed.

<a name="child-stat-uptime"></a>
##### `stats.uptime`

Time in milliseconds since process spawned

<a name="child-stat-memory"></a>
##### `stats.memory`

Memory usage in bytes

<a name="child-stat-command"></a>
##### `stats.command`

The command used to start the process

<a name="child-stat-is-running"></a>
##### `stats.isRunning`

`true` if the process or any child process in the [pidtree][pidtree] for
the root child process [is still running][is-running].

## See Also

- [nanoresource][nanoresource]
- [find-process][find-process]
- [cross-spawn][cross-spawn]
- [pidusage][pidusage]
- [pidtree][pidtree]

## License

MIT


[nanoresource]: https://github.com/mafintosh/nanoresource
[find-process]: https://github.com/yibn2008/find-process
[cross-spawn]: https://github.com/moxystudio/node-cross-spawn
[is-running]: https://github.com/nisaacson/is-running
[progress]: https://github.com/visionmedia/node-progress
[pidusage]: https://github.com/soyuka/pidusage
[pidtree]: https://github.com/simonepri/pidtree

