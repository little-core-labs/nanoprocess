const spawn = require('cross-spawn')
const test = require('tape')
const path = require('path')

const nanoprocess = require('./')

const xtest = () => void 0

test('const child = nanoprocess(command[, args[, opts]])', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  t.equal(false, child.connected)
  t.equal(false, child.killed)
  t.notOk(child.channel)
  child.open((err) => {
    t.notOk(err)
    t.ok(child.pid)
    t.ok(child.ppid)
    t.ok(child.options)
    t.ok(child.process)
    t.notOk(child.code)
    t.notOk(child.signal)
    t.ok(args === child.args)
    t.equal('node', child.command)

    process.nextTick(() => {
      child.stat((err, stats) => {
        t.notOk(err)
        t.ok(stats && 'object' === typeof stats)
        t.ok(stats.bin)
        t.ok(stats.uid)
        t.ok(stats.gid)
        t.ok(stats.cpu)
        t.ok(stats.pid)
        t.ok(stats.ppid)
        t.ok(Array.isArray(stats.pids))
        t.ok(0 === stats.pids.length) // no sub processes
        t.ok(stats.uptime)
        t.ok(stats.memory)
        t.equal('node', stats.command)
        child.stat({ shallow: true }, (err, stats) => {
          t.notOk(err)
          t.ok(stats)
          t.ok(stats.isRunning)
          t.equal(stats.pid, child.process.pid)
          child.close(true, (err) => {
            t.notOk(err)
            t.equal(0, child.code)
            t.equal(null, child.ppid)
            t.equal(null, child.signal)
            t.end()
          })
        })
      })
    })
  })
})

test('nanoprocess() - string args', (t) => {
  const args = path.join('fixtures', 'work.js')
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    child.close(false, (err) => {
      t.notOk(err)
      t.end()
    })
  })
})

test('nanoprocess() - terminated', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    child.close(false, (err) => {
      t.notOk(err)
      t.equal(0, child.code)
      t.equal('SIGTERM', child.signal)
      t.end()
    })
  })
})

test('nanoprocess() - child spawn', (t) => {
  const args = [path.join('fixtures', 'spawn.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    t.ok(child.pid)
    t.ok(child.options)
    t.ok(child.process)
    t.ok(args === child.args)
    t.equal('node', child.command)

    child.stat(function onstat(err, stats) {
      if (stats && 0 == stats.pids.length) {
        return child.stat(onstat)
      }

      t.notOk(err)
      t.ok(stats && 'object' === typeof stats)
      t.ok(Array.isArray(stats.pids))
      t.ok(1 === stats.pids.length) // 1 sub process
      child.stat({ shallow: true }, (err, stats) => {
        t.notOk(err)
        t.ok(stats)
        t.equal(stats.pid, child.process.pid)
        t.ok(0 === stats.pids.length) // shallow
        child.close((err) => {
          t.notOk(err)
          t.end()
        })
      })
    })
  })
})

test('nanoprocess() - fork, child spawn', (t) => {
  const args = [path.join('fixtures', 'spawn.js')]
  const child = nanoprocess('node', args, { stdio: [ 0, 1, 2, 'ipc' ] })
  child.open((err) => {
    t.notOk(err)
    t.ok(child.pid)
    t.ok(child.options)
    t.ok(child.process)
    t.ok(child.channel)
    t.ok(child.connected)
    t.ok(args === child.args)
    t.equal('node', child.command)

    child.stat(function onstat(err, stats) {
      if (stats && 0 == stats.pids.length) {
        return child.stat(onstat)
      }

      t.notOk(err)
      t.ok(stats && 'object' === typeof stats)
      t.ok(Array.isArray(stats.pids))
      t.ok(1 === stats.pids.length) // 1 sub process
      child.stat({ shallow: true }, (err, stats) => {
        t.notOk(err)
        t.ok(stats)
        t.equal(stats.pid, child.process.pid)
        t.ok(0 === stats.pids.length) // shallow
        child.close((err) => {
          t.notOk(err)
          t.end()
        })
      })
    })
  })
})

test('nanoprocess() - use after closed', (t) => {
  const args = [path.join('fixtures', 'spawn.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    child.close((err) => {
      t.notOk(err)
      child.stat((err) => {
        t.ok(err)
        t.end()
      })
    })
  })
})

test('nanoprocess() - use before running', (t) => {
  const child = nanoprocess('echo')
  child.stat((err) => {
    t.ok(err)
    t.end()
  })
})

test('nanoprocess() - failed process', (t) => {
  const args = [path.join('fixtures', 'error.js')]
  const child = nanoprocess('node', args, { stdio: 'inherit' })
  child.open((err) => {
    child.close((err) => {
      t.end()
    })
  })
})

test('nanoprocess() - exit code 123 process', (t) => {
  const args = [path.join('fixtures', 'exit-123.js')]
  const child = nanoprocess('node', args, { stdio: 'inherit' })
  child.open((err) => {
    child.close(true, (err) => {
      t.equal(123, child.code)
      t.equal(null, child.signal)
      t.end()
    })
  })
})

test('nanoprocess() - invalid command', (t) => {
  const child = nanoprocess('not-a-command')
  child.open((err) => {
    t.ok(err)
    t.end()
  })
})

test('nanoprocess() - kill process', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    t.throws(() => child.kill())
    child.kill({ force: true }, (err) => {
      t.notOk(err)
      child.close((err) => {
        t.notOk(err)
        t.equal('SIGKILL', child.signal)
        t.end()
      })
    })
  })
})

test('nanoprocess() - kill child process', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    child.process.kill()
    t.equal(true, child.killed)
    child.close((err) => {
      t.notOk(err)
      t.equal(true, child.killed)
      t.equal('SIGTERM', child.signal)
      t.end()
    })
  })
})

test('nanoprocess() - kill already killed process', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    t.notOk(err)
    child.kill((err) => {
      t.notOk(err)
      child.kill((err) => {
        t.ok(err)
        t.end()
      })
    })
  })
})

test('nanoprocess() - kill not opened or opening process', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.kill((err) => {
    t.ok(err)
    child.open()
    child.kill((err) => {
      t.ok(err)
      child.close((err) => {
        t.notOk(err)
        t.end()
      })
    })
  })
})

test('nanoprocess() - kill not closed or closing process', (t) => {
  t.plan(2)

  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    child.close((err) => {
      child.kill((err) => {
        t.ok(err)
      })
    })

    // can race
    if (child.closing) {
      child.kill((err) => {
        t.ok(err)
      })
    } else {
      t.pass()
    }
  })
})

test('nanoprocess() - invalid tree', (t) => {
  const args = [path.join('fixtures', 'echo.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    child.stat({ pid: 10000000000 }, (err) => {
      t.ok(err)
      t.end()
    })
  })
})

test('nanoprocess() - stat child pids', (t) => {
  const args = [path.join('fixtures', 'fork.js')]
  const child = nanoprocess('node', args)
  child.open((err) => {
    child.stat(function onstat(err, stats) {
      if (stats && 0 == stats.pids.length) {
        return child.stat(onstat)
      }

      t.notOk(err)
      child.stat({pid: stats.pids[0]}, (err, stats) => {
        t.notOk(err)
        t.ok(stats)
        t.ok(child.pid === stats.ppid)
        t.ok(0 === stats.pids.length)
        t.end()
      })
    })
  })
})

test('nanoprocess() - custom spawn', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args, {
    spawn(command, args, opts, callback) {
      callback(null, spawn(command, args, opts))
    }
  })

  child.open((err) => {
    t.notOk(err)
    child.close((err) => {
      t.notOk(err)
      t.end()
    })
  })
})

test('nanoprocess() - custom spawn error', (t) => {
  const args = [path.join('fixtures', 'work.js')]
  const child = nanoprocess('node', args, {
    spawn(command, args, opts, callback) {
      throw new Error('ERROR')
    }
  })

  child.open((err) => {
    t.ok(err)
    t.end()
  })
})

test('nanoprocess() - inherit stdio', (t) => {
  const child = nanoprocess('node', {
    stdio: 'inherit'
  })

  t.equal('inherit', child.options.stdio)
  child.open((err) => {
    t.error(err)
    t.notOk(child.stdin)
    t.notOk(child.stdout)
    t.notOk(child.stderr)
    child.close((err) => {
      t.error(err)
      t.end()
    })
  })
})

test('nanoprocess() - pipe stdio', (t) => {
  const child = nanoprocess('node', {
    stdio: 'pipe'
  })

  t.equal('pipe', child.options.stdio)
  child.open((err) => {
    t.error(err)
    t.ok(child.stdin)
    t.ok(child.stdout)
    t.ok(child.stderr)
    child.close((err) => {
      t.error(err)
      t.end()
    })
  })
})

test('nanoprocess() - stdout works', t => {
  const child = nanoprocess('echo', ['foo'])
  child.open((err) => {
    t.error(err)
    let timeout = setTimeout(() => {
      t.error(new Error('Data was not received'))
    }, 100)
    child.stdout.once('data', data => {
      t.equal(data.toString(), 'foo\n')
      clearTimeout(timeout)
      t.end()
    })
  })
})
